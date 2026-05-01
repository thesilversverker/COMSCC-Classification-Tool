#!/usr/bin/env python3
"""
Logical component: offline projection CLI — rebuild Layer 3 open-vehicle outputs into
`rules-source/open-vehicle/_proposed/` for human diff review before cutover.

Reads Layer 2 baseline + COMSCC catalog + aliases + visibility + curated-overrides,
never touches the network. Uses `json_io.write_json` for deterministic bytes.

Exit 0 on success; `--verify` validates inputs + would-write shapes without creating files.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

from json_io import read_json, write_json  # noqa: E402
from open_vehicle_projection import (  # noqa: E402
    load_aliases,
    load_baseline_makes,
    load_visibility,
    project_open_vehicle,
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

    if args.verify:
        print(f"verify OK: {len(makes_out)} makes, {len(styles_by_slug)} style files")
        return 0

    args.out_dir.mkdir(parents=True, exist_ok=True)
    styles_dir = args.out_dir / "styles"
    styles_dir.mkdir(parents=True, exist_ok=True)

    write_json(args.out_dir / "makes_and_models.json", makes_out)
    for slug in sorted(styles_by_slug.keys()):
        write_json(styles_dir / f"{slug}.json", styles_by_slug[slug])

    print(f"Wrote {args.out_dir} ({len(makes_out)} makes; {len(styles_by_slug)} style shards)")
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
    p.add_argument("--verify", action="store_true", help="Validate only; do not write files.")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return cmd_project(args)


if __name__ == "__main__":
    raise SystemExit(main())
