"""
Logical component: tests for seed_baseline_counts — count semantics on synthetic
styles dirs, schema validation of the output, idempotency.
"""

from __future__ import annotations

import json

import pytest

from schemas import validate_or_raise
from seed_baseline_counts import build_baseline_counts, compute_counts


@pytest.fixture
def styles_tree(tmp_path):
    """Build a tiny styles dir mirroring the real layout."""
    d = tmp_path / "styles"
    d.mkdir()
    (d / "honda.json").write_text(
        json.dumps(
            {
                "CIVIC": {"4DR SEDAN": {"years": [2020, 2021]}, "2DR COUPE": {"years": [2018]}},
                "ACCORD": {"4DR SEDAN": {"years": [2020]}},
            }
        )
    )
    (d / "toyota.json").write_text(
        json.dumps({"COROLLA": {"4DR SEDAN": {"years": [2018, 2019]}}})
    )
    (d / "empty_make.json").write_text("{}")
    return d


class TestBuildBaselineCounts:
    def test_build_with_aggregation_projected_validates(self, styles_tree):
        doc = build_baseline_counts(
            compute_counts(styles_tree),
            aggregation_source="projected",
            note="test",
        )
        assert doc.get("aggregationSource") == "projected"
        validate_or_raise("baseline_counts", doc, context="<test>")

    def test_validates_against_schema(self, styles_tree):
        doc = build_baseline_counts(compute_counts(styles_tree))
        validate_or_raise("baseline_counts", doc, context="<test>")

    def test_keys_alphabetized_for_deterministic_diff(self, styles_tree):
        doc = build_baseline_counts(compute_counts(styles_tree))
        assert list(doc["counts"].keys()) == sorted(doc["counts"].keys())

    def test_idempotent(self, styles_tree):
        a = build_baseline_counts(compute_counts(styles_tree))
        b = build_baseline_counts(compute_counts(styles_tree))
        assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


class TestComputeCounts:
    def test_counts_models_and_styles(self, styles_tree):
        counts = compute_counts(styles_tree)
        assert counts["honda"] == {"models": 2, "styles": 3}
        assert counts["toyota"] == {"models": 1, "styles": 1}
        assert counts["empty_make"] == {"models": 0, "styles": 0}

    def test_missing_styles_dir_returns_empty(self, tmp_path):
        assert compute_counts(tmp_path / "does_not_exist") == {}

    def test_non_dict_styles_file_skipped(self, tmp_path):
        d = tmp_path / "styles"
        d.mkdir()
        (d / "weird.json").write_text("[]")  # array, not dict
        # Logical component: malformed make file gets skipped entirely so the
        # baseline-counts.json schema (which requires {models, styles} per slug)
        # cannot be tripped by garbage on disk.
        assert compute_counts(d) == {}
