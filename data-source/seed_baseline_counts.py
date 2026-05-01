#!/usr/bin/env python3
"""
Logical component: operator helper that recomputes baseline-counts.json from the
current curated `rules-source/open-vehicle/styles/<make>.json` set.

Usage (from repo root):

    data-source/.venv/bin/python data-source/seed_baseline_counts.py

The script is idempotent: same curated input → same JSON output (deterministic
ordering, no timestamp). Writes via json_io.write_json so the output stays in
lockstep with the rest of the pipeline's deterministic-write contract.

Run it once after the pipeline lands, and re-run intentionally any time a
projection diff is accepted that should set a new "this is fine" floor.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Logical component: when invoked as a script the package isn't on sys.path.
_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

from json_io import read_json, write_json  # noqa: E402  (sys.path mutation above)
from schemas import validate_or_raise  # noqa: E402

_REPO_ROOT = _THIS_DIR.parent
DEFAULT_STYLES_DIR = _REPO_ROOT / "rules-source" / "open-vehicle" / "styles"
DEFAULT_OUTPUT = _REPO_ROOT / "rules-source" / "open-vehicle" / "baseline-counts.json"


def compute_counts(styles_dir: Path) -> dict[str, dict[str, int]]:
    """Return {make_slug: {models: N, styles: M}} aggregated across every styles/<make>.json."""
    counts: dict[str, dict[str, int]] = {}
    if not styles_dir.exists():
        return counts
    for path in sorted(styles_dir.glob("*.json")):
        slug = path.stem
        styles_map = read_json(path)
        if not isinstance(styles_map, dict):
            continue
        model_count = 0
        style_count = 0
        for _model_key, style_entries in styles_map.items():
            if not isinstance(style_entries, dict):
                continue
            model_count += 1
            style_count += len(style_entries)
        counts[slug] = {"models": model_count, "styles": style_count}
    return counts


def build_baseline_counts(counts: dict[str, dict[str, int]]) -> dict:
    """Wrap raw counts into the schema-shaped doc and validate."""
    doc = {
        "schemaVersion": "1.0.0",
        "note": "Per-make floor for the projection regression check. Update intentionally when a projection diff is accepted.",
        "counts": {slug: counts[slug] for slug in sorted(counts)},
    }
    validate_or_raise("baseline_counts", doc, context="<baseline_counts>")
    return doc


def _ordered_keys(keys: list[str]) -> list[str]:
    """Schema-aligned key order for the top-level doc keeps diffs minimal.

    `keys` is whatever subset the writer sees at this dict level; we only
    promote known top-level keys, then preserve everything else in input order.
    Nested dicts (per-make `{models, styles}`) fall through unchanged.
    """
    desired = [k for k in ("schemaVersion", "note", "counts") if k in keys]
    rest = [k for k in keys if k not in desired]
    return desired + rest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Recompute rules-source/open-vehicle/baseline-counts.json.")
    parser.add_argument("--styles-dir", type=Path, default=DEFAULT_STYLES_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--print-only", action="store_true", help="Compute and print to stdout; do not write.")
    args = parser.parse_args(argv)

    counts = compute_counts(args.styles_dir)
    doc = build_baseline_counts(counts)

    if args.print_only:
        import json

        print(json.dumps(doc, indent=2))
        return 0

    write_json(args.output, doc, key_order=_ordered_keys)
    print(f"Wrote {args.output} ({len(counts)} makes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
