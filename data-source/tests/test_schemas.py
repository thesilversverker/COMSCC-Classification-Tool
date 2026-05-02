"""
Logical component: tests for schemas.py — every registered name compiles, the
validator rejects malformed values with a clear pointer, and accepts realistic
values for each Layer 2 shape.
"""

from __future__ import annotations

import pytest

from schemas import SchemaValidationError, schema_names, validate_or_raise


def test_all_registered_schemas_compile():
    # Logical component: trigger compile for every registered schema name.
    for name in schema_names():
        # Logical component: empty dict is rarely valid, but the call should not
        # raise jsonschema.SchemaError — only validation errors against an empty.
        try:
            validate_or_raise(name, {}, context="<smoke>")
        except SchemaValidationError:
            pass  # expected — empty doc usually fails required keys


def test_unknown_schema_name_raises_keyerror():
    with pytest.raises(KeyError):
        validate_or_raise("not_a_schema", {}, context="<x>")


# Logical component: positive samples (realistic values) for each Layer 2 schema.
class TestLayer2Acceptance:
    def test_baseline_counts_minimal(self):
        validate_or_raise(
            "baseline_counts",
            {"schemaVersion": "1.0.0", "counts": {"honda": {"models": 10, "styles": 50}}},
            context="<test>",
        )

    def test_aliases_minimal(self):
        validate_or_raise(
            "aliases",
            {"schemaVersion": "1.0.0", "makes": {}, "models": {}, "trims": {}},
            context="<test>",
        )

    def test_aliases_with_make_alias(self):
        validate_or_raise(
            "aliases",
            {
                "schemaVersion": "1.0.0",
                "makes": {"Volkswagon": {"canonical": "Volkswagen", "reason": "CSV typo"}},
                "models": {},
                "trims": {},
            },
            context="<test>",
        )

    def test_visibility_overrides_minimal(self):
        validate_or_raise(
            "visibility_overrides",
            {
                "schemaVersion": "1.0.0",
                "makes": {"honda": {"models": {"FIT": {"visible": False, "reason": "Out of scope"}}}},
            },
            context="<test>",
        )

    def test_curated_override_bmw_example(self):
        # Logical component: matches plan.md > "Concrete example for `bmw`".
        validate_or_raise(
            "curated_override",
            {
                "schemaVersion": "1.0.0",
                "make_slug": "bmw",
                "make_name": "BMW",
                "models": {
                    "X5": {
                        "model_name": "X5",
                        "vehicle_type": "car",
                        "include": True,
                        "years_add": [2024, 2025],
                        "styles_add": {"X5 M COMPETITION 4DR SUV AWD": {"years": [2020, 2021]}},
                        "reason": "Add M Competition trim (NHTSA missing)",
                    }
                },
            },
            context="<test>",
        )

    def test_curated_override_include_all_baseline_models(self):
        validate_or_raise(
            "curated_override",
            {
                "schemaVersion": "1.0.0",
                "make_slug": "saleen",
                "make_name": "SALEEN",
                "include_all_baseline_models": True,
                "models": {},
            },
            context="<test>",
        )

    def test_source_manifest_minimal(self):
        validate_or_raise(
            "source_manifest",
            {
                "schemaVersion": "1.0.0",
                "generatedAt": "2026-05-01T00:00:00+00:00",
                "refreshMode": "update",
                "yearFrom": 1985,
                "yearTo": 2026,
                "currentYear": 2026,
                "inputHashes": {"vehiclesComsccCatalog": "sha256:" + "0" * 64},
                "vpic": {
                    "totalRequests": 100,
                    "failures": 0,
                    "failRate": 0.0,
                    "responseSetHash": "sha256:" + "0" * 64,
                },
            },
            context="<test>",
        )

    def test_validation_report_minimal(self):
        validate_or_raise(
            "validation_report",
            {
                "schemaVersion": "1.0.0",
                "generatedAt": "2026-05-01T00:00:00+00:00",
                "issues": {},
                "counts": {},
            },
            context="<test>",
        )


# Logical component: negative samples — verify the schema actually rejects.
class TestLayer2Rejection:
    def test_curated_override_rejects_typo(self):
        # Logical component: `model_remove` is the classic typo; schema must reject.
        with pytest.raises(SchemaValidationError) as exc:
            validate_or_raise(
                "curated_override",
                {
                    "schemaVersion": "1.0.0",
                    "make_slug": "bmw",
                    "make_name": "BMW",
                    "models": {},
                    "model_remove": ["X1"],  # plural-typo
                },
                context="<test>",
            )
        assert "model_remove" in str(exc.value) or "additional" in str(exc.value).lower()

    def test_baseline_counts_rejects_string_count(self):
        with pytest.raises(SchemaValidationError):
            validate_or_raise(
                "baseline_counts",
                {"schemaVersion": "1.0.0", "counts": {"honda": {"models": "ten", "styles": 0}}},
                context="<test>",
            )

    def test_aliases_rejects_missing_reason(self):
        with pytest.raises(SchemaValidationError):
            validate_or_raise(
                "aliases",
                {
                    "schemaVersion": "1.0.0",
                    "makes": {"Volkswagon": {"canonical": "Volkswagen"}},  # missing reason
                    "models": {},
                    "trims": {},
                },
                context="<test>",
            )

    def test_source_manifest_rejects_bad_hash(self):
        with pytest.raises(SchemaValidationError):
            validate_or_raise(
                "source_manifest",
                {
                    "schemaVersion": "1.0.0",
                    "generatedAt": "2026-05-01T00:00:00+00:00",
                    "refreshMode": "update",
                    "yearFrom": 1985,
                    "yearTo": 2026,
                    "currentYear": 2026,
                    "inputHashes": {},
                    "vpic": {
                        "totalRequests": 0,
                        "failures": 0,
                        "failRate": 0.0,
                        "responseSetHash": "not-a-sha",
                    },
                },
                context="<test>",
            )
