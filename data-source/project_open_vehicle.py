#!/usr/bin/env python3
"""
Logical component: offline projection CLI — rebuild Layer 3 open-vehicle outputs into
`rules-source/open-vehicle/_proposed/` for human diff review before cutover.

Reads Layer 2 baseline + COMSCC catalog + aliases + visibility + curated-overrides,
never touches the network. Uses `json_io.write_json` for deterministic bytes.

Exit 0 on success; `--verify` validates inputs + would-write shapes without creating files.
`--strict` fails the run when any `vehicleCatalog` row with a non-empty make+model
cannot be resolved to baseline (after aliases). Without `--strict`, unresolved rows
only emit a stderr warning (plan §Validation gates).
Every `curated-overrides/*.json` is validated against `curated-override.schema.json`
before projection runs. Writes `validation-report.json`: catalog resolution buckets,
stale-alias hints, projected per-make counts, and **`issues.baselineShrinkViolations`**
when `--compare-baseline` is used (plus an info row when the numeric shrink check is
skipped because `baseline-counts.json` lacks `aggregationSource: projected`).
Optional `--compare-baseline` compares projected counts to `baseline-counts.json` when
aggregation is **`projected`** (reseed with `seed_baseline_counts.py --from-proposed`).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

from json_io import read_json, write_json  # noqa: E402
from nhtsa_source import build_validation_report  # noqa: E402
from open_vehicle_projection import (  # noqa: E402
    catalog_failures_to_issue_rows,
    index_baseline_by_slug,
    list_catalog_resolution_failures,
    list_stale_alias_issues,
    load_aliases,
    load_baseline_makes,
    load_visibility,
    projected_counts_from_styles,
    project_open_vehicle,
    shrink_violations_vs_baseline,
    sort_makes_array,
)
from schemas import validate_or_raise  # noqa: E402

_REPO_ROOT = _THIS_DIR.parent
_DEFAULT_BASELINE_NHTSA = (
    _REPO_ROOT / "rules-source" / "open-vehicle" / "nhtsa-source" / "nhtsa-makes-models-source.json"
)
_DEFAULT_BASELINE_FALLBACK = _REPO_ROOT / "rules-source" / "open-vehicle" / "makes_and_models.json"
_DEFAULT_CATALOG = _REPO_ROOT / "rules-source" / "vehicles-comscc-catalog.json"
_DEFAULT_ALIASES = _REPO_ROOT / "rules-source" / "open-vehicle" / "aliases.json"
_DEFAULT_VISIBILITY = _REPO_ROOT / "rules-source" / "open-vehicle" / "visibility-overrides.json"
_DEFAULT_CURATED = _REPO_ROOT / "rules-source" / "open-vehicle" / "curated-overrides"
_DEFAULT_SEED_STYLES = _REPO_ROOT / "rules-source" / "open-vehicle" / "styles"
_DEFAULT_OUT = _REPO_ROOT / "rules-source" / "open-vehicle" / "_proposed"
_DEFAULT_BASELINE_COUNTS = _REPO_ROOT / "rules-source" / "open-vehicle" / "baseline-counts.json"


def cmd_project(args: argparse.Namespace) -> int:
    baseline = load_baseline_makes(args.baseline_nhtsa, args.baseline_fallback)
    catalog_doc = read_json(args.catalog)
    catalog_rows = catalog_doc.get("vehicleCatalog") or []
    if not isinstance(catalog_rows, list):
        raise SystemExit("catalog.vehicleCatalog must be an array")

    aliases = load_aliases(args.aliases)
    visibility = load_visibility(args.visibility)

    validate_or_raise("aliases", aliases, context=str(args.aliases))
    validate_or_raise("visibility_overrides", visibility, context=str(args.visibility))

    # Logical component: every committed curated-overrides/<slug>.json must match schema.
    if args.curated_dir.exists():
        for path in sorted(args.curated_dir.glob("*.json")):
            doc = read_json(path)
            validate_or_raise("curated_override", doc, context=str(path))

    baseline_by_slug = index_baseline_by_slug(baseline)
    failures = list_catalog_resolution_failures(catalog_rows, baseline_by_slug, aliases)
    if failures:
        detail = "\n".join(
            f"  [{x['index']}] {x['vehicleMake']!r} / {x['vehicleModel']!r} — {x['reason']}"
            for x in failures[:40]
        )
        tail = "" if len(failures) <= 40 else f"\n  … and {len(failures) - 40} more"
        msg = (
            f"{len(failures)} catalog row(s) did not resolve to baseline make/model "
            f"(after aliases); see plan §Validation gates — strict catalog resolution.\n"
            f"{detail}{tail}"
        )
        if args.strict:
            print(msg, file=sys.stderr)
            return 1
        print(f"warning: {msg}", file=sys.stderr)

    makes_out, styles_by_slug = project_open_vehicle(
        baseline_makes=baseline,
        catalog_rows=catalog_rows,
        aliases=aliases,
        visibility=visibility,
        curated_dir=args.curated_dir,
        seed_styles_from=args.seed_styles if args.carry_styles else None,
    )
    makes_out = sort_makes_array(makes_out)

    validate_or_raise("makes_and_models", makes_out, context="<projected makes_and_models>")

    um_make, um_model = catalog_failures_to_issue_rows(failures)
    stale_rows = list_stale_alias_issues(aliases, baseline_by_slug)
    counts = projected_counts_from_styles(styles_by_slug)

    baseline_shrink_rows: list[dict] = []
    shrink_numeric_violations: list[str] = []

    if args.compare_baseline:
        baseline_doc = read_json(args.baseline_counts)
        validate_or_raise("baseline_counts", baseline_doc, context=str(args.baseline_counts))
        agg = baseline_doc.get("aggregationSource")
        if agg != "projected" and not args.compare_baseline_unsafe:
            baseline_shrink_rows.append(
                {
                    "severity": "info",
                    "message": (
                        "compare-baseline numeric check skipped: aggregationSource is not 'projected'. "
                        "Reseed with seed_baseline_counts.py --from-proposed, or use --compare-baseline-unsafe."
                    ),
                }
            )
            print(
                "note: --compare-baseline skipped: baseline-counts.json aggregationSource is not "
                "'projected'. Reseed with `python data-source/seed_baseline_counts.py --from-proposed` "
                "after a reviewed _proposed/ run, or pass --compare-baseline-unsafe to compare against "
                "full-styles baselines (expected noisy for catalog-scoped output).",
                file=sys.stderr,
            )
        else:
            shrink_numeric_violations = shrink_violations_vs_baseline(
                counts,
                baseline_doc,
                max_shrink_pct=args.max_shrink_pct,
            )
            for line in shrink_numeric_violations:
                baseline_shrink_rows.append({"severity": "warning", "message": line})
            if shrink_numeric_violations and not args.compare_baseline_fatal:
                print(
                    f"warning: baseline shrink check ({args.max_shrink_pct}% rule):\n"
                    + "\n".join(shrink_numeric_violations)
                    + "\n",
                    file=sys.stderr,
                )

    validation_report = build_validation_report(
        issues={
            "unmatchedCatalogMakes": um_make,
            "unmatchedCatalogModels": um_model,
            "emptyDetailTuples": [],
            "ambiguousMatches": [],
            "staleAliases": stale_rows,
            "baselineShrinkViolations": baseline_shrink_rows,
        },
        counts=counts,
    )
    validate_or_raise("validation_report", validation_report, context="<projection validation_report>")

    if args.compare_baseline and args.compare_baseline_fatal and shrink_numeric_violations:
        print("\n".join(shrink_numeric_violations), file=sys.stderr)
        return 1

    if args.verify:
        print(
            f"verify OK: {len(makes_out)} makes, {len(styles_by_slug)} style files; "
            f"validation-report ({len(failures)} catalog misses, {len(stale_rows)} stale alias hints)"
        )
        return 0

    args.out_dir.mkdir(parents=True, exist_ok=True)
    styles_dir = args.out_dir / "styles"
    styles_dir.mkdir(parents=True, exist_ok=True)

    write_json(args.out_dir / "makes_and_models.json", makes_out)
    write_json(args.out_dir / "validation-report.json", validation_report)
    for slug in sorted(styles_by_slug.keys()):
        write_json(styles_dir / f"{slug}.json", styles_by_slug[slug])

    print(
        f"Wrote {args.out_dir} ({len(makes_out)} makes; {len(styles_by_slug)} style shards; "
        f"validation-report.json)"
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Project NHTSA Layer 2 + overlays → open-vehicle/_proposed/.")
    p.add_argument(
        "--baseline-nhtsa",
        type=Path,
        default=_DEFAULT_BASELINE_NHTSA,
        help="Layer 2 nhtsa-makes-models-source.json (optional).",
    )
    p.add_argument(
        "--baseline-fallback",
        type=Path,
        default=_DEFAULT_BASELINE_FALLBACK,
        help="Fallback baseline when Layer 2 file missing (default: current makes_and_models.json).",
    )
    p.add_argument("--catalog", type=Path, default=_DEFAULT_CATALOG)
    p.add_argument("--aliases", type=Path, default=_DEFAULT_ALIASES)
    p.add_argument("--visibility", type=Path, default=_DEFAULT_VISIBILITY)
    p.add_argument("--curated-dir", type=Path, default=_DEFAULT_CURATED)
    p.add_argument(
        "--seed-styles",
        type=Path,
        default=_DEFAULT_SEED_STYLES,
        help="Carry-forward styles directory (default: rules-source/open-vehicle/styles).",
    )
    p.add_argument(
        "--no-carry-styles",
        dest="carry_styles",
        action="store_false",
        help="Do not seed styles from disk — only curated styles_* populate trims.",
    )
    p.set_defaults(carry_styles=True)
    p.add_argument("--out-dir", type=Path, default=_DEFAULT_OUT)
    p.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero when any catalog row with make+model fails to resolve to baseline (after aliases).",
    )
    p.add_argument(
        "--compare-baseline",
        action="store_true",
        help="Compare projected per-make counts to baseline-counts.json (needs aggregationSource=projected).",
    )
    p.add_argument("--baseline-counts", type=Path, default=_DEFAULT_BASELINE_COUNTS)
    p.add_argument(
        "--max-shrink-pct",
        type=float,
        default=5.0,
        help="Allowed drop vs baseline counts per make (default 5).",
    )
    p.add_argument(
        "--compare-baseline-fatal",
        action="store_true",
        help="Exit non-zero when shrink violations occur (after catalog/validation passes).",
    )
    p.add_argument(
        "--compare-baseline-unsafe",
        action="store_true",
        help="Run shrink check even when aggregationSource is not 'projected'.",
    )
    p.add_argument("--verify", action="store_true", help="Validate only; do not write files.")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return cmd_project(args)


if __name__ == "__main__":
    raise SystemExit(main())
