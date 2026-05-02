#!/usr/bin/env python3
"""
Logical component: merge NHTSA Canadian-spec style detail rows into
`rules-source/open-vehicle/styles/<make_slug>.json`.

Scope: only catalog (vehicleMake, vehicleModel) pairs that resolve to baseline
make_slug + model_key after aliases — same resolution as `collect_catalog_scope`.
Detail rows match catalog refresh tuples via normalized raw make/model strings.

Each distinct VPIC `specs.Model` becomes a style key; years are the union of row
years. Existing files are merged (year union); curated keys without new NHTSA
rows are preserved unless --prune is set (optional unsafe trim).
"""

from __future__ import annotations

import argparse
import copy
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

from json_io import read_json, write_json  # noqa: E402
from open_vehicle_projection import (  # noqa: E402
    canonical_make_name,
    find_model_key,
    index_baseline_by_slug,
    load_aliases,
    load_baseline_makes,
    norm_token,
    resolve_model_alias,
    slug_for_resolved_make_name,
    slugify_trim_key,
)
from schemas import validate_or_raise  # noqa: E402

_REPO_ROOT = _THIS_DIR.parent

_DEFAULT_BASELINE_NHTSA = (
    _REPO_ROOT / "rules-source" / "open-vehicle" / "nhtsa-source" / "nhtsa-makes-models-source.json"
)
_DEFAULT_BASELINE_FALLBACK = _REPO_ROOT / "rules-source" / "open-vehicle" / "makes_and_models.json"
_DEFAULT_CATALOG = _REPO_ROOT / "rules-source" / "vehicles-comscc-catalog.json"
_DEFAULT_DETAILS = (
    _REPO_ROOT
    / "rules-source"
    / "open-vehicle"
    / "nhtsa-source"
    / "nhtsa-catalog-style-details-source.json"
)
_DEFAULT_ALIASES = _REPO_ROOT / "rules-source" / "open-vehicle" / "aliases.json"
_DEFAULT_STYLES_DIR = _REPO_ROOT / "rules-source" / "open-vehicle" / "styles"


# Logical component: map normalized catalog CSV pair → resolved (make_slug, model_key).


def build_norm_pair_to_target(
    catalog_rows: list[dict[str, Any]],
    baseline_by_slug: dict[str, dict[str, Any]],
    aliases: dict[str, Any],
) -> dict[tuple[str, str], tuple[str, str]]:
    makes_map = aliases.get("makes") or {}
    models_map = aliases.get("models") or {}
    out: dict[tuple[str, str], tuple[str, str]] = {}

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
        models_dict = baseline_by_slug[slug].get("models") or {}
        if not isinstance(models_dict, dict):
            continue
        mkey = find_model_key(models_dict, md_final)
        if mkey is None:
            continue
        out[(norm_token(csv_make), norm_token(csv_model))] = (slug, str(mkey))

    return out


# Logical component: aggregate VPIC rows → nested style maps.


def aggregate_details_by_slug(
    rows: list[dict[str, Any]],
    norm_pair_to_target: dict[tuple[str, str], tuple[str, str]],
) -> tuple[dict[str, dict[str, dict[str, set[int]]]], int]:
    """Returns (agg, skipped_rows_missing_Model)."""
    agg: dict[str, dict[str, dict[str, set[int]]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(set)))
    skipped = 0

    for row in rows:
        make = row.get("make")
        model = row.get("model")
        year = row.get("year")
        if not isinstance(make, str) or not isinstance(model, str):
            continue
        try:
            y = int(year)
        except (TypeError, ValueError):
            continue

        pair = (norm_token(make), norm_token(model))
        target = norm_pair_to_target.get(pair)
        if target is None:
            continue

        slug, mkey = target
        specs = row.get("specs")
        if not isinstance(specs, dict):
            continue
        raw_model_line = specs.get("Model")
        if raw_model_line is None:
            skipped += 1
            continue
        style_key = str(raw_model_line).strip()
        if not style_key:
            skipped += 1
            continue

        agg[slug][mkey][style_key].add(y)

    # Convert defaultdict trees to plain dicts for downstream code.
    plain: dict[str, dict[str, dict[str, set[int]]]] = {}
    for slug, models in agg.items():
        plain[slug] = {}
        for mk, styles in models.items():
            plain[slug][mk] = dict(styles)
    return plain, skipped


# Logical component: deterministic nested dict + merge with disk.


