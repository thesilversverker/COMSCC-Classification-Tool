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


class TestShrinkVsBaseline:
    def test_violation_when_models_drop_beyond_threshold(self):
        baseline = {
            "schemaVersion": "1.0.0",
            "counts": {"bmw": {"models": 100, "styles": 200}},
        }
        projected = {"bmw": {"models": 90, "styles": 200}}
        v = ovp.shrink_violations_vs_baseline(projected, baseline, max_shrink_pct=5.0)
        assert any("models projected=90" in line for line in v)

    def test_no_violation_within_threshold(self):
        baseline = {"counts": {"bmw": {"models": 100, "styles": 200}}}
        projected = {"bmw": {"models": 96, "styles": 200}}
        assert ovp.shrink_violations_vs_baseline(projected, baseline, max_shrink_pct=5.0) == []


class TestStaleAliasesAndBuckets:
    def test_catalog_failures_split_buckets(self):
        fails = [
            {
                "index": 0,
                "vehicleMake": "X",
                "vehicleModel": "Y",
                "reason": "unknown make after aliases (resolved='Z')",
            },
            {
                "index": 1,
                "vehicleMake": "Honda",
                "vehicleModel": "ZZTop",
                "reason": "unknown model for make_slug='honda' (resolved model='ZZTop')",
            },
        ]
        um, umodel = ovp.catalog_failures_to_issue_rows(fails)
        assert len(um) == 1
        assert len(umodel) == 1

    def test_stale_make_alias_when_canonical_missing(self, tiny_baseline):
        by = ovp.index_baseline_by_slug(tiny_baseline)
        aliases = {
            "schemaVersion": "1.0.0",
            "makes": {"TypoCo": {"canonical": "NotInBaseline", "reason": "x"}},
            "models": {},
            "trims": {},
        }
        stale = ovp.list_stale_alias_issues(aliases, by)
        assert any("NotInBaseline" in (s.get("message") or "") for s in stale)

    def test_stale_model_alias_target_model_missing(self, tiny_baseline):
        by = ovp.index_baseline_by_slug(tiny_baseline)
        aliases = {
            "schemaVersion": "1.0.0",
            "makes": {},
            "models": {
                "Honda|SpaceCar": {
                    "make": "Honda",
                    "model": "Nope",
                    "reason": "t",
                }
            },
            "trims": {},
        }
        stale = ovp.list_stale_alias_issues(aliases, by)
        assert any("not found under make_slug" in (s.get("message") or "") for s in stale)

    def test_projected_counts_from_styles(self):
        styles = {
            "honda": {
                "CIVIC": {"EX": {"years": [2020]}, "LX": {"years": [2020]}},
            }
        }
        c = ovp.projected_counts_from_styles(styles)
        assert c["honda"]["models"] == 1
        assert c["honda"]["styles"] == 2


class TestCatalogResolutionFailures:
    def test_unknown_make_reported(self, tiny_baseline, tiny_aliases):
        by = ovp.index_baseline_by_slug(tiny_baseline)
        fails = ovp.list_catalog_resolution_failures(
            [{"vehicleMake": "NotAMake", "vehicleModel": "X"}],
            by,
            tiny_aliases,
        )
        assert len(fails) == 1
        assert "unknown make" in fails[0]["reason"]

    def test_unknown_model_reported(self, tiny_baseline, tiny_aliases):
        by = ovp.index_baseline_by_slug(tiny_baseline)
        fails = ovp.list_catalog_resolution_failures(
            [{"vehicleMake": "Honda", "vehicleModel": "Odyssey"}],
            by,
            tiny_aliases,
        )
        assert len(fails) == 1
        assert "unknown model" in fails[0]["reason"]

    def test_resolved_row_has_no_failure(self, tiny_baseline, tiny_aliases):
        by = ovp.index_baseline_by_slug(tiny_baseline)
        fails = ovp.list_catalog_resolution_failures(
            [{"vehicleMake": "Honda", "vehicleModel": "Civic"}],
            by,
            tiny_aliases,
        )
        assert fails == []


class TestDeterminism:
    def test_sort_makes_array_order(self, tiny_baseline):
        out = ovp.sort_makes_array(list(reversed(tiny_baseline)))
        assert [m["make_slug"] for m in out] == ["honda", "volkswagen"]
