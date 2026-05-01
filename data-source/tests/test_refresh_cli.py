"""
Logical component: tests for refresh_nhtsa_vehicle_source CLI — `plan` output,
SKIP_OPEN_VEHICLE_SYNC escape hatch, planned_requests derivation, no network.
"""

from __future__ import annotations

import json

import pytest

import refresh_nhtsa_vehicle_source as cli
from vpic_cache import (
    ENDPOINT_MAKES,
    ENDPOINT_MODELS,
    ENDPOINT_SPECS,
    CacheEntry,
    VpicCache,
    cache_key,
)


# Logical component: planned_requests covers makes + recent-models + every catalog tuple.
class TestPlannedRequests:
    def test_makes_request_always_present(self):
        reqs = cli.planned_requests(
            catalog_rows=[],
            year_from=1985,
            year_to=2026,
            recent_years=3,
            current_year=2026,
        )
        assert (ENDPOINT_MAKES, {"vehicleType": "car"}) in reqs

    def test_recent_models_per_catalog_make(self):
        rows = [
            {"vehicleMake": "Honda", "vehicleModel": "Civic", "vehicleYearBegin": 2020, "vehicleYearEnd": 2020},
            {"vehicleMake": "Toyota", "vehicleModel": "Corolla", "vehicleYearBegin": 2018, "vehicleYearEnd": 2018},
        ]
        reqs = cli.planned_requests(
            catalog_rows=rows,
            year_from=1985,
            year_to=2026,
            recent_years=3,
            current_year=2026,
        )
        models = [(ep, p) for ep, p in reqs if ep == ENDPOINT_MODELS]
        # Logical component: each make × {2024, 2025, 2026} = 3 entries; 2 makes → 6.
        assert len(models) == 6
        assert any(p == {"make": "Honda", "year": 2026} for _, p in models)

    def test_specs_request_per_catalog_year_span(self):
        rows = [
            {"vehicleMake": "Honda", "vehicleModel": "Civic", "vehicleYearBegin": 2018, "vehicleYearEnd": 2020},
        ]
        reqs = cli.planned_requests(
            catalog_rows=rows,
            year_from=1985,
            year_to=2026,
            recent_years=3,
            current_year=2026,
        )
        specs = [(ep, p) for ep, p in reqs if ep == ENDPOINT_SPECS]
        # Logical component: years 2018, 2019, 2020 → 3 spec requests.
        assert len(specs) == 3
        years = sorted(p["year"] for _, p in specs)
        assert years == [2018, 2019, 2020]

    def test_invalid_rows_skipped(self):
        rows = [
            {"vehicleMake": "Honda", "vehicleModel": None, "vehicleYearBegin": 2018, "vehicleYearEnd": 2018},
            {"vehicleMake": None, "vehicleModel": "Civic", "vehicleYearBegin": 2018, "vehicleYearEnd": 2018},
            {"vehicleMake": "Honda", "vehicleModel": "Civic", "vehicleYearBegin": "bad", "vehicleYearEnd": 2018},
        ]
        reqs = cli.planned_requests(
            catalog_rows=rows,
            year_from=1985,
            year_to=2026,
            recent_years=3,
            current_year=2026,
        )
        # Logical component: only the makes request and the recent-models for "Honda"
        # survive (1 valid catalog make remains). No specs request comes through.
        assert all(ep != ENDPOINT_SPECS for ep, _ in reqs)


