"""
Logical component: Python-side JSON Schema validation, reading the same schema
files as scripts/validate-rules-source.mjs.

One source of truth for shape contracts (rules-source/_schemas/*.schema.json),
two consumers (Node compose/build, Python refresh/projection). If anything
drifts, both sides fail in lockstep with the same JSON-pointer error path.

This module is small on purpose: callers reach for `validate_or_raise` at every
file write site. The cost of compiling is amortized across a refresh run.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

# Logical component: schema name → file. Mirrors SCHEMA_FILES in
# scripts/validate-rules-source.mjs so the two validators stay in lockstep.
_SCHEMAS: dict[str, str] = {
    "makes_and_models": "makes-and-models.schema.json",
    "styles": "styles.schema.json",
    "vehicles_comscc_catalog": "vehicles-comscc-catalog.schema.json",
    "vehicles": "vehicles.schema.json",
    "nhtsa_makes_models_source": "nhtsa-makes-models-source.schema.json",
    "nhtsa_catalog_style_details_source": "nhtsa-catalog-style-details-source.schema.json",
    "source_manifest": "source-manifest.schema.json",
    "validation_report": "validation-report.schema.json",
    "baseline_counts": "baseline-counts.schema.json",
    "aliases": "aliases.schema.json",
    "visibility_overrides": "visibility-overrides.schema.json",
    "curated_override": "curated-override.schema.json",
}

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SCHEMAS_DIR = _REPO_ROOT / "rules-source" / "_schemas"


class SchemaValidationError(Exception):
    """Raised when a value fails its schema. Message includes the JSON pointer + reason."""


@lru_cache(maxsize=None)
def _validator(schema_name: str) -> Draft202012Validator:
    if schema_name not in _SCHEMAS:
        raise KeyError(f"unknown schema name: {schema_name!r}")
    schema_path = _SCHEMAS_DIR / _SCHEMAS[schema_name]
    with schema_path.open(encoding="utf-8") as f:
        schema = json.load(f)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def _format_errors(errors: list[ValidationError]) -> str:
    lines = []
    for e in errors[:10]:
        pointer = "/" + "/".join(str(p) for p in e.absolute_path) if e.absolute_path else "<root>"
        lines.append(f"  - {pointer}: {e.message}")
    return "\n".join(lines) or "  - (no error details)"


def validate_or_raise(schema_name: str, value: Any, *, context: str) -> None:
    """Validate `value` against the named schema. Raise SchemaValidationError on failure.

    `context` is a human-readable label (typically a file path) included in the message
    so a curator running `data:validate` knows exactly which file misbehaved.
    """
    validator = _validator(schema_name)
    errors = sorted(validator.iter_errors(value), key=lambda e: list(e.absolute_path))
    if errors:
        raise SchemaValidationError(
            f"Schema validation failed for {context} ({schema_name}):\n{_format_errors(errors)}"
        )


def schema_names() -> tuple[str, ...]:
    """Sorted tuple of every registered schema name. Useful for tests."""
    return tuple(sorted(_SCHEMAS))
