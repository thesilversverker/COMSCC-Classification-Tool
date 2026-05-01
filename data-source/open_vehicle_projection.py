"""
Logical component: offline projection — Layer 2 NHTSA baseline ⊕ curated overlays ⊕
visibility → Layer 3 shapes (`makes_and_models.json` + `styles/<slug>.json`).

Deterministic ordering everywhere so `_proposed/` diffs are reviewable byte-for-byte.

Design notes:
- Baseline prefers `nhtsa-source/nhtsa-makes-models-source.json` (`makes` array).
  When absent (operator has not run a VPIC refresh yet), callers pass the current
  curated `makes_and_models.json` array instead — same projection code path,
  allows CI/tests without Layer 2 files.
- Scope filter: a (make_slug, model_key) ships only when referenced by the COMSCC
  catalog after alias resolution, **or** when `include: true` appears under that
  model in `curated-overrides/<slug>.json`.
- Styles start from seeded `styles/<slug>.json` (carry-forward) when enabled,
  then curated `styles_*` ops apply, then trim aliases remap style keys.
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any, Iterable

# Logical component: JS-compatible normalization (see scripts/build-showroom-lookup-rows.mjs).


def norm_token(s: str) -> str:
    return " ".join(str(s or "").strip().lower().split())


_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def slugify_trim_key(s: str) -> str:
    return _NON_ALNUM.sub("_", str(s).lower()).strip("_")


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_baseline_makes(path_nhtsa: Path, path_fallback_array: Path) -> list[dict[str, Any]]:
    """Return the baseline makes array (Layer 3 shape with model_styles allowed)."""
    if path_nhtsa.exists():
        doc = load_json(path_nhtsa)
        makes = doc.get("makes")
        if not isinstance(makes, list):
            raise ValueError(f"{path_nhtsa} missing array `makes`")
        return [_normalize_layer2_make(m) for m in makes]
    raw = load_json(path_fallback_array)
    if not isinstance(raw, list):
        raise ValueError(f"{path_fallback_array} must be a top-level array")
    return [copy.deepcopy(m) for m in raw]


def _normalize_layer2_make(m: dict[str, Any]) -> dict[str, Any]:
    """Ensure every model has model_styles + years lists Layer 3 compose expects."""
    out = copy.deepcopy(m)
    models = out.get("models") or {}
    if not isinstance(models, dict):
        return out
    for _mk, model in models.items():
        if not isinstance(model, dict):
            continue
        model.setdefault("model_styles", {})
        model.setdefault("years", [])
        model.setdefault("vehicle_type", "car")
    return out


def load_aliases(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schemaVersion": "1.0.0", "makes": {}, "models": {}, "trims": {}}
    return load_json(path)


def load_visibility(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schemaVersion": "1.0.0", "makes": {}}
    return load_json(path)


def load_curated_override(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return load_json(path)


def canonical_make_name(csv_make: str, makes_map: dict[str, Any]) -> str:
    """Resolve curator make typo → canonical string matching baseline `make_name`."""
    key = csv_make.strip()
    entry = makes_map.get(key) or makes_map.get(csv_make)
    if isinstance(entry, dict) and isinstance(entry.get("canonical"), str):
        return entry["canonical"].strip()
    return csv_make.strip()


def resolve_model_alias(
    csv_make: str,
    csv_model: str,
    models_map: dict[str, Any],
    *,
    canonical_make_after_typo: str,
) -> tuple[str, str, str | None]:
    """Return (canonical_make_for_baseline, canonical_model_for_baseline, trim_hint).

    Composite keys try several shapes so curators can key aliases flexibly.
    """
    cm = csv_model.strip()
    variants = [
        f"{csv_make.strip()}|{cm}",
        f"{canonical_make_after_typo}|{cm}",
        f"{csv_make.strip()}::{cm}",
    ]
    for k in variants:
        entry = models_map.get(k)
        if isinstance(entry, dict) and isinstance(entry.get("make"), str) and isinstance(entry.get("model"), str):
            trim = entry.get("trim")
            t = str(trim).strip() if trim not in (None, "") else None
            return entry["make"].strip(), entry["model"].strip(), t
    return canonical_make_after_typo, cm, None


def index_baseline_by_slug(makes: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(m["make_slug"]): m for m in makes if isinstance(m.get("make_slug"), str)}


def slug_for_resolved_make_name(baseline_by_slug: dict[str, dict], resolved_make: str) -> str | None:
    """Map canonical display make string → baseline make_slug."""
    target = norm_token(resolved_make)
    for slug, m in baseline_by_slug.items():
        if norm_token(str(m.get("make_name", ""))) == target:
            return slug
    return None


def find_model_key(models: dict[str, Any], catalog_model: str) -> str | None:
    """Pick the baseline model dict key for a catalog model label."""
    cm = norm_token(catalog_model)
    if not cm:
        return None
    for mk, mv in models.items():
        if not isinstance(mv, dict):
            continue
        if norm_token(str(mk)) == cm:
            return str(mk)
        mn = mv.get("model_name")
        if isinstance(mn, str) and norm_token(mn) == cm:
            return str(mk)
    return None


def collect_catalog_scope(
    catalog_rows: Iterable[dict[str, Any]],
    baseline_by_slug: dict[str, dict[str, Any]],
    aliases: dict[str, Any],
) -> set[tuple[str, str]]:
    """Return {(make_slug, model_key_upper)} referenced by the COMSCC catalog."""
    makes_map = aliases.get("makes") or {}
    models_map = aliases.get("models") or {}
    scope: set[tuple[str, str]] = set()

    for row in catalog_rows:
        vm = row.get("vehicleMake") or row.get("make")
        vmodel = row.get("vehicleModel") or row.get("model")
        if not isinstance(vm, str) or not isinstance(vmodel, str):
            continue
        csv_make = vm.strip()
        csv_model = vmodel.strip()
        if not csv_make or not csv_model:
            continue

        mk_typo = canonical_make_name(csv_make, makes_map)
        mk_final, md_final, _trim = resolve_model_alias(
            csv_make, csv_model, models_map, canonical_make_after_typo=mk_typo
        )

        slug = slug_for_resolved_make_name(baseline_by_slug, mk_final)
        if slug is None:
            continue
        models_dict = (baseline_by_slug[slug].get("models") or {})
        if not isinstance(models_dict, dict):
            continue
        mkey = find_model_key(models_dict, md_final)
        if mkey is None:
            continue
        scope.add((slug, mkey.upper()))

    return scope


def collect_include_scope(curated_dir: Path) -> set[tuple[str, str]]:
    """Union models explicitly marked `include: true` across curated-overrides/*.json."""
    scope: set[tuple[str, str]] = set()
    if not curated_dir.exists():
        return scope
    for path in sorted(curated_dir.glob("*.json")):
        slug = path.stem
        doc = load_json(path)
        models = doc.get("models") or {}
        if not isinstance(models, dict):
            continue
        for mk, mv in models.items():
            if isinstance(mv, dict) and mv.get("include") is True:
                scope.add((slug, str(mk).upper()))
    return scope


def is_make_visible(slug: str, vis: dict[str, Any]) -> bool:
    makes = vis.get("makes") or {}
    entry = makes.get(slug)
    if isinstance(entry, dict) and entry.get("visible") is False:
        return False
    return True


def is_model_visible(slug: str, model_key: str, vis: dict[str, Any]) -> bool:
    makes = vis.get("makes") or {}
    m_entry = makes.get(slug)
    if not isinstance(m_entry, dict):
        return True
    models = m_entry.get("models") or {}
    if not isinstance(models, dict):
        return True
    mod = models.get(model_key)
    if isinstance(mod, dict) and mod.get("visible") is False:
        return False
    return True


def merge_years(base_years: list[int], ov: dict[str, Any]) -> list[int]:
    ys = set(int(y) for y in base_years if isinstance(y, int))
    for y in ov.get("years_add") or []:
        if isinstance(y, int):
            ys.add(y)
    for y in ov.get("years_remove") or []:
        if isinstance(y, int):
            ys.discard(y)
    return sorted(ys)


def merge_styles(
    base: dict[str, dict[str, Any]],
    ov: dict[str, Any],
    trim_aliases: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Merge curated style ops + trim key remapping. `base` maps style_key → {years:[...]}."""
    styles = copy.deepcopy(base)
    for sk in ov.get("styles_remove") or []:
        styles.pop(str(sk), None)
    rep = ov.get("styles_replace") or {}
    if isinstance(rep, dict):
        for sk, data in rep.items():
            if isinstance(data, dict) and isinstance(data.get("years"), list):
                styles[str(sk)] = {"years": sorted(int(y) for y in data["years"] if isinstance(y, int))}
    add = ov.get("styles_add") or {}
    if isinstance(add, dict):
        for sk, data in add.items():
            if isinstance(data, dict) and isinstance(data.get("years"), list):
                styles[str(sk)] = {"years": sorted(int(y) for y in data["years"] if isinstance(y, int))}

    styles = remap_trim_aliases(styles, trim_aliases)
    return styles


def remap_trim_aliases(
    styles: dict[str, dict[str, Any]],
    trims_map: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Rename style keys via aliases.trims (wrong_label → canonical)."""
    out: dict[str, dict[str, Any]] = {}
    for sk, val in styles.items():
        entry = trims_map.get(sk)
        nk = entry["canonical"] if isinstance(entry, dict) and isinstance(entry.get("canonical"), str) else sk
        if nk in out and isinstance(val, dict):
            ys = set(out[nk].get("years") or [])
            ys.update(val.get("years") or [])
            out[nk] = {"years": sorted(ys)}
        else:
            out[nk] = val
    return out


def recompute_model_years(model: dict[str, Any]) -> None:
    ys: set[int] = set()
    for y in model.get("years") or []:
        if isinstance(y, int):
            ys.add(y)
    for st in (model.get("model_styles") or {}).values():
        if isinstance(st, dict):
            for y in st.get("years") or []:
                if isinstance(y, int):
                    ys.add(y)
    model["years"] = sorted(ys)


def recompute_make_span(make: dict[str, Any]) -> None:
    ys: list[int] = []
    for m in (make.get("models") or {}).values():
        if isinstance(m, dict):
            ys.extend(m.get("years") or [])
    if ys:
        make["first_year"] = min(ys)
        make["last_year"] = max(ys)


def seed_styles_for_make(styles_dir: Path, slug: str) -> dict[str, dict[str, dict[str, Any]]]:
    """Load carry-forward styles/{slug}.json → {modelKey: {styleKey: {years}}} ."""
    path = styles_dir / f"{slug}.json"
    if not path.exists():
        return {}
    doc = load_json(path)
    if not isinstance(doc, dict):
        return {}
    out: dict[str, dict[str, dict[str, Any]]] = {}
    for mk, style_map in doc.items():
        if not isinstance(style_map, dict):
            continue
        inner: dict[str, dict[str, Any]] = {}
        for sk, st in style_map.items():
            if isinstance(st, dict) and isinstance(st.get("years"), list):
                inner[str(sk)] = {"years": sorted(int(y) for y in st["years"] if isinstance(y, int))}
        out[str(mk)] = inner
    return out


def project_open_vehicle(
    *,
    baseline_makes: list[dict[str, Any]],
    catalog_rows: list[dict[str, Any]],
    aliases: dict[str, Any],
    visibility: dict[str, Any],
    curated_dir: Path,
    seed_styles_from: Path | None,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, dict[str, Any]]]]:
    """Return (makes_and_models array, styles_by_slug for per-file JSON).

    `styles_by_slug[slug][model_key][style_key] = {years: [...]}`.
    """
    baseline_by_slug = index_baseline_by_slug(baseline_makes)
    catalog_scope = collect_catalog_scope(catalog_rows, baseline_by_slug, aliases)
    include_scope = collect_include_scope(curated_dir)
    allowed = catalog_scope | include_scope

    trims_map = aliases.get("trims") or {}

    # Logical component: deep-copy only makes that appear in the union scope.
    projected_makes: list[dict[str, Any]] = []
    styles_out: dict[str, dict[str, dict[str, Any]]] = {}

    for slug in sorted(baseline_by_slug.keys()):
        if not is_make_visible(slug, visibility):
            continue

        base_make = copy.deepcopy(baseline_by_slug[slug])
        curated_path = curated_dir / f"{slug}.json"
        curated = load_curated_override(curated_path) if curated_path.exists() else None

        seed_styles: dict[str, dict[str, dict[str, Any]]] = {}
        if seed_styles_from is not None:
            seed_styles = seed_styles_for_make(seed_styles_from, slug)

        models_out: dict[str, Any] = {}
        base_models = base_make.get("models") or {}

        # Logical component: drop models requested by curated file at make level.
        remove_models = set()
        if curated:
            for mk in curated.get("models_remove") or []:
                remove_models.add(str(mk).upper())

        for mk, mv in base_models.items():
            if not isinstance(mv, dict):
                continue
            mku = str(mk).upper()
            if mku in remove_models:
                continue
            if (slug, mku) not in allowed:
                continue
            if not is_model_visible(slug, str(mk), visibility):
                continue

            merged = copy.deepcopy(mv)
            ov = None
            if curated and isinstance(curated.get("models"), dict):
                ov = curated["models"].get(mk) or curated["models"].get(mk.upper())
            if isinstance(ov, dict):
                if isinstance(ov.get("model_name"), str):
                    merged["model_name"] = ov["model_name"]
                if isinstance(ov.get("vehicle_type"), str):
                    merged["vehicle_type"] = ov["vehicle_type"]
                merged["years"] = merge_years(list(merged.get("years") or []), ov)
                base_ms = {}
                if seed_styles_from:
                    base_ms = copy.deepcopy(seed_styles.get(str(mk), {}))
                elif isinstance(merged.get("model_styles"), dict):
                    base_ms = {
                        sk: {"years": list(st.get("years") or [])}
                        for sk, st in merged["model_styles"].items()
                        if isinstance(st, dict)
                    }
                    for sk in base_ms:
                        ys = base_ms[sk]["years"]
                        base_ms[sk]["years"] = sorted(int(y) for y in ys if isinstance(y, int))
                merged_ms = merge_styles(base_ms, ov, trims_map)
                merged["model_styles"] = merged_ms
            else:
                base_ms: dict[str, dict[str, Any]] = {}
                if seed_styles_from:
                    base_ms = copy.deepcopy(seed_styles.get(str(mk), {}))
                elif isinstance(merged.get("model_styles"), dict):
                    base_ms = {
                        sk: {"years": sorted(int(y) for y in (st.get("years") or []) if isinstance(y, int))}
                        for sk, st in merged["model_styles"].items()
                        if isinstance(st, dict)
                    }
                merged["model_styles"] = remap_trim_aliases(base_ms, trims_map)

            recompute_model_years(merged)
            models_out[str(mk)] = merged

        # Logical component: include-only models not present in baseline.
        if curated and isinstance(curated.get("models"), dict):
            for mk, ov in curated["models"].items():
                if not isinstance(ov, dict) or ov.get("include") is not True:
                    continue
                if str(mk).upper() in models_out:
                    continue
                if (slug, str(mk).upper()) not in allowed:
                    continue
                new_m = {
                    "model_id": int(ov["model_id"]) if isinstance(ov.get("model_id"), int) else 0,
                    "model_name": str(ov.get("model_name", mk)),
                    "vehicle_type": str(ov.get("vehicle_type", "car")),
                    "years": sorted({int(y) for y in (ov.get("years_add") or []) if isinstance(y, int)}),
                    "model_styles": merge_styles({}, ov, trims_map),
                }
                recompute_model_years(new_m)
                models_out[str(mk)] = new_m

        if not models_out:
            continue

        base_make["models"] = {k: models_out[k] for k in sorted(models_out.keys())}
        for m in base_make["models"].values():
            if isinstance(m, dict):
                recompute_model_years(m)
        recompute_make_span(base_make)
        projected_makes.append(base_make)

        # Logical component: flatten model_styles → styles/*.json shape.
        styles_by_model: dict[str, dict[str, Any]] = {}
        for mk, mv in base_make["models"].items():
            if isinstance(mv, dict) and isinstance(mv.get("model_styles"), dict):
                styles_by_model[str(mk)] = copy.deepcopy(mv["model_styles"])
        styles_out[slug] = styles_by_model

    return projected_makes, styles_out


def sort_makes_array(makes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Alphabetical by make_slug; models + style keys sorted."""
    out = []
    for make in sorted(makes, key=lambda m: str(m.get("make_slug", ""))):
        mcopy = copy.deepcopy(make)
        md = mcopy.get("models") or {}
        if isinstance(md, dict):
            new_models = {}
            for mk in sorted(md.keys()):
                mdl = md[mk]
                if isinstance(mdl, dict) and isinstance(mdl.get("model_styles"), dict):
                    ms = {
                        sk: {"years": sorted(st.get("years") or [])}
                        for sk, st in sorted(mdl["model_styles"].items())
                        if isinstance(st, dict)
                    }
                    mdl["model_styles"] = ms
                new_models[mk] = mdl
            mcopy["models"] = new_models
        out.append(mcopy)
    return out