# Logical component: cmd_plan output — text and JSON shapes.
class TestPlanCommand:
    def _empty_catalog(self, tmp_path):
        p = tmp_path / "catalog.json"
        p.write_text(json.dumps({"vehicleCatalog": []}))
        return p

    def test_plan_with_empty_cache_marks_everything_missing(self, tmp_path, capsys, monkeypatch):
        argv = [
            "plan",
            "--cache-dir", str(tmp_path / "cache"),
            "--catalog", str(self._empty_catalog(tmp_path)),
            "--current-year", "2026",
            "--run-at", "1700000000",
            "--json",
        ]
        rc = cli.main(argv)
        assert rc == 0
        out = json.loads(capsys.readouterr().out)
        assert out["totals"]["missing"] == 1  # only the makes request
        assert out["totals"]["cached-fresh"] == 0

    def test_plan_with_cached_makes_marks_fresh(self, tmp_path, capsys, monkeypatch):
        cache = VpicCache(tmp_path / "cache")
        params = {"vehicleType": "car"}
        entry = CacheEntry(
            endpoint=ENDPOINT_MAKES,
            params=dict(params),
            url="https://example.invalid",
            status=200,
            fetched_at=1_700_000_000.0 - 60,  # one minute old → fresh
            response_sha256="x" * 64,
            etag=None,
            body_path="GetMakesForVehicleType/x.json",
        )
        cache.save_manifest({cache_key(ENDPOINT_MAKES, params): entry})

        argv = [
            "plan",
            "--cache-dir", str(tmp_path / "cache"),
            "--catalog", str(self._empty_catalog(tmp_path)),
            "--current-year", "2026",
            "--run-at", "1700000000",
            "--json",
        ]
        rc = cli.main(argv)
        assert rc == 0
        out = json.loads(capsys.readouterr().out)
        assert out["totals"]["cached-fresh"] == 1
        assert out["totals"]["missing"] == 0

    def test_plan_text_output_summary_line(self, tmp_path, capsys):
        argv = [
            "plan",
            "--cache-dir", str(tmp_path / "cache"),
            "--catalog", str(self._empty_catalog(tmp_path)),
            "--current-year", "2026",
            "--run-at", "1700000000",
        ]
        rc = cli.main(argv)
        assert rc == 0
        text = capsys.readouterr().out
        assert "VPIC refresh plan" in text
        assert "missing=" in text


# Logical component: SKIP_OPEN_VEHICLE_SYNC escape hatch — exits 0 without parsing args.
class TestSkipEnvVar:
    @pytest.mark.parametrize("val", ["1", "yes", "true", "anything"])
    def test_skip_truthy_values_short_circuit(self, val, monkeypatch, capsys):
        monkeypatch.setenv(cli.SKIP_ENV_VAR, val)
        # Logical component: pass intentionally-bogus argv to prove we never parse it.
        rc = cli.main(["--definitely-not-a-real-flag"])
        assert rc == 0
        err = capsys.readouterr().err
        assert cli.SKIP_ENV_VAR in err

    @pytest.mark.parametrize("val", ["", "0", "false", "False"])
    def test_skip_falsy_values_do_not_short_circuit(self, val, monkeypatch, tmp_path, capsys):
        monkeypatch.setenv(cli.SKIP_ENV_VAR, val)
        catalog = tmp_path / "catalog.json"
        catalog.write_text(json.dumps({"vehicleCatalog": []}))
        rc = cli.main(
            [
                "plan",
                "--cache-dir", str(tmp_path / "cache"),
                "--catalog", str(catalog),
                "--current-year", "2026",
                "--run-at", "1700000000",
                "--json",
            ]
        )
        assert rc == 0
        # Logical component: real plan ran — JSON parses cleanly.
        json.loads(capsys.readouterr().out)

    def test_skip_unset_does_not_short_circuit(self, monkeypatch, tmp_path, capsys):
        monkeypatch.delenv(cli.SKIP_ENV_VAR, raising=False)
        catalog = tmp_path / "catalog.json"
        catalog.write_text(json.dumps({"vehicleCatalog": []}))
        rc = cli.main(
            [
                "plan",
                "--cache-dir", str(tmp_path / "cache"),
                "--catalog", str(catalog),
                "--current-year", "2026",
                "--run-at", "1700000000",
                "--json",
            ]
        )
        assert rc == 0
        json.loads(capsys.readouterr().out)