def sorted_styles_document(data: dict[str, Any]) -> dict[str, Any]:
    """Sort model keys and style keys for stable diffs."""
    out: dict[str, Any] = {}
    for mk in sorted(data.keys(), key=lambda s: s.lower()):
        inner = data[mk]
        if not isinstance(inner, dict):
            out[mk] = inner
            continue
        styles_out: dict[str, Any] = {}
        for sk in sorted(inner.keys(), key=lambda s: s.lower()):
            payload = inner[sk]
            if isinstance(payload, dict) and isinstance(payload.get("years"), list):
                styles_out[sk] = {"years": sorted(set(int(x) for x in payload["years"]))}
            else:
                styles_out[sk] = payload
        out[mk] = styles_out
    return out


def merge_existing_and_nhtsa(
    existing: dict[str, Any] | None,
    nhtsa_slice: dict[str, dict[str, set[int]]],
) -> dict[str, Any]:
    """Union years per style key; preserve unrelated models/styles from existing."""
    base = copy.deepcopy(existing) if isinstance(existing, dict) else {}
    for mk, styles in nhtsa_slice.items():
        base.setdefault(mk, {})
        if not isinstance(base[mk], dict):
            base[mk] = {}
        for sk, years_set in styles.items():
            cur = base[mk].get(sk)
            merged_years: set[int] = set(years_set)
            if isinstance(cur, dict) and isinstance(cur.get("years"), list):
                merged_years |= {int(x) for x in cur["years"]}
            base[mk][sk] = {"years": sorted(merged_years)}
    return sorted_styles_document(base)


def prune_styles_not_in_nhtsa(existing: dict[str, Any], nhtsa_keys: set[tuple[str, str]]) -> dict[str, Any]:
    """Drop style entries whose (model_key, style_key) is absent from nhtsa_keys."""
    out: dict[str, Any] = {}
    for mk, styles in existing.items():
        if not isinstance(styles, dict):
            out[mk] = styles
            continue
        kept: dict[str, Any] = {}
        for sk, payload in styles.items():
            if (mk, sk) in nhtsa_keys:
                kept[sk] = payload
        if kept:
            out[mk] = kept
    return sorted_styles_document(out)


# Logical component: COMSCC trim slug vs generated style keys (curator report).


def trim_mismatch_lines(
    catalog_rows: list[dict[str, Any]],
    baseline_by_slug: dict[str, dict[str, Any]],
    aliases: dict[str, Any],
    merged_by_slug: dict[str, dict[str, Any]],
) -> list[str]:
    """Lines when slugify(vehicleTrim) does not match slugify(any style key)."""
    makes_map = aliases.get("makes") or {}
    models_map = aliases.get("models") or {}
    lines: list[str] = []

    for idx, row in enumerate(catalog_rows):
        vm = row.get("vehicleMake") or row.get("make")
        vmodel = row.get("vehicleModel") or row.get("model")
        vt = row.get("vehicleTrim") or row.get("trim")
        if not isinstance(vm, str) or not isinstance(vmodel, str):
            continue
        if vt is None or not str(vt).strip():
            continue
        csv_make = vm.strip()
        csv_model = vmodel.strip()
        if not csv_make or not csv_model:
            continue

        mk_typo = canonical_make_name(csv_make, makes_map)
        mk_final, md_final, _trim_hint = resolve_model_alias(
            csv_make, csv_model, models_map, canonical_make_after_typo=mk_typo
        )

        slug = slug_for_resolved_make_name(baseline_by_slug, mk_final)
        if slug is None:
            continue
        models_dict = baseline_by_slug[slug].get("models") or {}
        if not isinstance(models_dict, dict):
            continue
        mkey = find_model_key(models_dict, md_final)
        if mkey is None:
            continue

        trim_slug = slugify_trim_key(str(vt).strip())
        doc = merged_by_slug.get(slug)
        if not isinstance(doc, dict):
            lines.append(
                f"[catalog {idx}] {csv_make!r} / {csv_model!r} trim={vt!r} → slug={slug} model={mkey!r}: "
                f"no styles file merged"
            )
            continue

        model_styles = doc.get(str(mkey))
        if not isinstance(model_styles, dict):
            lines.append(
                f"[catalog {idx}] {csv_make!r} / {csv_model!r} trim={vt!r} → slug={slug} model={mkey!r}: "
                f"no model styles"
            )
            continue

        style_slugs = {slugify_trim_key(sk) for sk in model_styles.keys()}
        if trim_slug not in style_slugs:
            lines.append(
                f"[catalog {idx}] {csv_make!r} / {csv_model!r} trim={vt!r} → slug={slug} model={mkey!r}: "
                f"trim slug {trim_slug!r} not in style key slugs (add aliases.trims or align keys)"
            )

    return lines


