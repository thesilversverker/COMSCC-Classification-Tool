#!/usr/bin/env python3
"""
Logical component: operator entry point for the NHTSA refresh pipeline.

`bootstrap` / `update` fetch `GetMakesForVehicleType(car)` first, then fan out
`GetModelsForMakeYear` for **every VPIC passenger-car make** (default) or for
**catalog makes only** (`--model-makes catalog`). `plan` is offline: it
classifies the same request set (using a cached makes body when available).

Top-level guarantees:
- `SKIP_OPEN_VEHICLE_SYNC=1` exits 0 immediately, regardless of subcommand
  or arguments. Defense in depth so CI containers cannot accidentally hit
  NHTSA.
- No subcommand performs any disk write outside the cache directory.
- Default invocation is offline: `plan` never constructs a network transport.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Callable, Iterable, Literal, Mapping

# Logical component: when invoked as a script the package isn't on sys.path.
_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

from json_io import write_json  # noqa: E402  (sys.path mutation above)
from nhtsa_source import (  # noqa: E402
    build_nhtsa_catalog_style_details,
    build_nhtsa_makes_models,
    build_source_manifest,
    build_validation_report,
    parse_or_record_issue,
    response_set_hash,
)
from vpic_cache import (  # noqa: E402
    ENDPOINT_MAKES,
    ENDPOINT_MODELS,
    ENDPOINT_SPECS,
    TTLPolicy,
    VpicCache,
    cache_dir_lock,
    classify_many,
)
from vpic_client import (  # noqa: E402
    FailRateExceeded,
    FetchOutcome,
    VpicClient,
    httpx_transport,
    parse_outcome_body,
)
from vpic_models import (  # noqa: E402
    CanadianSpecsEnvelope,
    MakesEnvelope,
    ModelsEnvelope,
)


# Logical component: env-var escape hatch. Documented in the operator README.
SKIP_ENV_VAR = "SKIP_OPEN_VEHICLE_SYNC"


def is_skip_requested() -> bool:
    return os.environ.get(SKIP_ENV_VAR, "").strip() not in ("", "0", "false", "False")


# Logical component: catalog → planned requests. Identity make/model only;
# alias resolution lives in step 6+ and slots in here without changing the shape.
_REPO_ROOT = _THIS_DIR.parent
_DEFAULT_CATALOG = _REPO_ROOT / "rules-source" / "vehicles-comscc-catalog.json"
_DEFAULT_OUT_DIR = _REPO_ROOT / "rules-source" / "open-vehicle" / "nhtsa-source"

ModelMakesMode = Literal["all", "catalog"]


def load_catalog_rows(catalog_path: Path) -> list[dict[str, Any]]:
    if not catalog_path.exists():
        return []
    with catalog_path.open(encoding="utf-8") as f:
        doc = json.load(f)
    rows = doc.get("vehicleCatalog") or []
    return [r for r in rows if isinstance(r, dict)]


def _catalog_derived_make_names(rows: Iterable[Mapping[str, Any]]) -> list[str]:
    return sorted({_get_str(r, "vehicleMake", "make") for r in rows} - {None})


def load_cached_makes_envelope(cache: VpicCache) -> MakesEnvelope | None:
    """Best-effort parse of the newest cached GetMakesForVehicleType(car) body."""
    manifest = cache.load_manifest()
    for entry in manifest.values():
        if entry.endpoint != ENDPOINT_MAKES:
            continue
        if entry.status != 200:
            continue
        try:
            body = json.loads(cache.read_body(entry).decode("utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            continue
        try:
            return MakesEnvelope.model_validate(body)
        except Exception:
            continue
    return None


def merge_fetch_outcome_into_manifest(cache: VpicCache, outcome: FetchOutcome) -> None:
    """Persist a single fetch into the manifest so later phases see it like fetch_many."""
    if outcome.entry is None:
        return
    manifest = cache.load_manifest()
    manifest[outcome.cache_key] = outcome.entry
    cache.save_manifest(manifest)


def makes_envelope_from_outcome(cache: VpicCache, outcome: FetchOutcome) -> MakesEnvelope | None:
    body = parse_outcome_body(outcome, cache)
    if body is None:
        return None
    try:
        return MakesEnvelope.model_validate(body)
    except Exception:
        return None


def resolve_model_make_names_for_refresh(
    *,
    mode: ModelMakesMode,
    catalog_rows: list[dict[str, Any]],
    makes_env: MakesEnvelope,
) -> list[str]:
    """Layer 2 model fan-out: all VPIC passenger-car makes, or catalog makes only."""
    if mode == "catalog":
        return _catalog_derived_make_names(catalog_rows)
    return sorted({r.make_name.strip() for r in makes_env.results if r.make_name.strip()})


def resolve_model_make_names_for_plan(
    *,
    mode: ModelMakesMode,
    catalog_rows: list[dict[str, Any]],
    cache: VpicCache,
) -> list[str]:
    """Offline plan: use cached makes envelope when mode is all, else catalog-only fallback + warning."""
    if mode == "catalog":
        return _catalog_derived_make_names(catalog_rows)
    env = load_cached_makes_envelope(cache)
    if env is not None:
        return sorted({r.make_name.strip() for r in env.results if r.make_name.strip()})
    sys.stderr.write(
        "warning: plan --model-makes all: no cached GetMakesForVehicleType(car) response; "
        "model rows estimated using catalog makes only (populate cache via bootstrap for full counts).\n"
    )
    return _catalog_derived_make_names(catalog_rows)


def planned_requests(
    *,
    catalog_rows: Iterable[Mapping[str, Any]],
    year_from: int,
    year_to: int,
    recent_years: int,
    current_year: int,
    model_make_names: list[str],
) -> list[tuple[str, dict[str, Any]]]:
    """Build the (endpoint, params) list `plan` classifies (offline).

    update semantics:
    - Always includes makes (cheap and cache-respecting).
    - Model requests: every name in `model_make_names` × recent-year window
      (default source: all VPIC passenger-car makes when operator uses --model-makes all).
    - Fetch Canadian specs for every (year, make, model) span in the catalog,
      bounded by `year_from..year_to`.
    """
    requests: list[tuple[str, dict[str, Any]]] = []

    requests.append((ENDPOINT_MAKES, {"vehicleType": "car"}))

    recent_lo = max(year_from, current_year - recent_years + 1)
    recent_hi = min(year_to, current_year)
    for make in model_make_names:
        for year in range(recent_lo, recent_hi + 1):
            requests.append((ENDPOINT_MODELS, {"make": make, "year": year}))

    for row in catalog_rows:
        make = row.get("vehicleMake") or row.get("make")
        model = row.get("vehicleModel") or row.get("model")
        y_begin = row.get("vehicleYearBegin") or row.get("startYear")
        y_end = row.get("vehicleYearEnd") or row.get("endYear")
        if not (isinstance(make, str) and isinstance(model, str)):
            continue
        try:
            y_begin = int(y_begin)
            y_end = int(y_end)
        except (TypeError, ValueError):
            continue
        lo = max(year_from, y_begin)
        hi = min(year_to, y_end)
        for year in range(lo, hi + 1):
            requests.append(
                (ENDPOINT_SPECS, {"year": year, "make": make, "model": model, "units": "Metric"})
            )
    return requests


# Logical component: report formatting (human + machine).
def _summarize(buckets: dict[str, list[tuple[str, Mapping[str, Any]]]]) -> dict[str, Any]:
    summary: dict[str, Any] = {"totals": {}, "byEndpoint": {}}
    for name, items in buckets.items():
        summary["totals"][name] = len(items)
        per_endpoint = Counter(ep for ep, _ in items)
        for ep, count in per_endpoint.items():
            summary["byEndpoint"].setdefault(ep, {})[name] = count
    return summary


def _format_text(summary: dict[str, Any]) -> str:
    lines: list[str] = []
    totals = summary["totals"]
    lines.append("VPIC refresh plan")
    lines.append(
        f"  total: {sum(totals.values())} "
        f"(missing={totals.get('missing', 0)}, "
        f"cached-stale={totals.get('cached-stale', 0)}, "
        f"cached-fresh={totals.get('cached-fresh', 0)})"
    )
    by_ep = summary["byEndpoint"]
    for ep in sorted(by_ep):
        row = by_ep[ep]
        lines.append(
            f"  {ep}: missing={row.get('missing', 0)}, "
            f"cached-stale={row.get('cached-stale', 0)}, "
            f"cached-fresh={row.get('cached-fresh', 0)}"
        )
    return "\n".join(lines)


# Logical component: bootstrap / update — model + spec requests only (makes fetched
# in a first phase so we can enumerate all passenger-car makes when mode is `all`).
def refresh_request_set(
    *,
    refresh_mode: str,
    catalog_rows: Iterable[Mapping[str, Any]],
    year_from: int,
    year_to: int,
    recent_years: int,
    current_year: int,
    model_make_names: list[str],
) -> list[tuple[str, dict[str, Any]]]:
    """Return model + spec requests. Caller fetches GetMakesForVehicleType separately.

    bootstrap → models for [year_from..year_to] for every name in `model_make_names`.
    update    → models for [current_year - recent_years + 1 .. current_year] only.
    """
    rows = list(catalog_rows)
    if refresh_mode == "bootstrap":
        model_lo, model_hi = year_from, year_to
    elif refresh_mode == "update":
        model_lo = max(year_from, current_year - recent_years + 1)
        model_hi = min(year_to, current_year)
    else:
        raise ValueError(f"unknown refresh_mode: {refresh_mode}")

    requests: list[tuple[str, dict[str, Any]]] = []

    for make in model_make_names:
        for year in range(model_lo, model_hi + 1):
            requests.append((ENDPOINT_MODELS, {"make": make, "year": year}))

    for r in rows:
        make = _get_str(r, "vehicleMake", "make")
        model = _get_str(r, "vehicleModel", "model")
        y_begin = _get_int(r, "vehicleYearBegin", "startYear")
        y_end = _get_int(r, "vehicleYearEnd", "endYear")
        if not (make and model and y_begin is not None and y_end is not None):
            continue
        lo = max(year_from, y_begin)
        hi = min(year_to, y_end)
        for year in range(lo, hi + 1):
            requests.append(
                (ENDPOINT_SPECS, {"year": year, "make": make, "model": model, "units": "Metric"})
            )
    return requests


def _get_str(row: Mapping[str, Any], *keys: str) -> str | None:
    for k in keys:
        v = row.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _get_int(row: Mapping[str, Any], *keys: str) -> int | None:
    for k in keys:
        v = row.get(k)
        try:
            return int(v)
        except (TypeError, ValueError):
            continue
    return None


# Logical component: pluggable client factory. Tests inject a stub-transport
# client; production builds an httpx-backed one. Either way, callers get a
# fully-configured VpicClient bound to the given cache.
ClientFactory = Callable[[argparse.Namespace, VpicCache], VpicClient]


def _default_client_factory(args: argparse.Namespace, cache: VpicCache) -> VpicClient:
    import httpx

    httpx_client = httpx.Client(http2=False, timeout=args.timeout)
    return VpicClient(
        cache=cache,
        transport=httpx_transport(httpx_client),
        max_workers=args.max_workers,
        max_rps=args.max_rps,
        max_fail_rate=args.max_fail_rate,
        timeout=args.timeout,
    )


# Logical component: per-request body parser. We could parse all responses then
# build, but doing it lazily lets us record one issue per malformed body without
# aborting the whole refresh.
def _load_envelopes(
    cache: VpicCache,
    *,
    issues: list[dict],
) -> tuple[MakesEnvelope | None, list[tuple[int, ModelsEnvelope]], list[tuple[int, str, str, CanadianSpecsEnvelope]]]:
    manifest = cache.load_manifest()
    makes_env: MakesEnvelope | None = None
    models_per_year: list[tuple[int, ModelsEnvelope]] = []
    specs_per_tuple: list[tuple[int, str, str, CanadianSpecsEnvelope]] = []

    for entry in manifest.values():
        if entry.status != 200:
            continue
        body = json.loads(cache.read_body(entry).decode("utf-8"))
        if entry.endpoint == ENDPOINT_MAKES:
            env = parse_or_record_issue(
                MakesEnvelope, body, issue_bucket=issues, context={"endpoint": entry.endpoint}
            )
            if env is not None:
                makes_env = env
        elif entry.endpoint == ENDPOINT_MODELS:
            env = parse_or_record_issue(
                ModelsEnvelope,
                body,
                issue_bucket=issues,
                context={"endpoint": entry.endpoint, **entry.params},
            )
            if env is not None:
                year = int(entry.params.get("year", 0))
                models_per_year.append((year, env))
        elif entry.endpoint == ENDPOINT_SPECS:
            env = parse_or_record_issue(
                CanadianSpecsEnvelope,
                body,
                issue_bucket=issues,
                context={"endpoint": entry.endpoint, **entry.params},
            )
            if env is not None:
                specs_per_tuple.append(
                    (
                        int(entry.params.get("year", 0)),
                        str(entry.params.get("make", "")),
                        str(entry.params.get("model", "")),
                        env,
                    )
                )
    return makes_env, models_per_year, specs_per_tuple


def _empty_detail_issues(specs_per_tuple, severity: str = "warning") -> list[dict]:
    return [
        {
            "severity": severity,
            "message": "VPIC returned no Canadian-spec rows for this tuple",
            "year": year,
            "make": make,
            "model": model,
        }
        for year, make, model, env in specs_per_tuple
        if not env.results
    ]


# Logical component: shared bootstrap/update body. Acquires the cache lock,
# fetches the request set, parses, validates, writes Layer 2 + manifest +
# validation report. No Layer 3 writes.
def _run_refresh(args: argparse.Namespace, refresh_mode: str, client_factory: ClientFactory) -> int:
    catalog_rows = load_catalog_rows(args.catalog)

    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    issues: list[dict] = []

    with cache_dir_lock(args.cache_dir, mode=args.lock_mode):
        cache = VpicCache(args.cache_dir)
        client = client_factory(args, cache)

        # Logical component: fetch makes first so `all` mode can enumerate every VPIC car make.
        makes_outcome = client.fetch(ENDPOINT_MAKES, {"vehicleType": "car"})
        merge_fetch_outcome_into_manifest(cache, makes_outcome)
        makes_env = makes_envelope_from_outcome(cache, makes_outcome)
        if makes_env is None:
            sys.stderr.write("ERROR: GetMakesForVehicleType(car) did not yield a parseable envelope.\n")
            return 3

        model_make_names = resolve_model_make_names_for_refresh(
            mode=args.model_makes,
            catalog_rows=catalog_rows,
            makes_env=makes_env,
        )
        requests = refresh_request_set(
            refresh_mode=refresh_mode,
            catalog_rows=catalog_rows,
            year_from=args.year_from,
            year_to=args.year_to,
            recent_years=args.recent_years,
            current_year=args.current_year,
            model_make_names=model_make_names,
        )

        client.fetch_many(requests)

        try:
            client.assert_fail_rate_under_limit()
        except FailRateExceeded as e:
            sys.stderr.write(f"ERROR: {e}\n")
            sys.stderr.write("Layer 2 not written. Re-run when VPIC is healthier.\n")
            return 2

        makes_env, models_per_year, specs_per_tuple = _load_envelopes(cache, issues=issues)

        if makes_env is None:
            sys.stderr.write("ERROR: no makes envelope present in cache; refresh aborted.\n")
            return 3

        # Logical component: build Layer 2 docs (each builder validates against
        # its schema; failures raise SchemaValidationError before any disk write).
        nhtsa_makes_models = build_nhtsa_makes_models(
            makes=makes_env, models_per_year=models_per_year
        )
        nhtsa_details = build_nhtsa_catalog_style_details(specs_per_tuple=specs_per_tuple)

        manifest_entries = cache.load_manifest()
        rsh = response_set_hash(
            (k, e.response_sha256) for k, e in manifest_entries.items()
        )
        input_files = {"vehiclesComsccCatalog": Path(args.catalog)}
        source_manifest = build_source_manifest(
            refresh_mode=refresh_mode,
            year_from=args.year_from,
            year_to=args.year_to,
            current_year=args.current_year,
            input_files=input_files,
            vpic_total=client.total,
            vpic_failures=client.failures,
            vpic_response_set_hash=rsh,
        )

        # Logical component: collect every issue category we know about now;
        # step 6 (projection) appends alias / shrink issues to the same shape.
        issues_by_bucket = {"emptyDetailTuples": _empty_detail_issues(specs_per_tuple)}
        if issues:
            issues_by_bucket.setdefault("staleAliases", []).extend(issues)

        counts = _per_make_counts(nhtsa_makes_models)
        validation = build_validation_report(issues=issues_by_bucket, counts=counts)

        # Logical component: write all four files atomically — each one
        # individually safe via os.replace inside json_io.write_json.
        write_json(out_dir / "nhtsa-makes-models-source.json", nhtsa_makes_models)
        write_json(out_dir / "nhtsa-catalog-style-details-source.json", nhtsa_details)
        write_json(out_dir / "source-manifest.json", source_manifest)
        write_json(out_dir / "validation-report.json", validation)

    if args.json:
        json.dump(
            {
                "refreshMode": refresh_mode,
                "totals": {"requests": client.total, "failures": client.failures},
                "outDir": str(out_dir),
            },
            sys.stdout,
            indent=2,
        )
        sys.stdout.write("\n")
    else:
        sys.stdout.write(
            f"{refresh_mode} complete: {client.total} requests "
            f"({client.failures} failures), Layer 2 → {out_dir}\n"
        )
    return 0


def _per_make_counts(nhtsa_makes_models: dict) -> dict[str, dict[str, int]]:
    """Count models + style placeholders per make for the validation report."""
    out: dict[str, dict[str, int]] = {}
    for make in nhtsa_makes_models.get("makes", []):
        slug = make.get("make_slug")
        if not isinstance(slug, str):
            continue
        models = make.get("models", {})
        out[slug] = {"models": len(models), "styles": 0}
    return out


def cmd_bootstrap(args: argparse.Namespace) -> int:
    return _run_refresh(args, "bootstrap", args.client_factory)


def cmd_update(args: argparse.Namespace) -> int:
    return _run_refresh(args, "update", args.client_factory)


# Logical component: subcommand entry — `plan`. No network, no writes.
def cmd_plan(args: argparse.Namespace) -> int:
    cache = VpicCache(args.cache_dir)
    manifest = cache.load_manifest()
    policy = TTLPolicy(current_year=args.current_year)

    catalog_rows = load_catalog_rows(args.catalog)
    model_make_names = resolve_model_make_names_for_plan(
        mode=args.model_makes,
        catalog_rows=catalog_rows,
        cache=cache,
    )
    requests = planned_requests(
        catalog_rows=catalog_rows,
        year_from=args.year_from,
        year_to=args.year_to,
        recent_years=args.recent_years,
        current_year=args.current_year,
        model_make_names=model_make_names,
    )

    buckets = classify_many(
        requests,
        manifest=manifest,
        policy=policy,
        run_at=args.run_at,
        ignore_ttl=args.ignore_ttl,
    )
    summary = _summarize(buckets)

    if args.json:
        json.dump(summary, sys.stdout, indent=2)
        sys.stdout.write("\n")
    else:
        sys.stdout.write(_format_text(summary) + "\n")
    return 0


# Logical component: argparse plumbing. Flags live on each subparser (git/docker
# convention: `script subcommand --flag`); the top-level parser only routes.
def _add_plan_options(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--cache-dir",
        type=Path,
        default=_REPO_ROOT / "data-source" / ".cache" / "vpic",
        help="Cache directory (default: data-source/.cache/vpic). Gitignored.",
    )
    p.add_argument(
        "--catalog",
        type=Path,
        default=_DEFAULT_CATALOG,
        help="Path to vehicles-comscc-catalog.json (default: rules-source/vehicles-comscc-catalog.json).",
    )
    p.add_argument(
        "--year-from", type=int, default=1985, help="Earliest model year to plan (default: 1985)."
    )
    p.add_argument(
        "--year-to",
        type=int,
        default=dt.date.today().year,
        help="Latest model year to plan (default: current year).",
    )
    p.add_argument(
        "--recent-years",
        type=int,
        default=3,
        help="Window of recent years to refresh model lists for (default: 3).",
    )
    p.add_argument(
        "--current-year",
        type=int,
        default=dt.date.today().year,
        help="Override current year (testing).",
    )
    p.add_argument(
        "--run-at",
        type=float,
        default=None,
        help="Override run timestamp (epoch seconds). Mostly for tests.",
    )
    p.add_argument(
        "--ignore-ttl",
        action="store_true",
        help="Treat every cached entry as fresh (bypass per-class TTL policy).",
    )
    p.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    p.add_argument(
        "--model-makes",
        choices=("all", "catalog"),
        default="all",
        help=(
            "Which make names to multiply GetModelsForMakeYear by: "
            "`all` = every VPIC passenger-car make from GetMakesForVehicleType (default); "
            "`catalog` = only makes appearing in the COMSCC catalog (legacy, fewer requests)."
        ),
    )


def _add_refresh_options(p: argparse.ArgumentParser) -> None:
    """Flags shared by bootstrap and update — VpicClient tuning + lock + I/O paths."""
    _add_plan_options(p)
    p.add_argument(
        "--out-dir",
        type=Path,
        default=_DEFAULT_OUT_DIR,
        help="Layer 2 output directory (default: rules-source/open-vehicle/nhtsa-source).",
    )
    p.add_argument("--max-workers", type=int, default=6, help="Concurrent in-flight requests cap.")
    p.add_argument("--max-rps", type=float, default=5.0, help="Token-bucket requests-per-second.")
    p.add_argument(
        "--max-fail-rate",
        type=float,
        default=0.02,
        help="Fail rate above which Layer 2 will not be written (default 2%%).",
    )
    p.add_argument("--timeout", type=float, default=20.0, help="Per-request timeout in seconds.")
    p.add_argument(
        "--lock-mode",
        choices=("fail", "wait"),
        default="fail",
        help="Cache lock mode (default fail; second concurrent run aborts).",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="refresh_nhtsa_vehicle_source.py",
        description="NHTSA VPIC refresh entry point: plan (offline), bootstrap, update.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    plan = sub.add_parser("plan", help="Show what `update` would fetch (offline).")
    _add_plan_options(plan)
    plan.set_defaults(func=cmd_plan)

    bootstrap = sub.add_parser(
        "bootstrap",
        help=(
            "Full refresh: GetMakesForVehicleType(car), then models for each year window × "
            "every VPIC car make (default) or catalog makes only (--model-makes catalog), "
            "plus Canadian specs for each catalog tuple."
        ),
    )
    _add_refresh_options(bootstrap)
    bootstrap.set_defaults(func=cmd_bootstrap)

    update = sub.add_parser(
        "update",
        help=(
            "Delta refresh: makes + models for the recent-year window × each VPIC car make "
            "(default) or catalog makes only, plus Canadian specs for catalog tuples."
        ),
    )
    _add_refresh_options(update)
    update.set_defaults(func=cmd_update)

    return parser


def main(argv: list[str] | None = None, *, client_factory: ClientFactory | None = None) -> int:
    """Entry point. `client_factory` is the test injection seam for VpicClient."""
    if is_skip_requested():
        # Logical component: documented escape hatch. Stays silent on stdout so
        # script output remains parseable when it runs as a no-op.
        sys.stderr.write(f"{SKIP_ENV_VAR} set; skipping NHTSA refresh.\n")
        return 0

    parser = build_parser()
    args = parser.parse_args(argv)
    if args.run_at is None:
        import time

        args.run_at = time.time()
    args.client_factory = client_factory or _default_client_factory
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
