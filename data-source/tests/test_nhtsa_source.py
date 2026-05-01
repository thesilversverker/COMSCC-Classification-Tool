"""
Logical component: tests for nhtsa_source builders — output shape, schema-bound
validation, deterministic ordering, and pydantic round-trip.
"""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from nhtsa_source import (
    build_nhtsa_catalog_style_details,
    build_nhtsa_makes_models,
    build_source_manifest,
    build_validation_report,
    make_slug,
    parse_or_record_issue,
    response_set_hash,
)
from schemas import SchemaValidationError, validate_or_raise
from vpic_models import CanadianSpecsEnvelope, MakesEnvelope, ModelsEnvelope


# Logical component: slug normalization matches the existing styles file naming.
class TestMakeSlug:
    @pytest.mark.parametrize(
        "raw,slug",
        [
            ("HONDA", "honda"),
            ("ASTON MARTIN", "aston_martin"),
            ("MERCEDES-BENZ", "mercedes_benz"),
            ("Alfa Romeo", "alfa_romeo"),
            ("Rolls-Royce", "rolls_royce"),
            ("AM General", "am_general"),
        ],
    )
    def test_known_makes(self, raw, slug):
        assert make_slug(raw) == slug


# Logical component: makes/models projection.
class TestBuildNhtsaMakesModels:
    def test_happy_path(self, fixture_json):
        makes_env = MakesEnvelope.model_validate(fixture_json("makes_for_vehicle_type_car.json"))
        models_env = ModelsEnvelope.model_validate(fixture_json("models_honda_2020.json"))

        doc = build_nhtsa_makes_models(makes=makes_env, models_per_year=[(2020, models_env)])

        # Logical component: schema-shaped + validates.
        assert doc["schemaVersion"] == "1.0.0"
        assert "generatedAt" in doc
        # Logical component: only HONDA gets a make row (it's the only one with models in fixtures).
        slugs = [m["make_slug"] for m in doc["makes"]]
        assert slugs == ["honda"]
        honda = doc["makes"][0]
        assert honda["first_year"] == 2020
        assert honda["last_year"] == 2020
        assert sorted(honda["models"].keys()) == ["ACCORD", "CIVIC"]
        assert honda["models"]["CIVIC"]["years"] == [2020]

    def test_multi_year_aggregates(self, fixture_json):
        makes_env = MakesEnvelope.model_validate(fixture_json("makes_for_vehicle_type_car.json"))
        models_env = ModelsEnvelope.model_validate(fixture_json("models_honda_2020.json"))
        doc = build_nhtsa_makes_models(
            makes=makes_env,
            models_per_year=[(2020, models_env), (2021, models_env), (2022, models_env)],
        )
        years = doc["makes"][0]["models"]["CIVIC"]["years"]
        assert years == [2020, 2021, 2022]

    def test_makes_without_models_excluded(self, fixture_json):
        # Logical component: TOYOTA is in makes fixture but no models fixture
        # references it — should be omitted from Layer 2 output.
        makes_env = MakesEnvelope.model_validate(fixture_json("makes_for_vehicle_type_car.json"))
        models_env = ModelsEnvelope.model_validate(fixture_json("models_honda_2020.json"))
        doc = build_nhtsa_makes_models(makes=makes_env, models_per_year=[(2020, models_env)])
        slugs = {m["make_slug"] for m in doc["makes"]}
        assert "toyota" not in slugs
        assert "aston_martin" not in slugs

    def test_output_validates_against_schema(self, fixture_json):
        makes_env = MakesEnvelope.model_validate(fixture_json("makes_for_vehicle_type_car.json"))
        models_env = ModelsEnvelope.model_validate(fixture_json("models_honda_2020.json"))
        doc = build_nhtsa_makes_models(makes=makes_env, models_per_year=[(2020, models_env)])
        # Logical component: re-validate explicitly to prove schema binding.
        validate_or_raise("nhtsa_makes_models_source", doc, context="<test>")

    def test_deterministic_ordering(self, fixture_json):
        makes_env = MakesEnvelope.model_validate(fixture_json("makes_for_vehicle_type_car.json"))
        models_env = ModelsEnvelope.model_validate(fixture_json("models_honda_2020.json"))
        doc1 = build_nhtsa_makes_models(
            makes=makes_env, models_per_year=[(2021, models_env), (2020, models_env)]
        )
        doc2 = build_nhtsa_makes_models(
            makes=makes_env, models_per_year=[(2020, models_env), (2021, models_env)]
        )
        # Logical component: drop generatedAt before comparing — same input,
        # same output (modulo timestamp).
        for d in (doc1, doc2):
            d.pop("generatedAt", None)
        assert json.dumps(doc1, sort_keys=True) == json.dumps(doc2, sort_keys=True)