def cmd_main(args: argparse.Namespace) -> int:
    baseline = load_baseline_makes(args.baseline_nhtsa, args.baseline_fallback)
    baseline_by_slug = index_baseline_by_slug(baseline)

    catalog_doc = read_json(args.catalog)
    catalog_rows = catalog_doc.get("vehicleCatalog") or []
    if not isinstance(catalog_rows, list):
        print("catalog.vehicleCatalog must be an array", file=sys.stderr)
        return 1

    aliases = load_aliases(args.aliases)
    validate_or_raise("aliases", aliases, context=str(args.aliases))

    details_doc = read_json(args.details)
    rows = details_doc.get("rows") or []
    if not isinstance(rows, list):
        print("details.rows must be an array", file=sys.stderr)
        return 1

    norm_pair_to_target = build_norm_pair_to_target(catalog_rows, baseline_by_slug, aliases)
    agg, skipped_no_model = aggregate_details_by_slug(rows, norm_pair_to_target)

    if args.verbose:
        print(f"resolved catalog pairs: {len(norm_pair_to_target)}", file=sys.stderr)
        print(f"detail rows skipped (missing specs.Model): {skipped_no_model}", file=sys.stderr)
        print(f"make slugs with NHTSA aggregates: {len(agg)}", file=sys.stderr)

    merged_by_slug: dict[str, dict[str, Any]] = {}
    nhtsa_key_sets: dict[str, set[tuple[str, str]]] = {}

    for slug, models in agg.items():
        path = args.styles_dir / f"{slug}.json"
        existing = read_json(path) if path.exists() else {}
        if existing is not None and not isinstance(existing, dict):
            print(f"{path}: expected object, skipping", file=sys.stderr)
            continue

        nhtsa_slice: dict[str, dict[str, set[int]]] = {
            mk: {sk: years for sk, years in styles.items()} for mk, styles in models.items()
        }
        keys_here = {(mk, sk) for mk, styles in nhtsa_slice.items() for sk in styles}
        nhtsa_key_sets[slug] = keys_here

        merged = merge_existing_and_nhtsa(existing if isinstance(existing, dict) else {}, nhtsa_slice)
        if args.prune:
            merged = prune_styles_not_in_nhtsa(merged, keys_here)

        validate_or_raise("styles", merged, context=str(path))
        merged_by_slug[slug] = merged

        if args.dry_run:
            print(f"would write {path} ({len(merged)} model keys)", file=sys.stderr)
        else:
            write_json(path, merged)
            if args.verbose:
                print(f"wrote {path}", file=sys.stderr)

    if args.report:
        report_lines = trim_mismatch_lines(
            catalog_rows, baseline_by_slug, aliases, merged_by_slug
        )
        text = "\n".join(report_lines) + ("\n" if report_lines else "")
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(text, encoding="utf-8")
        if args.verbose:
            print(f"trim report: {len(report_lines)} line(s) → {args.report}", file=sys.stderr)

    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Merge NHTSA style details into open-vehicle/styles/*.json")
    p.add_argument("--catalog", type=Path, default=_DEFAULT_CATALOG, help="vehicles-comscc-catalog.json")
    p.add_argument("--details", type=Path, default=_DEFAULT_DETAILS, help="nhtsa-catalog-style-details-source.json")
    p.add_argument("--aliases", type=Path, default=_DEFAULT_ALIASES, help="open-vehicle aliases.json")
    p.add_argument("--baseline-nhtsa", type=Path, default=_DEFAULT_BASELINE_NHTSA, help="nhtsa-makes-models-source.json")
    p.add_argument(
        "--baseline-fallback",
        type=Path,
        default=_DEFAULT_BASELINE_FALLBACK,
        help="makes_and_models.json when Layer 2 baseline missing",
    )
    p.add_argument("--styles-dir", type=Path, default=_DEFAULT_STYLES_DIR, help="output directory for <slug>.json")
    p.add_argument("--dry-run", action="store_true", help="validate merge only; do not write files")
    p.add_argument(
        "--report",
        type=Path,
        default=None,
        help="write trim mismatch report (COMSCC vehicleTrim slug vs style keys)",
    )
    p.add_argument(
        "--prune",
        action="store_true",
        help="remove style keys not present in this NHTSA run (default: keep curated extras)",
    )
    p.add_argument("--verbose", "-v", action="store_true")
    return p


def main() -> None:
    args = build_arg_parser().parse_args()
    raise SystemExit(cmd_main(args))


if __name__ == "__main__":
    main()
