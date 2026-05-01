"""
Logical component: pure-functional Layer 2 normalizer.

Takes pydantic-parsed VPIC envelopes (Layer 1) and produces the dicts that go
into rules-source/open-vehicle/nhtsa-source/ (Layer 2). No network, no disk
side effects beyond what the caller passes through json_io.write_json.

Every public builder validates its output against the relevant schema before
returning, so a malformed transformation cannot reach disk.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import re
from pathlib import Path
from typing import Iterable, Mapping

from pydantic import ValidationError

from schemas import validate_or_raise
from vpic_models import (
    CanadianSpecsEnvelope,
    MakesEnvelope,
    ModelsEnvelope,
    SpecsKV,
)


# Logical component: same slug rules the curated styles files already use, so
# Layer 2 keys overlay cleanly with curator-edited curated-overrides.
_SLUG_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def make_slug(make_name: str) -> str:
    """Normalize a make name into the snake_case slug convention used by styles/<make>.json."""
    return _SLUG_NON_ALNUM.sub("_", make_name.lower()).strip("_")


def _utc_iso_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


# Logical component: makes/models projection. Input is one MakesEnvelope plus a
# stream of (year, ModelsEnvelope) — the refresh script collects every fetched
# year per make and hands them all to this builder.
def build_nhtsa_makes_models(
    *,
    makes: MakesEnvelope,
    models_per_year: Iterable[tuple[int, ModelsEnvelope]],
    generated_at: str | None = None,
) -> dict:
    """Return a dict matching `nhtsa-makes-models-source.schema.json`."""
    # Logical component: index models by (make_name_upper, model_name_upper).
    by_make: dict[str, dict[str, dict]] = {}
    seen_years: dict[str, dict[str, set[int]]] = {}
    for year, env in models_per_year:
        for row in env.results:
            make_key = row.make_name.strip().upper()
            model_key = row.model_name.strip().upper()
            slot = by_make.setdefault(make_key, {})
            entry = slot.setdefault(
                model_key,
                {
                    "model_id": int(row.model_id),
                    "model_name": row.model_name.strip(),
                    "vehicle_type": "car",
                    "years": [],
                },
            )
            seen_years.setdefault(make_key, {}).setdefault(model_key, set()).add(int(year))
            # Logical component: keep stable model_id; VPIC sometimes returns the
            # same model under different ids across years — first one wins.
            entry["model_id"] = entry["model_id"]

    # Logical component: emit make rows in slug order; only include makes that
    # also appear in the makes envelope (every model row's make should map back).
    makes_by_name: dict[str, dict] = {}
    for m in makes.results:
        key = m.make_name.strip().upper()
        makes_by_name[key] = {
            "make_id": int(m.make_id),
            "make_name": m.make_name.strip().upper(),
            "make_slug": make_slug(m.make_name),
        }

    out_makes: list[dict] = []
    for make_key in sorted(makes_by_name, key=lambda k: makes_by_name[k]["make_slug"]):
        models_for_make = by_make.get(make_key, {})
        if not models_for_make:
            continue  # Layer 2 only carries makes we actually got models for.
        models_out: dict[str, dict] = {}
        all_years: set[int] = set()
        for model_key in sorted(models_for_make):
            entry = models_for_make[model_key]
            years = sorted(seen_years.get(make_key, {}).get(model_key, set()))
            entry["years"] = years
            all_years.update(years)
            models_out[model_key] = entry
        if not all_years:
            continue
        make_out = dict(makes_by_name[make_key])
        make_out["first_year"] = min(all_years)
        make_out["last_year"] = max(all_years)
        make_out["models"] = models_out
        out_makes.append(make_out)

    doc = {
        "schemaVersion": "1.0.0",
        "generatedAt": generated_at or _utc_iso_now(),
        "makes": out_makes,
    }
    validate_or_raise("nhtsa_makes_models_source", doc, context="<nhtsa_makes_models_source>")
    return doc


# Logical component: catalog-scoped detail rows. Input is one tuple per
# (year, make, model) the refresh actually fetched, plus the matching envelope.
def build_nhtsa_catalog_style_details(
    *,
    specs_per_tuple: Iterable[tuple[int, str, str, CanadianSpecsEnvelope]],
    generated_at: str | None = None,
) -> dict:
    """Return a dict matching `nhtsa-catalog-style-details-source.schema.json`."""
    rows: list[dict] = []
    for year, make, model, env in specs_per_tuple:
        for idx, result in enumerate(env.results):
            specs = _flatten_specs_kv(result.specs)
            rows.append(
                {
                    "year": int(year),
                    "make": str(make),
                    "model": str(model),
                    "vpicResultIndex": idx,
                    "specs": specs,
                }
            )
    rows.sort(key=lambda r: (r["make"], r["model"], r["year"], r["vpicResultIndex"]))
    doc = {
        "schemaVersion": "1.0.0",
        "generatedAt": generated_at or _utc_iso_now(),
        "rows": rows,
    }
    validate_or_raise(
        "nhtsa_catalog_style_details_source", doc, context="<nhtsa_catalog_style_details_source>"
    )
    return doc


def _flatten_specs_kv(specs: list[SpecsKV]) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    for kv in specs:
        out[kv.name] = kv.value
    return out


# Logical component: source manifest. Caller supplies the input file paths (we
# hash them) and the rolled-up vpic stats + response-set hash (already computed
# from the cache manifest).
def build_source_manifest(
    *,
    refresh_mode: str,
    year_from: int,
    year_to: int,
    current_year: int,
    input_files: Mapping[str, Path],
    vpic_total: int,
    vpic_failures: int,
    vpic_response_set_hash: str,
    generated_at: str | None = None,
) -> dict:
    """Return a dict matching `source-manifest.schema.json`."""
    fail_rate = 0.0 if vpic_total == 0 else vpic_failures / vpic_total
    input_hashes = {label: f"sha256:{_hash_file(path)}" for label, path in input_files.items()}
    doc = {
        "schemaVersion": "1.0.0",
        "generatedAt": generated_at or _utc_iso_now(),
        "refreshMode": refresh_mode,
        "yearFrom": int(year_from),
        "yearTo": int(year_to),
        "currentYear": int(current_year),
        "inputHashes": input_hashes,
        "vpic": {
            "totalRequests": int(vpic_total),
            "failures": int(vpic_failures),
            "failRate": float(fail_rate),
            "responseSetHash": _ensure_sha256_prefix(vpic_response_set_hash),
        },
    }
    validate_or_raise("source_manifest", doc, context="<source_manifest>")
    return doc


def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _ensure_sha256_prefix(value: str) -> str:
    return value if value.startswith("sha256:") else f"sha256:{value}"


def response_set_hash(response_hashes: Iterable[tuple[str, str]]) -> str:
    """Stable hash over (cache_key, response_sha256) pairs.

    Caller passes the cache manifest entries; sort + concat is deterministic.
    """
    h = hashlib.sha256()
    for key, sha in sorted(response_hashes):
        h.update(f"{key}:{sha}\n".encode("utf-8"))
    return f"sha256:{h.hexdigest()}"


# Logical component: validation report. The refresh layer records issues as it
# encounters them and hands the accumulated buckets here for normalization.
def build_validation_report(
    *,
    issues: Mapping[str, list[dict]] | None = None,
    counts: Mapping[str, Mapping[str, int]] | None = None,
    generated_at: str | None = None,
) -> dict:
    """Return a dict matching `validation-report.schema.json`."""
    issues_out: dict[str, list[dict]] = {
        "unmatchedCatalogMakes": [],
        "unmatchedCatalogModels": [],
        "emptyDetailTuples": [],
        "ambiguousMatches": [],
        "staleAliases": [],
    }
    if issues:
        for k, v in issues.items():
            issues_out.setdefault(k, []).extend(v or [])

    counts_out: dict[str, dict[str, int]] = {}
    if counts:
        for make_slug_key, c in counts.items():
            counts_out[make_slug_key] = {
                "models": int(c.get("models", 0)),
                "styles": int(c.get("styles", 0)),
            }

    doc = {
        "schemaVersion": "1.0.0",
        "generatedAt": generated_at or _utc_iso_now(),
        "issues": issues_out,
        "counts": counts_out,
    }
    validate_or_raise("validation_report", doc, context="<validation_report>")
    return doc


# Logical component: convenience wrapper that swallows pydantic ValidationError
# into a normalized "this body is malformed" issue row. Used by the refresh
# layer when iterating cached responses — one bad NHTSA payload should not
# blow up the whole run.
def parse_or_record_issue(model_cls, body: dict, *, issue_bucket: list[dict], context: dict):
    """Try to parse `body` into `model_cls`; on failure append a fatal issue row."""
    try:
        return model_cls.model_validate(body)
    except ValidationError as e:
        issue_bucket.append(
            {
                "severity": "fatal",
                "message": f"VPIC response failed pydantic validation: {e.error_count()} errors",
                **context,
            }
        )
        return None
