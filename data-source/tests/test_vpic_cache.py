"""
Logical component: tests for vpic_cache (cache key, manifest round-trip, TTL policy
matrix, fcntl file lock semantics, classify_request).
"""

from __future__ import annotations

import multiprocessing as mp
import time

import pytest

from vpic_cache import (
    ENDPOINT_MAKES,
    ENDPOINT_MODELS,
    ENDPOINT_SPECS,
    TTL_MAKES_SECONDS,
    TTL_SPECS_HISTORICAL_SECONDS,
    CacheEntry,
    CacheLockTimeout,
    TTLPolicy,
    VpicCache,
    cache_dir_lock,
    cache_key,
    classify_many,
    classify_request,
)


# Logical component: cache_key is stable, deterministic, and order-insensitive.
class TestCacheKey:
    def test_same_inputs_same_key(self):
        a = cache_key(ENDPOINT_MAKES, {"vehicleType": "car"})
        b = cache_key(ENDPOINT_MAKES, {"vehicleType": "car"})
        assert a == b

    def test_param_order_does_not_matter(self):
        a = cache_key(ENDPOINT_SPECS, {"year": 2020, "make": "Honda", "model": "Civic"})
        b = cache_key(ENDPOINT_SPECS, {"model": "Civic", "make": "Honda", "year": 2020})
        assert a == b

    def test_different_params_different_key(self):
        a = cache_key(ENDPOINT_MODELS, {"make": "Honda", "year": 2020})
        b = cache_key(ENDPOINT_MODELS, {"make": "Honda", "year": 2021})
        assert a != b


# Logical component: VpicCache.write + manifest round-trip.
class TestManifestRoundTrip:
    def test_write_creates_per_response_file(self, cache_dir, fixture_bytes):
        cache = VpicCache(cache_dir)
        body = fixture_bytes("makes_for_vehicle_type_car.json")
        entry = cache.write(
            endpoint=ENDPOINT_MAKES,
            params={"vehicleType": "car"},
            url="https://example.invalid/makes",
            status=200,
            body=body,
            etag='W/"abc"',
        )
        body_path = cache_dir / entry.body_path
        assert body_path.exists()
        assert body_path.read_bytes() == body
        assert entry.response_sha256

    def test_save_load_manifest_roundtrip(self, cache_dir, fixture_bytes):
        cache = VpicCache(cache_dir)
        e1 = cache.write(
            endpoint=ENDPOINT_MAKES,
            params={"vehicleType": "car"},
            url="https://example.invalid/m",
            status=200,
            body=fixture_bytes("makes_for_vehicle_type_car.json"),
            etag=None,
        )
        e2 = cache.write(
            endpoint=ENDPOINT_MODELS,
            params={"make": "Honda", "year": 2020},
            url="https://example.invalid/mod",
            status=200,
            body=fixture_bytes("models_honda_2020.json"),
            etag=None,
        )
        cache.save_manifest({cache_key(e1.endpoint, e1.params): e1, cache_key(e2.endpoint, e2.params): e2})
        loaded = cache.load_manifest()
        assert len(loaded) == 2
        roundtrip = loaded[cache_key(e1.endpoint, e1.params)]
        assert roundtrip.endpoint == e1.endpoint
        assert roundtrip.params == {"vehicleType": "car"}
        assert roundtrip.status == 200

    def test_load_manifest_returns_empty_when_missing(self, cache_dir):
        cache = VpicCache(cache_dir)
        assert cache.load_manifest() == {}


# Logical component: per-class TTL policy matches the plan's TTL table exactly.
class TestTTLPolicy:
    @pytest.fixture
    def policy(self):
        return TTLPolicy(current_year=2026)

    @pytest.fixture
    def now(self):
        return 1_700_000_000.0  # arbitrary fixed run time

    def test_makes_fresh_within_7_days(self, policy, now):
        assert policy.is_fresh(ENDPOINT_MAKES, {"vehicleType": "car"}, now - (TTL_MAKES_SECONDS - 1), now)

    def test_makes_stale_after_7_days(self, policy, now):
        assert not policy.is_fresh(
            ENDPOINT_MAKES, {"vehicleType": "car"}, now - (TTL_MAKES_SECONDS + 1), now
        )

    def test_historical_models_immutable(self, policy, now):
        # year < currentYear - 1 -> infinite TTL
        assert policy.is_fresh(ENDPOINT_MODELS, {"make": "Honda", "year": 2010}, 0.0, now)

    def test_recent_models_always_stale(self, policy, now):
        # year in {currentYear-1, currentYear} -> refetch every run
        assert not policy.is_fresh(ENDPOINT_MODELS, {"make": "Honda", "year": 2025}, now - 1, now)
        assert not policy.is_fresh(ENDPOINT_MODELS, {"make": "Honda", "year": 2026}, now - 1, now)

    def test_historical_specs_30_day_ttl(self, policy, now):
        assert policy.is_fresh(
            ENDPOINT_SPECS,
            {"year": 2010, "make": "Honda", "model": "Civic"},
            now - (TTL_SPECS_HISTORICAL_SECONDS - 1),
            now,
        )
        assert not policy.is_fresh(
            ENDPOINT_SPECS,
            {"year": 2010, "make": "Honda", "model": "Civic"},
            now - (TTL_SPECS_HISTORICAL_SECONDS + 1),
            now,
        )

    def test_recent_specs_always_stale(self, policy, now):
        assert not policy.is_fresh(
            ENDPOINT_SPECS, {"year": 2025, "make": "Honda", "model": "Civic"}, now - 1, now
        )

    def test_ignore_ttl_overrides_everything(self, policy, now):
        assert policy.is_fresh(
            ENDPOINT_MAKES, {"vehicleType": "car"}, 0.0, now, ignore_ttl=True
        )

    def test_unknown_endpoint_treated_as_missing(self, policy, now):
        assert not policy.is_fresh("UnknownEndpoint", {}, now - 1, now)


