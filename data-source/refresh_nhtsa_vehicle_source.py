#!/usr/bin/env python3
"""
Logical component: operator entry point for the NHTSA refresh pipeline.

Step 4 surface (this file): only the `plan` subcommand is exposed. `plan` is
network-free and write-free — it walks the cache manifest and the COMSCC
catalog and prints what `update` *would* do, classified per the per-class
TTL table. `bootstrap` / `update` / `styles-only` / `models-only` land in
later steps; the argparse skeleton has space for them so the runbook never
changes shape under operators.

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
from typing import Any, Iterable, Mapping

# Logical component: when invoked as a script the package isn't on sys.path.
_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

from vpic_cache import (  # noqa: E402  (sys.path mutation above)
    ENDPOINT_MAKES,
    ENDPOINT_MODELS,
    ENDPOINT_SPECS,
    TTLPolicy,
    VpicCache,
    classify_many,
)


# Logical component: env-var escape hatch. Documented in the operator README.
SKIP_ENV_VAR = "SKIP_OPEN_VEHICLE_SYNC"


def is_skip_requested() -> bool:
    return os.environ.get(SKIP_ENV_VAR, "").strip() not in ("", "0", "false", "False")


# Logical component: catalog → planned requests. Identity make/model only;
# alias resolution lives in step 5+ and slots in here without changing the shape.
_REPO_ROOT = _THIS_DIR.parent
_DEFAULT_CATALOG = _REPO_ROOT / "rules-source" / "vehicles-comscc-catalog.json"


def load_catalog_rows(catalog_path: Path) -> list[dict[str, Any]]:
    if not catalog_path.exists():
        return []
    with catalog_path.open(encoding="utf-8") as f:
        doc = json.load(f)
    rows = doc.get("vehicleCatalog") or []
    return [r for r in rows if isinstance(r, dict)]


def planned_requests(
    *,
    catalog_rows: Iterable[Mapping[str, Any]],
    year_from: int,
    year_to: int,
    recent_years: int,
    current_year: int,
) -> list[tuple[str, dict[str, Any]]]:
    """Build the (endpoint, params) list `update` would issue.

    update semantics:
    - Always fetch makes (cheap and cache-respecting).
    - Fetch models for `[currentYear - recent_years + 1 .. currentYear]` for every make
      that appears in the catalog.
    - Fetch Canadian specs for every (year, make, model) span in the catalog,
      bounded by `year_from..year_to`.
    """
    requests: list[tuple[str, dict[str, Any]]] = []

    requests.append((ENDPOINT_MAKES, {"vehicleType": "car"}))

    catalog_makes: set[str] = set()
    for row in catalog_rows:
        make = row.get("vehicleMake") or row.get("make")
        if isinstance(make, str) and make.strip():
            catalog_makes.add(make.strip())

    recent_lo = max(year_from, current_year - recent_years + 1)
    recent_hi = min(year_to, current_year)
    for make in sorted(catalog_makes):
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


# Logical component: subcommand entry — `plan`. No network, no writes.
def cmd_plan(args: argparse.Namespace) -> int:
    cache = VpicCache(args.cache_dir)
    manifest = cache.load_manifest()
    policy = TTLPolicy(current_year=args.current_year)

    catalog_rows = load_catalog_rows(args.catalog)
    requests = planned_requests(
        catalog_rows=catalog_rows,
        year_from=args.year_from,
        year_to=args.year_to,
        recent_years=args.recent_years,
        current_year=args.current_year,
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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="refresh_nhtsa_vehicle_source.py",
        description="NHTSA VPIC refresh entry point. Step 4 only exposes `plan` (offline).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    plan = sub.add_parser("plan", help="Show what `update` would fetch (offline).")
    _add_plan_options(plan)
    plan.set_defaults(func=cmd_plan)

    return parser


def main(argv: list[str] | None = None) -> int:
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
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
