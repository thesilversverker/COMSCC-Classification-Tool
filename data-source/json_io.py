"""
Logical component: shared deterministic JSON writer for all Python data-source scripts.

Same input value -> byte-identical file output across runs and machines. Stays in
lockstep with scripts/json-io.mjs so Node and Python produce equivalent files
when both touch the same tree.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Iterable, Optional, Sequence


# Logical component: serialization defaults — 2-space indent, trailing newline, raw UTF-8.
DEFAULT_INDENT = 2


def _with_key_order(
    value: Any,
    key_order: Optional[Callable[[Sequence[str]], Iterable[str]]],
) -> Any:
    """Recursively reorder dict keys for deterministic output. Lists pass through."""
    if key_order is None:
        return value
    if isinstance(value, list):
        return [_with_key_order(v, key_order) for v in value]
    if isinstance(value, dict):
        ordered = list(key_order(list(value.keys())))
        return {k: _with_key_order(value[k], key_order) for k in ordered}
    return value


def write_json(
    path: Path | str,
    value: Any,
    *,
    key_order: Optional[Callable[[Sequence[str]], Iterable[str]]] = None,
) -> None:
    """
    Write JSON to disk deterministically: 2-space indent + trailing newline.

    Creates parent directories on demand. Pass `key_order` to enforce field
    ordering inside dicts (the callable receives the dict's existing keys and
    must return them in the desired order).
    """
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    ordered = _with_key_order(value, key_order)
    with p.open("w", encoding="utf-8") as f:
        json.dump(ordered, f, indent=DEFAULT_INDENT, ensure_ascii=False)
        f.write("\n")


def read_json(path: Path | str) -> Any:
    """Read and parse a JSON file. Companion to write_json."""
    with Path(path).open(encoding="utf-8") as f:
        return json.load(f)
