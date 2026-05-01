#!/usr/bin/env python3
"""
Logical component: convert COMSCC showroom CSV rows into vehicles-comscc-catalog.json vehicleCatalog entries.

Validates Make / Model against rules-source/open-vehicle/makes_and_models.json. When the Model column
contains text beyond the open-vehicle model key (e.g. \"A4 2.0 T quattro\"), the remainder is used as
trim when the CSV Trim column is empty, and the script attempts to align that text with
rules-source/open-vehicle/styles/{make_slug}.json (year overlap + token similarity).

Usage:
  python3 data-source/csv_to_comscc_vehicle_catalog.py \\
    --input data-source/COMSCC-unprotected.csv \\
    --output data-source/vehicle-catalog-from-csv.json \\
    --rejects-csv data-source/vehicle-catalog-rejects.csv

  python3 data-source/csv_to_comscc_vehicle_catalog.py --help
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable, Optional


# Logical component: repo paths (script lives in data-source/).
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DEFAULT_MAKES_MODELS = REPO_ROOT / "rules-source" / "open-vehicle" / "makes_and_models.json"
DEFAULT_STYLES_DIR = REPO_ROOT / "rules-source" / "open-vehicle" / "styles"
DEFAULT_INPUT = SCRIPT_DIR / "COMSCC-unprotected.csv"


def norm_ws(s: str) -> str:
    """Logical component: collapse whitespace for comparisons."""
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def norm_tokens(s: str) -> set[str]:
    """Logical component: token set for fuzzy style matching."""
    parts = re.split(r"[^a-z0-9]+", norm_ws(s))
    return {p for p in parts if len(p) >= 2}


def parse_int(
    value: str | None,
    field: str,
    row_no: int,
    errors: Optional[list[str]] = None,
) -> Optional[int]:
    """Logical component: parse integer CSV cells; empty -> None."""
    if value is None:
        return None
    t = str(value).strip()
    if t == "":
        return None
    try:
        return int(float(t))
    except ValueError:
        msg = f"row {row_no}: cannot parse int for {field!r}: {value!r}"
        if errors is not None:
            errors.append(msg)
        else:
            print(f"[warn] {msg}", file=sys.stderr)
        return None


def parse_year_pair(
    start_raw: str | None,
    end_raw: str | None,
    row_no: int,
    errors: Optional[list[str]] = None,
) -> tuple[Optional[int], Optional[int]]:
    """
    Logical component: COMSCC year columns — if only one side is set, mirror to the other.
    """
    ys = parse_int(start_raw, "Start Year", row_no, errors)
    ye = parse_int(end_raw, "End Year", row_no, errors)
    if ys is not None and ye is None:
        ye = ys
    if ye is not None and ys is None:
        ys = ye
    if ys is None or ye is None:
        if errors is not None:
            errors.append(
                f"row {row_no}: missing or invalid year range (start={start_raw!r} end={end_raw!r})"
            )
    return ys, ye


def normalize_header_map(fieldnames: Iterable[str | None]) -> dict[str, str]:
    """Logical component: map normalized header -> original DictReader key."""
    out: dict[str, str] = {}
    for raw in fieldnames:
        if raw is None:
            continue
        key = norm_ws(raw)
        out[key] = raw.strip()
    return out


def pick_column(hmap: dict[str, str], *candidates: str) -> Optional[str]:
    """Logical component: resolve CSV column by normalized name candidates."""
    for c in candidates:
        k = norm_ws(c)
        if k in hmap:
            return hmap[k]
    return None


def load_makes_models(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def find_make_entry(makes_data: list[dict[str, Any]], csv_make: str) -> Optional[dict[str, Any]]:
    """Logical component: match CSV Make to open-vehicle make_name / make_slug."""
    target = norm_ws(csv_make)
    if not target:
        return None
    for entry in makes_data:
        name = norm_ws(str(entry.get("make_name", "")))
        slug = norm_ws(str(entry.get("make_slug", "")))
        if target == name or target == slug:
            return entry
        # Logical component: tolerate \"Alfa Romeo\" vs \"ALFA ROMEO\" already covered by norm lower
    return None


def _strip_prefix_ci(raw: str, prefix: str) -> str:
    """Logical component: remove prefix from raw when case-insensitive prefix matches."""
    r = raw.strip()
    p = prefix.strip()
    if not p:
        return r
    if r.lower() == p.lower():
        return ""
    if r.lower().startswith(p.lower()) and len(r) >= len(p) and r[len(p) : len(p) + 1].isspace():
        return r[len(p) :].lstrip()
    return r


def split_model_field(
    make_entry: dict[str, Any], model_field: str
) -> tuple[Optional[str], str, str]:
    """
    Logical component: derive open-vehicle model key and remainder after that key / model_name.

    Returns (model_key, remainder_for_trim, match_kind) where match_kind is 'key_prefix', 'name_prefix',
    'key_lead_token', or ''.
    """
    raw = (model_field or "").strip()
    mf = norm_ws(raw)
    if not mf:
        return None, "", ""

    models: dict[str, Any] = make_entry.get("models") or {}
    if not isinstance(models, dict):
        return None, raw, ""

    # Logical component: longest model key that is a whole-word prefix of the CSV Model cell.
    best_key: Optional[str] = None
    best_len = -1
    for key in sorted(models.keys(), key=len, reverse=True):
        nk = norm_ws(key)
        if mf == nk or mf.startswith(nk + " "):
            if len(nk) > best_len:
                best_len = len(nk)
                best_key = key

    if best_key is not None:
        if mf == norm_ws(best_key):
            return best_key, "", "key_prefix"
        rest = _strip_prefix_ci(raw, best_key)
        return best_key, rest.strip(), "key_prefix"

    # Logical component: longest model_name match (full model_name as prefix of CSV Model).
    best_mkey: Optional[str] = None
    best_name: Optional[str] = None
    best_name_len = -1
    for key, meta in models.items():
        if not isinstance(meta, dict):
            continue
        mn_raw = str(meta.get("model_name", key)).strip()
        mn = norm_ws(mn_raw)
        if mf == mn or mf.startswith(mn + " "):
            if len(mn) > best_name_len:
                best_name_len = len(mn)
                best_name = mn_raw
                best_mkey = key

    if best_mkey is not None and best_name is not None:
        rest = _strip_prefix_ci(raw, best_name)
        return best_mkey, rest.strip(), "name_prefix"

    # Logical component: key like \"Giulia (952)\" — match leading token before '(' to CSV first segment.
    for key in sorted(models.keys(), key=len, reverse=True):
        lead = key.split("(", 1)[0].strip()
        nl = norm_ws(lead)
        if not nl:
            continue
        if mf == nl or mf.startswith(nl + " "):
            rest = _strip_prefix_ci(raw, lead)
            return key, rest.strip(), "key_lead_token"

    return None, raw, ""


def year_range_intersects(a0: int, a1: int, b_years: list[int]) -> bool:
    """Logical component: closed interval [a0,a1] intersects any year in b_years."""
    if not b_years:
        return False
    return any(a0 <= y <= a1 for y in b_years)


def best_style_match(
    styles_root: Path,
    make_slug: str,
    model_key: str,
    year_begin: int,
    year_end: int,
    trim_hint: str,
) -> tuple[Optional[str], Optional[str], float]:
    """
    Logical component: pick best open-vehicle style label under model_key for logging / QA.

    Returns (style_file_name, style_label, score). Score is higher = better.
    """
    path = styles_root / f"{make_slug}.json"
    if not path.is_file():
        return None, None, 0.0
    with path.open(encoding="utf-8") as f:
        doc = json.load(f)
    if not isinstance(doc, dict) or model_key not in doc:
        return path.name, None, 0.0
    model_styles = doc.get(model_key)
    if not isinstance(model_styles, dict):
        return path.name, None, 0.0

    hint_tokens = norm_tokens(trim_hint)
    best_label: Optional[str] = None
    best = -1.0
    for style_name, meta in model_styles.items():
        if not isinstance(meta, dict):
            continue
        years = meta.get("years") or []
        if not isinstance(years, list):
            continue
        iy = [int(y) for y in years if isinstance(y, (int, float)) and not isinstance(y, bool)]
        overlap = 1000.0 if year_range_intersects(year_begin, year_end, iy) else 0.0
        st_tokens = norm_tokens(style_name)
        inter = len(hint_tokens & st_tokens)
        union = len(hint_tokens | st_tokens) or 1
        jacc = inter / union
        score = overlap + 200.0 * jacc + 0.01 * len(style_name)
        if score > best:
            best = score
            best_label = style_name
    return path.name, best_label, best


def row_to_vehicle_object(
    row: dict[str, str],
    hmap: dict[str, str],
    row_no: int,
    makes_data: list[dict[str, Any]],
    styles_dir: Path,
    verbose: bool,
) -> tuple[Optional[dict[str, Any]], list[str]]:
    """Logical component: one CSV row -> one vehicleCatalog object (or None) + messages (errors / verbose)."""
    messages: list[str] = []

    def col(*names: str) -> Optional[str]:
        c = pick_column(hmap, *names)
        if c is None:
            return None
        return row.get(c, "")

    make_raw = col("Make", "make")
    model_raw = col("Model", "model")
    trim_raw = col("Trim", "trim")
    ys_raw = col("Start Year", "start year", "Year Begin", "vehicleYearBegin")
    ye_raw = col("End Year", "end year", "Year End", "vehicleYearEnd")
    weight = col("Showroom Base Weight (lbs)", "Showroom Base Weight", "showroomBaseWeightLbs")
    hp = col("Factory Rated HP", "Factory Rated Hp", "factoryRatedHp")
    torque = col("Factory Rated Torque", "factoryRatedTorqueLbFt", "Factory Rated Torque (lb-ft)")
    susp = col("SUSP Index", "SUSP index", "suspIndex", "Susp Index")

    if not norm_ws(make_raw or "") and not norm_ws(model_raw or ""):
        messages.append(f"row {row_no}: skipped (empty make and model)")
        return None, messages

    ys, ye = parse_year_pair(ys_raw, ye_raw, row_no, messages)
    if ys is None or ye is None:
        return None, messages

    w = parse_int(weight, "Showroom Base Weight", row_no, messages)
    h = parse_int(hp, "Factory Rated HP", row_no, messages)
    tq = parse_int(torque, "Factory Rated Torque", row_no, messages)
    si = parse_int(susp, "SUSP Index", row_no, messages)
    if w is None or h is None or tq is None or si is None:
        missing = []
        if w is None:
            missing.append("Showroom Base Weight")
        if h is None:
            missing.append("Factory Rated HP")
        if tq is None:
            missing.append("Factory Rated Torque")
        if si is None:
            missing.append("SUSP Index")
        messages.append(f"row {row_no}: missing or invalid numeric field(s): {', '.join(missing)}")
        return None, messages

    make_entry = find_make_entry(makes_data, make_raw or "")
    if make_entry is None:
        messages.append(f"row {row_no}: unknown Make {make_raw!r} (not in makes_and_models.json)")
        return None, messages

    make_slug = str(make_entry.get("make_slug", "")).strip()
    # Logical component: preserve CSV make spelling (e.g. \"Audi\") when present.
    vehicle_make = (make_raw or "").strip() or str(make_entry.get("make_name", "")).strip()

    model_key, remainder, mk = split_model_field(make_entry, model_raw or "")
    if model_key is None:
        messages.append(
            f"row {row_no}: Model {model_raw!r} does not match any model key/name for make {make_slug!r}"
        )
        return None, messages

    trim_cell = (trim_raw or "").strip()
    trim_from_model = remainder.strip()
    if trim_cell:
        vehicle_trim: str | None = trim_cell
        trim_hint_for_style = trim_cell
    elif trim_from_model:
        vehicle_trim = trim_from_model
        trim_hint_for_style = trim_from_model
    else:
        vehicle_trim = None
        trim_hint_for_style = ""

    if verbose and trim_hint_for_style and make_slug:
        style_file, style_label, style_score = best_style_match(
            styles_dir, make_slug, model_key, ys, ye, trim_hint_for_style
        )
        if style_label is not None:
            messages.append(
                f"row {row_no}: style {trim_hint_for_style!r} -> {style_file} :: {style_label!r} (score={style_score:.1f})"
            )

    obj: dict[str, Any] = {
        "vehicleMake": vehicle_make,
        "vehicleModel": model_key,
        "vehicleTrim": vehicle_trim,
        "vehicleYearBegin": ys,
        "vehicleYearEnd": ye,
        "showroomBaseWeightLbs": w,
        "factoryRatedHp": h,
        "factoryRatedTorqueLbFt": tq,
        "suspIndex": si,
    }
    return obj, messages


def write_rejects_csv(
    path: Path,
    source_fieldnames: list[str],
    rejects: list[tuple[int, dict[str, str], list[str]]],
) -> None:
    """Logical component: write rows that did not convert, with original columns + row index + reason."""
    extra = ["source_csv_row", "reject_reason"]
    out_fields = list(source_fieldnames) + extra
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=out_fields, extrasaction="ignore")
        writer.writeheader()
        for row_no, row, msgs in rejects:
            out_row: dict[str, str] = {k: (row.get(k) if row.get(k) is not None else "") for k in source_fieldnames}
            out_row["source_csv_row"] = str(row_no)
            out_row["reject_reason"] = "; ".join(msgs) if msgs else "not converted"
            writer.writerow(out_row)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Source CSV path")
    parser.add_argument("--output", type=Path, required=True, help="Output JSON path")
    parser.add_argument(
        "--rejects-csv",
        type=Path,
        default=None,
        help="Write rows that were not converted to this CSV (original columns + source_csv_row + reject_reason).",
    )
    parser.add_argument("--makes-models", type=Path, default=DEFAULT_MAKES_MODELS, help="makes_and_models.json")
    parser.add_argument("--styles-dir", type=Path, default=DEFAULT_STYLES_DIR, help="open-vehicle styles directory")
    parser.add_argument(
        "--wrap-catalog",
        action="store_true",
        help="Wrap array in {\"schemaVersion\":\"1.0.0\",\"vehicleCatalog\":[...]} (no comsccTemplate block).",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit with code 1 if any row could not be converted, or any verbose / validation message was recorded.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Log open-vehicle style file matches (best-effort) for trim / remainder text.",
    )
    args = parser.parse_args()

    if not args.input.is_file():
        print(f"error: input not found: {args.input}", file=sys.stderr)
        return 1
    if not args.makes_models.is_file():
        print(f"error: makes/models JSON not found: {args.makes_models}", file=sys.stderr)
        return 1

    makes_data = load_makes_models(args.makes_models)
    vehicles: list[dict[str, Any]] = []
    all_warnings: list[str] = []
    rejects: list[tuple[int, dict[str, str], list[str]]] = []
    source_fieldnames: list[str] = []

    with args.input.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            print("error: CSV has no header row", file=sys.stderr)
            return 1
        source_fieldnames = list(reader.fieldnames)
        hmap = normalize_header_map(reader.fieldnames)

        for i, row in enumerate(reader, start=2):
            if not any((v or "").strip() for v in row.values()):
                continue
            row_dict = {k: (v if v is not None else "") for k, v in row.items()}
            obj, msgs = row_to_vehicle_object(row_dict, hmap, i, makes_data, args.styles_dir, args.verbose)
            if obj is not None:
                vehicles.append(obj)
                all_warnings.extend(msgs)
            else:
                rejects.append((i, row_dict, msgs))
                if args.rejects_csv is None:
                    for m in msgs:
                        print(m, file=sys.stderr)

    if args.rejects_csv is not None:
        write_rejects_csv(args.rejects_csv, source_fieldnames, rejects)
        print(f"Wrote {len(rejects)} rejected rows to {args.rejects_csv}", file=sys.stderr)

    for w in all_warnings:
        print(w, file=sys.stderr)

    if args.wrap_catalog:
        out_doc: dict[str, Any] = {"schemaVersion": "1.0.0", "vehicleCatalog": vehicles}
    else:
        out_doc = vehicles

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as out:
        json.dump(out_doc, out, indent=2)
        out.write("\n")

    print(f"Wrote {len(vehicles)} vehicles to {args.output}", file=sys.stderr)
    if args.strict and (all_warnings or rejects):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