# Logical component: classify_request uses TTL + manifest correctly.
class TestClassifyRequest:
    def _entry(self, endpoint, params, fetched_at, *, status=200):
        return CacheEntry(
            endpoint=endpoint,
            params=dict(params),
            url="https://example.invalid",
            status=status,
            fetched_at=fetched_at,
            response_sha256="x" * 64,
            etag=None,
            body_path=f"{endpoint}/{cache_key(endpoint, params)}.json",
        )

    def test_missing(self):
        run_at = 1_700_000_000.0
        result = classify_request(
            ENDPOINT_MAKES,
            {"vehicleType": "car"},
            manifest={},
            policy=TTLPolicy(2026),
            run_at=run_at,
        )
        assert result == "missing"

    def test_cached_fresh(self):
        run_at = 1_700_000_000.0
        params = {"vehicleType": "car"}
        manifest = {cache_key(ENDPOINT_MAKES, params): self._entry(ENDPOINT_MAKES, params, run_at - 60)}
        assert (
            classify_request(
                ENDPOINT_MAKES, params, manifest=manifest, policy=TTLPolicy(2026), run_at=run_at
            )
            == "cached-fresh"
        )

    def test_cached_stale(self):
        run_at = 1_700_000_000.0
        params = {"vehicleType": "car"}
        manifest = {
            cache_key(ENDPOINT_MAKES, params): self._entry(
                ENDPOINT_MAKES, params, run_at - (TTL_MAKES_SECONDS + 60)
            )
        }
        assert (
            classify_request(
                ENDPOINT_MAKES, params, manifest=manifest, policy=TTLPolicy(2026), run_at=run_at
            )
            == "cached-stale"
        )

    def test_classify_many_buckets_correctly(self):
        run_at = 1_700_000_000.0
        params_fresh = {"vehicleType": "car"}
        params_missing = {"make": "Honda", "year": 2026}  # recent → always stale, but missing
        params_historical_models = {"make": "Honda", "year": 2010}
        manifest = {
            cache_key(ENDPOINT_MAKES, params_fresh): self._entry(
                ENDPOINT_MAKES, params_fresh, run_at - 60
            ),
            cache_key(ENDPOINT_MODELS, params_historical_models): self._entry(
                ENDPOINT_MODELS, params_historical_models, 0.0
            ),
        }
        buckets = classify_many(
            [
                (ENDPOINT_MAKES, params_fresh),
                (ENDPOINT_MODELS, params_missing),
                (ENDPOINT_MODELS, params_historical_models),
            ],
            manifest=manifest,
            policy=TTLPolicy(2026),
            run_at=run_at,
        )
        assert len(buckets["cached-fresh"]) == 2
        assert len(buckets["missing"]) == 1


# Logical component: fcntl advisory lock — fail mode raises immediately, wait mode blocks.
class TestCacheDirLock:
    def test_fail_mode_raises_when_already_held(self, cache_dir):
        with cache_dir_lock(cache_dir, mode="fail"):
            with pytest.raises(CacheLockTimeout):
                with cache_dir_lock(cache_dir, mode="fail"):
                    pass

    def test_lock_releases_after_context(self, cache_dir):
        with cache_dir_lock(cache_dir, mode="fail"):
            pass
        # Logical component: should be reacquirable now.
        with cache_dir_lock(cache_dir, mode="fail"):
            pass

    def test_unknown_mode_rejected(self, cache_dir):
        with pytest.raises(ValueError):
            with cache_dir_lock(cache_dir, mode="bogus"):
                pass

    def test_wait_mode_blocks_until_released(self, cache_dir):
        # Logical component: spawn a child that holds the lock briefly; parent wait-locks.
        ready_q: mp.Queue = mp.Queue()

        def child():
            with cache_dir_lock(cache_dir, mode="fail"):
                ready_q.put("locked")
                time.sleep(0.4)

        p = mp.Process(target=child)
        p.start()
        try:
            assert ready_q.get(timeout=2) == "locked"
            t0 = time.monotonic()
            with cache_dir_lock(cache_dir, mode="wait"):
                elapsed = time.monotonic() - t0
            assert elapsed >= 0.1, "wait mode should have blocked while child held the lock"
        finally:
            p.join(timeout=2)
            assert p.exitcode == 0
