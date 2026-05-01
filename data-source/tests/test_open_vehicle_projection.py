"""
Logical component: tests for open_vehicle_projection — scope filter, alias resolution,
visibility drops, style merge, deterministic sort.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import open_vehicle_projection as ovp


@pytest.fixture
def tiny_baseline():
    return [
        {
            "first_year": 2020,
            "last_year": 2020,
            "make_id": 1,
            "make_name": "HONDA",
            "make_slug": "honda",
            "models": {
                "CIVIC": {
                    "model_id": 1,
                    "model_name": "Civic",
                    "vehicle_type": "car",
                    "years": [2020],
                    "model_styles": {},
                }
            },
        },
        {
            "first_year": 1998,
            "last_year": 1998,
            "make_id": 2,
            "make_name": "VOLKSWAGEN",
            "make_slug": "volkswagen",
            "models": {
                "GOLF": {
                    "model_id": 2,
                    "model_name": "Golf",
                    "vehicle_type": "car",
                    "years": [1998],
                    "model_styles": {},
                }
            },
        },
    ]


@pytest.fixture
def tiny_aliases():
    return {
        "schemaVersion": "1.0.0",
        "makes": {"Volkswagon": {"canonical": "Volkswagen", "reason": "typo"}},
        "models": {},
        "trims": {},
    }


class TestScopeAndAliases:
    def test_catalog_scope_resolves_make_typo(self, tiny_baseline, tiny_aliases):
        by = ovp.index_baseline_by_slug(tiny_baseline)
        rows = [
            {"vehicleMake": "Volkswagon", "vehicleModel": "Golf", "vehicleYearBegin": 1998, "vehicleYearEnd": 1998}
        ]
        scope = ovp.collect_catalog_scope(rows, by, tiny_aliases)
        assert ("volkswagen", "GOLF") in scope

    def test_scope_empty_when_model_unknown(self, tiny_baseline, tiny_aliases):
        by = ovp.index_baseline_by_slug(tiny_baseline)
        rows = [{"vehicleMake": "Honda", "vehicleModel": "Accord", "vehicleYearBegin": 2020, "vehicleYearEnd": 2020}]
        scope = ovp.collect_catalog_scope(rows, by, tiny_aliases)
        assert scope == set()


class TestVisibility:
    def test_hidden_make_dropped(self, tiny_baseline, tiny_aliases):
        catalog_row = {"vehicleMake": "Honda", "vehicleModel": "Civic", "vehicleYearBegin": 2020, "vehicleYearEnd": 2020}
        vis = {"schemaVersion": "1.0.0", "makes": {"honda": {"visible": False, "reason": "test"}}}
        makes, _styles = ovp.project_open_vehicle(
            baseline_makes=tiny_baseline,
            catalog_rows=[catalog_row],
            aliases=tiny_aliases,
            visibility=vis,
            curated_dir=Path("/nonexistent"),
            seed_styles_from=None,
        )
        assert makes == []

    def test_hidden_model_dropped(self, tiny_baseline, tiny_aliases):
        catalog_row = {"vehicleMake": "Honda", "vehicleModel": "Civic", "vehicleYearBegin": 2020, "vehicleYearEnd": 2020}
        vis = {
            "schemaVersion": "1.0.0",
            "makes": {"honda": {"models": {"CIVIC": {"visible": False, "reason": "test"}}}},
        }
        makes, _styles = ovp.project_open_vehicle(
            baseline_makes=tiny_baseline,
            catalog_rows=[catalog_row],
            aliases=tiny_aliases,
            visibility=vis,
            curated_dir=Path("/nonexistent"),
            seed_styles_from=None,
        )
        assert makes == []


class TestIncludeScope:
    def test_include_brings_model_without_catalog(self, tiny_baseline, tiny_aliases, tmp_path):
        curated_dir = tmp_path / "curated-overrides"
        curated_dir.mkdir()
        (curated_dir / "honda.json").write_text(
            json.dumps(
                {
                    "schemaVersion": "1.0.0",
                    "make_slug": "honda",
                    "make_name": "HONDA",
                    "models": {"ACCORD": {"include": True, "model_name": "Accord", "vehicle_type": "car", "years_add": [2021]}},
                }
            )
        )
        makes, styles = ovp.project_open_vehicle(
            baseline_makes=tiny_baseline,
            catalog_rows=[],
            aliases=tiny_aliases,
            visibility={"schemaVersion": "1.0.0", "makes": {}},
            curated_dir=curated_dir,
            seed_styles_from=None,
        )
        slugs = [m["make_slug"] for m in makes]
        assert "honda" in slugs
        honda = next(m for m in makes if m["make_slug"] == "honda")
        assert "ACCORD" in honda["models"]


class TestDeterminism:
    def test_sort_makes_array_order(self, tiny_baseline):
        out = ovp.sort_makes_array(list(reversed(tiny_baseline)))
        assert [m["make_slug"] for m in out] == ["honda", "volkswagen"]