# Logical component: catalog-scoped specs detail rows.
class TestBuildNhtsaCatalogStyleDetails:
    def test_happy_path(self, fixture_json):
        env = CanadianSpecsEnvelope.model_validate(fixture_json("canadian_specs_honda_civic_2020.json"))
        doc = build_nhtsa_catalog_style_details(
            specs_per_tuple=[(2020, "HONDA", "Civic", env)]
        )
        assert doc["schemaVersion"] == "1.0.0"
        rows = doc["rows"]
        assert len(rows) == 1
        assert rows[0]["year"] == 2020
        assert rows[0]["specs"]["Body Style"] == "Sedan"
        assert rows[0]["specs"]["Curb Weight (kg)"] == "1247"

    def test_empty_results_yields_no_rows(self, fixture_json):
        env = CanadianSpecsEnvelope.model_validate(fixture_json("empty_results.json"))
        doc = build_nhtsa_catalog_style_details(
            specs_per_tuple=[(1900, "Tesla", "ModelS", env)]
        )
        assert doc["rows"] == []

    def test_rows_sorted_deterministically(self, fixture_json):
        env = CanadianSpecsEnvelope.model_validate(fixture_json("canadian_specs_honda_civic_2020.json"))
        doc = build_nhtsa_catalog_style_details(
            specs_per_tuple=[
                (2021, "HONDA", "Civic", env),
                (2020, "HONDA", "Accord", env),
                (2020, "HONDA", "Civic", env),
            ]
        )
        keys = [(r["make"], r["model"], r["year"]) for r in doc["rows"]]
        assert keys == [
            ("HONDA", "Accord", 2020),
            ("HONDA", "Civic", 2020),
            ("HONDA", "Civic", 2021),
        ]


# Logical component: source manifest builder.
class TestBuildSourceManifest:
    def test_basic_shape(self, tmp_path):
        catalog = tmp_path / "catalog.json"
        catalog.write_text(json.dumps({"vehicleCatalog": []}))
        doc = build_source_manifest(
            refresh_mode="update",
            year_from=1985,
            year_to=2026,
            current_year=2026,
            input_files={"vehiclesComsccCatalog": catalog},
            vpic_total=100,
            vpic_failures=2,
            vpic_response_set_hash="sha256:" + "0" * 64,
        )
        assert doc["refreshMode"] == "update"
        assert doc["vpic"]["failRate"] == pytest.approx(0.02)
        assert doc["inputHashes"]["vehiclesComsccCatalog"].startswith("sha256:")

    def test_zero_total_zero_rate(self, tmp_path):
        catalog = tmp_path / "catalog.json"
        catalog.write_text("{}")
        doc = build_source_manifest(
            refresh_mode="update",
            year_from=1985,
            year_to=2026,
            current_year=2026,
            input_files={"vehiclesComsccCatalog": catalog},
            vpic_total=0,
            vpic_failures=0,
            vpic_response_set_hash="sha256:" + "1" * 64,
        )
        assert doc["vpic"]["failRate"] == 0.0


# Logical component: response_set_hash is order-insensitive and stable.
class TestResponseSetHash:
    def test_order_insensitive(self):
        a = response_set_hash([("k1", "a" * 64), ("k2", "b" * 64)])
        b = response_set_hash([("k2", "b" * 64), ("k1", "a" * 64)])
        assert a == b

    def test_format(self):
        h = response_set_hash([("k1", "a" * 64)])
        assert h.startswith("sha256:")
        assert len(h) == len("sha256:") + 64


# Logical component: validation report builder.
class TestBuildValidationReport:
    def test_default_buckets_present(self):
        doc = build_validation_report()
        assert "unmatchedCatalogMakes" in doc["issues"]
        assert "baselineShrinkViolations" in doc["issues"]
        assert doc["counts"] == {}

    def test_issues_pass_through(self):
        doc = build_validation_report(
            issues={
                "unmatchedCatalogMakes": [
                    {"severity": "warning", "make": "Volkswagon", "message": "Use alias"}
                ]
            },
            counts={"honda": {"models": 10, "styles": 50}},
        )
        assert doc["issues"]["unmatchedCatalogMakes"][0]["make"] == "Volkswagon"
        assert doc["counts"]["honda"]["styles"] == 50


# Logical component: pydantic-resilient parser appends an issue and returns None.
class TestParseOrRecordIssue:
    def test_invalid_body_records_issue(self):
        issues = []
        result = parse_or_record_issue(
            MakesEnvelope, {"not": "valid"}, issue_bucket=issues, context={"endpoint": "GetMakes"}
        )
        assert result is None
        assert len(issues) == 1
        assert issues[0]["severity"] == "fatal"

    def test_valid_body_returns_envelope(self, fixture_json):
        body = fixture_json("makes_for_vehicle_type_car.json")
        issues = []
        result = parse_or_record_issue(
            MakesEnvelope, body, issue_bucket=issues, context={"endpoint": "GetMakes"}
        )
        assert result is not None
        assert issues == []
