"""
Logical component: tests for refresh_nhtsa_vehicle_source CLI — `plan` output,
SKIP_OPEN_VEHICLE_SYNC escape hatch, planned_requests derivation,
bootstrap/update Layer 2 writes via stubbed transport. No network.
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
from vpic_client import TransportResult, VpicClient


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


# Logical component: refresh_request_set — bootstrap and update produce the
# right shape of (endpoint, params) tuples without any network access.
class TestRefreshRequestSet:
    def test_bootstrap_uses_full_year_window(self):
        rows = [
            {
                "vehicleMake": "Honda",
                "vehicleModel": "Civic",
                "vehicleYearBegin": 2020,
                "vehicleYearEnd": 2020,
            }
        ]
        reqs = cli.refresh_request_set(
            refresh_mode="bootstrap",
            catalog_rows=rows,
            year_from=2018,
            year_to=2020,
            recent_years=3,
            current_year=2026,
        )
        models = [(ep, p) for ep, p in reqs if ep == ENDPOINT_MODELS]
        # Logical component: bootstrap fans out across the full window: 2018, 2019, 2020.
        assert sorted(p["year"] for _, p in models) == [2018, 2019, 2020]

    def test_update_uses_recent_window(self):
        rows = [
            {
                "vehicleMake": "Honda",
                "vehicleModel": "Civic",
                "vehicleYearBegin": 1985,
                "vehicleYearEnd": 1985,
            }
        ]
        reqs = cli.refresh_request_set(
            refresh_mode="update",
            catalog_rows=rows,
            year_from=1985,
            year_to=2026,
            recent_years=3,
            current_year=2026,
        )
        model_years = sorted(p["year"] for ep, p in reqs if ep == ENDPOINT_MODELS)
        # Logical component: update only refetches recent years.
        assert model_years == [2024, 2025, 2026]

    def test_unknown_refresh_mode_rejected(self):
        with pytest.raises(ValueError):
            cli.refresh_request_set(
                refresh_mode="bogus",
                catalog_rows=[],
                year_from=1985,
                year_to=2026,
                recent_years=3,
                current_year=2026,
            )


# Logical component: shared stub for bootstrap/update tests. Returns canned
# responses keyed by URL; raises if the CLI requests something unmapped.
def make_stub_factory(url_to_body: dict):
    def stub_transport(url, params, headers, timeout):
        body = url_to_body.get(url)
        if body is None:
            raise AssertionError(f"unexpected URL in test: {url}")
        return TransportResult(url=url, status=200, body=body, headers={})

    def factory(args, cache):
        return VpicClient(
            cache=cache,
            transport=stub_transport,
            max_workers=2,
            max_rps=1000,
            max_fail_rate=0.5,
            timeout=1.0,
        )

    return factory


class TestRefreshSubcommands:
    def _setup(self, tmp_path, fixture_bytes):
        catalog = tmp_path / "catalog.json"
        catalog.write_text(
            json.dumps(
                {
                    "schemaVersion": "1.0.0",
                    "comsccTemplate": {
                        "showroomBaseWeightLbs": 1000,
                        "factoryRatedHp": 1,
                        "factoryRatedTorqueLbFt": 1,
                        "suspIndex": 1,
                    },
                    "vehicleCatalog": [
                        {
                            "vehicleMake": "Honda",
                            "vehicleModel": "Civic",
                            "vehicleYearBegin": 2020,
                            "vehicleYearEnd": 2020,
                        }
                    ],
                }
            )
        )
        url_to_body = {
            "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car": fixture_bytes(
                "makes_for_vehicle_type_car.json"
            ),
            "https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/Honda/modelyear/2020": fixture_bytes(
                "models_honda_2020.json"
            ),
            "https://vpic.nhtsa.dot.gov/api/vehicles/GetCanadianVehicleSpecifications/": fixture_bytes(
                "canadian_specs_honda_civic_2020.json"
            ),
        }
        return catalog, url_to_body

    def test_bootstrap_writes_layer2_files(self, tmp_path, fixture_bytes, capsys):
        catalog, url_to_body = self._setup(tmp_path, fixture_bytes)
        out_dir = tmp_path / "nhtsa-source"
        argv = [
            "bootstrap",
            "--cache-dir", str(tmp_path / "cache"),
            "--out-dir", str(out_dir),
            "--catalog", str(catalog),
            "--year-from", "2020",
            "--year-to", "2020",
            "--current-year", "2026",
            "--run-at", "1700000000",
        ]
        rc = cli.main(argv, client_factory=make_stub_factory(url_to_body))
        assert rc == 0
        # Logical component: every Layer 2 file should land.
        for name in (
            "nhtsa-makes-models-source.json",
            "nhtsa-catalog-style-details-source.json",
            "source-manifest.json",
            "validation-report.json",
        ):
            assert (out_dir / name).exists(), f"missing {name}"

        # Logical component: spot-check the makes-models output.
        doc = json.loads((out_dir / "nhtsa-makes-models-source.json").read_text())
        slugs = {m["make_slug"] for m in doc["makes"]}
        assert "honda" in slugs
        # Logical component: source-manifest records the refresh mode + tally.
        manifest = json.loads((out_dir / "source-manifest.json").read_text())
        assert manifest["refreshMode"] == "bootstrap"
        assert manifest["vpic"]["totalRequests"] == 3  # 1 makes + 1 models + 1 specs

    def test_update_uses_recent_year_window_for_models(self, tmp_path, fixture_bytes):
        catalog, url_to_body = self._setup(tmp_path, fixture_bytes)
        # Logical component: the test catalog row spans 2020 only, so models
        # for 2024-2026 (recent window from current_year=2026) are NOT covered
        # by the stub. We expect an AssertionError from the stub when the CLI
        # requests an unmapped URL — which proves update uses the recent window.
        out_dir = tmp_path / "nhtsa-source"
        argv = [
            "update",
            "--cache-dir", str(tmp_path / "cache"),
            "--out-dir", str(out_dir),
            "--catalog", str(catalog),
            "--year-from", "2020",
            "--year-to", "2026",
            "--current-year", "2026",
            "--recent-years", "3",
            "--run-at", "1700000000",
        ]
        # Logical component: include the recent-window URLs in the stub so
        # the assertion is about *whether* they got requested, not failure mode.
        for year in (2024, 2025, 2026):
            url_to_body[
                f"https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/Honda/modelyear/{year}"
            ] = fixture_bytes("models_honda_2020.json")
        rc = cli.main(argv, client_factory=make_stub_factory(url_to_body))
        assert rc == 0
        manifest = json.loads((out_dir / "source-manifest.json").read_text())
        assert manifest["refreshMode"] == "update"
        # Logical component: 1 makes + 3 models (recent window) + 1 specs = 5.
        assert manifest["vpic"]["totalRequests"] == 5

    def test_high_fail_rate_blocks_layer2_write(self, tmp_path, fixture_bytes):
        catalog = tmp_path / "catalog.json"
        catalog.write_text(json.dumps({"vehicleCatalog": []}))

        out_dir = tmp_path / "nhtsa-source"

        def all_500_factory(args, cache):
            def t(url, params, headers, timeout):
                return TransportResult(url=url, status=500, body=b"", headers={})

            return VpicClient(
                cache=cache,
                transport=t,
                max_workers=1,
                max_rps=100,
                max_fail_rate=0.0,  # any failure breaches
                timeout=1.0,
                max_retries=1,
            )

        rc = cli.main(
            [
                "bootstrap",
                "--cache-dir", str(tmp_path / "cache"),
                "--out-dir", str(out_dir),
                "--catalog", str(catalog),
                "--year-from", "2020",
                "--year-to", "2020",
                "--current-year", "2026",
                "--run-at", "1700000000",
            ],
            client_factory=all_500_factory,
        )
        assert rc == 2
        # Logical component: no Layer 2 file written when fail-rate breached.
        assert not out_dir.exists() or not (out_dir / "source-manifest.json").exists()
