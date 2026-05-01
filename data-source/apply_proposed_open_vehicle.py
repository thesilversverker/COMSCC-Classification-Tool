#!/usr/bin/env python3
"""
Logical component: promote Layer 3 preview → committed open-vehicle paths (plan cutover).

Reads `rules-source/open-vehicle/_proposed/{makes_and_models.json,styles/*.json}` and
rewrites `rules-source/open-vehicle/makes_and_models.json` and `styles/<slug>.json` using
the same deterministic `json_io.write_json` as projection.

Default is dry-run (prints actions, exit 0). Pass `--apply` to perform writes after
schema validation. Does not modify aliases, visibility-overrides, curated-overrides,
or nhtsa-source — only the app-facing makes + styles shards.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

from json_io import read_json, write_json  # noqa: E402
from schemas import validate_or_raise  # noqa: E402

_REPO_ROOT = _THIS_DIR.parent
_DEFAULT_PROPOSED = _REPO_ROOT / "rules-source" / "open-vehicle" / "_proposed"
_DEFAULT_OPEN_VEHICLE = _REPO_ROOT / "rules-source" / "open-vehicle"


def _display_path(repo_root: Path, p: Path) -> str:
    """Prefer repo-relative paths for logs; fall back to absolute when targets live outside the repo."""
    try:
        return str(p.resolve().relative_to(repo_root.resolve()))
    except ValueError:
        return str(p.resolve())


def _validate_proposed(proposed_dir: Path) -> tuple[list[Path], list[Path]]:
    """Return (style_paths, errors). Validates schemas; collects errors instead of raising when listing."""
    errors: list[str] = []
    makes_path = proposed_dir / "makes_and_models.json"
    if not makes_path.is_file():
        errors.append(f"missing {makes_path}")
        return [], []

    try:
        validate_or_raise("makes_and_models", read_json(makes_path), context=str(makes_path))
    except Exception as e:
        errors.append(str(e))

    styles_dir = proposed_dir / "styles"
    style_paths: list[Path] = []
    if styles_dir.is_dir():
        style_paths = sorted(p for p in styles_dir.glob("*.json") if p.is_file())

    for sp in style_paths:
        try:
            validate_or_raise("styles", read_json(sp), context=str(sp))
        except Exception as e:
            errors.append(str(e))

    return style_paths, errors


def cmd_apply(args: argparse.Namespace) -> int:
    proposed_dir: Path = args.proposed_dir.resolve()
    target_dir: Path = args.target_dir.resolve()

    if not proposed_dir.is_dir():
        print(f"error: proposed dir not found: {proposed_dir}", file=sys.stderr)
        return 1

    style_paths, errors = _validate_proposed(proposed_dir)
    if errors:
        for msg in errors:
            print(f"validation error: {msg}", file=sys.stderr)
        return 1

    makes_src = proposed_dir / "makes_and_models.json"
    styles_src = proposed_dir / "styles"
    dst_makes = target_dir / "makes_and_models.json"
    dst_styles = target_dir / "styles"

    actions = [
        f"{_display_path(_REPO_ROOT, makes_src)} → {_display_path(_REPO_ROOT, dst_makes)}",
    ]
    for sp in style_paths:
        actions.append(
            f"{_display_path(_REPO_ROOT, sp)} → {_display_path(_REPO_ROOT, dst_styles / sp.name)}"
        )

    print("Open-vehicle cutover (makes + styles shards only):\n")
    for line in actions:
        print(f"  {line}")

    if not args.apply:
        print("\nDry-run only (no files written). Pass --apply to promote.")
        return 0

    # Logical component: round-trip through read/write for deterministic bytes matching pipeline writers.
    write_json(dst_makes, read_json(makes_src))
    dst_styles.mkdir(parents=True, exist_ok=True)
    for sp in style_paths:
        write_json(dst_styles / sp.name, read_json(sp))

    print(f"\nWrote {dst_makes} and {len(style_paths)} file(s) under {dst_styles}")
    print("Next: npm run data:validate && npm run data:build")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Promote _proposed/ open-vehicle preview to committed Layer 3 paths.")
    p.add_argument("--proposed-dir", type=Path, default=_DEFAULT_PROPOSED)
    p.add_argument("--target-dir", type=Path, default=_DEFAULT_OPEN_VEHICLE, help="rules-source/open-vehicle/")
    p.add_argument(
        "--apply",
        action="store_true",
        help="Perform writes (default is dry-run listing only).",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    return cmd_apply(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
