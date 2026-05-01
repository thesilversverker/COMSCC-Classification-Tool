"""
Logical component: tests for vpic_client (transport injection, retry, failure
classification, fail-rate guard, token bucket, fetch_many manifest persistence).

All tests use a stub transport so no network is touched. Retries use tenacity's
real backoff; tests explicitly disable backoff via tenacity overrides where speed
matters.
"""

from __future__ import annotations

import threading
import time

import pytest

from vpic_cache import (
    ENDPOINT_MAKES,
    ENDPOINT_MODELS,
    ENDPOINT_SPECS,
    VpicCache,
    cache_key,
)
from vpic_client import (
    FailRateExceeded,
    RetryableServerError,
    TokenBucket,
    TransportError,
    TransportResult,
    VpicClient,
    is_failure_status,
)


# Logical component: tiny stub transport — list of canned responses keyed by URL.
def make_stub(responses: dict[str, Any]):
    """Build a Transport callable from a {url: TransportResult|callable|Exception} map."""
    call_log: list[tuple[str, dict, dict]] = []

    def _stub(url, params, headers, timeout):
        call_log.append((url, dict(params), dict(headers)))
        rule = responses.get(url)
        if rule is None:
            raise AssertionError(f"unexpected URL in test: {url}")
        if isinstance(rule, Exception):
            raise rule
        if callable(rule):
            return rule(url, params, headers, timeout)
        return rule

    _stub.calls = call_log  # type: ignore[attr-defined]
    return _stub


def _result(status: int, body: bytes = b'{"Count":0,"Results":[]}', url="https://x") -> TransportResult:
    return TransportResult(url=url, status=status, body=body, headers={})


# Logical component: zero-backoff client for fast tests; overrides tenacity's wait.
def fast_client(stub, cache, *, max_retries=4, max_fail_rate=0.5, max_workers=2, max_rps=1000) -> VpicClient:
    client = VpicClient(
        cache=cache,
        transport=stub,
        max_workers=max_workers,
        max_rps=max_rps,
        max_fail_rate=max_fail_rate,
        timeout=1.0,
        max_retries=max_retries,
    )
    # Logical component: replace tenacity's wait so retry tests run instantly.
    from tenacity import Retrying, retry_if_exception_type, stop_after_attempt, wait_fixed

    client._retrying = Retrying(  # noqa: SLF001
        retry=retry_if_exception_type((TransportError, RetryableServerError)),
        stop=stop_after_attempt(max_retries),
        wait=wait_fixed(0),
        reraise=True,
    )
    return client


# Logical component: failure classification table — exact contract from the plan.
class TestFailureClassification:
    @pytest.mark.parametrize(
        "status,is_fail",
        [
            (200, False),
            (404, False),  # definitive "no data" — not a fail
            (400, True),   # other 4xx → fail
            (403, True),
            (429, True),   # rate-limited counts as a fail (we caused it)
            (500, True),
            (503, True),
        ],
    )
    def test_status_classification(self, status, is_fail):
        assert is_failure_status(status) is is_fail


# Logical component: single fetch — happy path, 404, retried 5xx, 4xx-non-404.
class TestSingleFetch:
    def test_200_writes_to_cache_and_not_a_failure(self, cache_dir, fixture_bytes):
        url = "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car"
        body = fixture_bytes("makes_for_vehicle_type_car.json")
        stub = make_stub({url: _result(200, body=body, url=url)})
        client = fast_client(stub, VpicCache(cache_dir))

        outcome = client.fetch(ENDPOINT_MAKES, {"vehicleType": "car"})

        assert outcome.status == 200
        assert outcome.is_failure is False
        assert outcome.entry is not None
        assert (cache_dir / outcome.entry.body_path).read_bytes() == body
        assert client.fail_rate == 0.0

    def test_404_recorded_but_not_a_failure(self, cache_dir):
        url = "https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/Tesla/modelyear/1900"
        stub = make_stub({url: _result(404, url=url)})
        client = fast_client(stub, VpicCache(cache_dir))

        outcome = client.fetch(ENDPOINT_MODELS, {"make": "Tesla", "year": 1900})

        assert outcome.status == 404
        assert outcome.is_failure is False
        assert outcome.entry is not None
        assert client.failures == 0

    def test_count_zero_results_is_not_a_failure(self, cache_dir, fixture_bytes):
        url = "https://vpic.nhtsa.dot.gov/api/vehicles/GetCanadianVehicleSpecifications/"
        body = fixture_bytes("empty_results.json")
        stub = make_stub({url: _result(200, body=body, url=url)})
        client = fast_client(stub, VpicCache(cache_dir))

        outcome = client.fetch(
            ENDPOINT_SPECS, {"year": 1900, "make": "Tesla", "model": "ModelS"}
        )

        assert outcome.is_failure is False
        assert client.fail_rate == 0.0

    def test_500_retries_then_fails(self, cache_dir):
        url = "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car"
        stub = make_stub({url: _result(500, url=url)})
        client = fast_client(stub, VpicCache(cache_dir), max_retries=3)

        outcome = client.fetch(ENDPOINT_MAKES, {"vehicleType": "car"})

        assert outcome.is_failure is True
        assert outcome.status == 500
        assert outcome.entry is None
        assert len(stub.calls) == 3, "should have retried up to max_retries"
        assert client.failures == 1

    def test_400_does_not_retry_and_counts_as_failure(self, cache_dir):
        url = "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car"
        stub = make_stub({url: _result(400, url=url)})
        client = fast_client(stub, VpicCache(cache_dir), max_retries=3)

        outcome = client.fetch(ENDPOINT_MAKES, {"vehicleType": "car"})

        assert outcome.is_failure is True
        assert outcome.status == 400
        assert len(stub.calls) == 1, "4xx (non-404) should not retry"

    def test_transport_error_retries_then_fails(self, cache_dir):
        url = "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car"
        stub = make_stub({url: TransportError("connection refused")})
        client = fast_client(stub, VpicCache(cache_dir), max_retries=2)

        outcome = client.fetch(ENDPOINT_MAKES, {"vehicleType": "car"})

        assert outcome.is_failure is True
        assert outcome.status is None
        assert "transport:" in (outcome.error or "")
        assert len(stub.calls) == 2

    def test_5xx_then_200_succeeds(self, cache_dir):
        url = "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car"
        responses = [_result(500, url=url), _result(200, body=b'{"Count":0,"Results":[]}', url=url)]
        idx = {"i": 0}

        def rule(*_args, **_kw):
            r = responses[idx["i"]]
            idx["i"] = min(idx["i"] + 1, len(responses) - 1)
            return r

        stub = make_stub({url: rule})
        client = fast_client(stub, VpicCache(cache_dir), max_retries=3)

        outcome = client.fetch(ENDPOINT_MAKES, {"vehicleType": "car"})

        assert outcome.is_failure is False
        assert outcome.status == 200


# Logical component: fail-rate guard — assert_fail_rate_under_limit.
class TestFailRateGuard:
    def test_within_limit_does_not_raise(self, cache_dir):
        client = fast_client(make_stub({}), VpicCache(cache_dir), max_fail_rate=0.5)
        client._total = 10  # 1/10 = 10% < 50% — fine
        client._failures = 1
        client.assert_fail_rate_under_limit()

    def test_above_limit_raises(self, cache_dir):
        client = fast_client(make_stub({}), VpicCache(cache_dir), max_fail_rate=0.02)
        client._total = 100
        client._failures = 5  # 5% > 2%
        with pytest.raises(FailRateExceeded):
            client.assert_fail_rate_under_limit()

    def test_zero_total_treated_as_zero_rate(self, cache_dir):
        client = fast_client(make_stub({}), VpicCache(cache_dir), max_fail_rate=0.0)
        client.assert_fail_rate_under_limit()


# Logical component: fetch_many persists the manifest and writes one body per outcome.
class TestFetchMany:
    def test_writes_manifest_and_bodies(self, cache_dir, fixture_bytes):
        urls = {
            "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car": _result(
                200,
                body=fixture_bytes("makes_for_vehicle_type_car.json"),
                url="https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car",
            ),
            "https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/Honda/modelyear/2020": _result(
                200,
                body=fixture_bytes("models_honda_2020.json"),
                url="https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/Honda/modelyear/2020",
            ),
        }
        stub = make_stub(urls)
        cache = VpicCache(cache_dir)
        client = fast_client(stub, cache)

        outcomes = client.fetch_many(
            [
                (ENDPOINT_MAKES, {"vehicleType": "car"}),
                (ENDPOINT_MODELS, {"make": "Honda", "year": 2020}),
            ]
        )

        assert len(outcomes) == 2
        assert all(o.is_failure is False for o in outcomes)
        manifest = cache.load_manifest()
        assert len(manifest) == 2
        for o in outcomes:
            assert (cache_dir / o.entry.body_path).exists()


# Logical component: token bucket actually rate-limits.
class TestTokenBucket:
    def test_capacity_drains_then_refills(self):
        b = TokenBucket(rate_per_sec=10, burst=2)
        # Logical component: drain the burst.
        b.acquire()
        b.acquire()
        # Logical component: third acquire must wait at least 1/rate seconds.
        t0 = time.monotonic()
        b.acquire()
        elapsed = time.monotonic() - t0
        assert elapsed >= 0.05, f"third acquire returned in {elapsed:.3f}s — bucket not enforcing rate"

    def test_invalid_rate_rejected(self):
        with pytest.raises(ValueError):
            TokenBucket(rate_per_sec=0)

    def test_thread_safety_under_contention(self):
        # Logical component: many threads share one bucket; total acquires == count.
        b = TokenBucket(rate_per_sec=1000, burst=20)
        n_threads = 8
        per_thread = 5
        counts = [0] * n_threads

        def worker(i):
            for _ in range(per_thread):
                b.acquire()
                counts[i] += 1

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(n_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert sum(counts) == n_threads * per_thread


# Logical component: fail-rate counter increments correctly across mixed outcomes.
class TestCounters:
    def test_mixed_outcomes_track_correctly(self, cache_dir, fixture_bytes):
        urls = {
            "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car": _result(
                200, body=fixture_bytes("makes_for_vehicle_type_car.json"),
                url="https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car",
            ),
            "https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/Honda/modelyear/2020": _result(
                404,
                url="https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/Honda/modelyear/2020",
            ),
            "https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/Honda/modelyear/2021": _result(
                500,
                url="https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/Honda/modelyear/2021",
            ),
        }
        client = fast_client(make_stub(urls), VpicCache(cache_dir), max_retries=2)

        client.fetch(ENDPOINT_MAKES, {"vehicleType": "car"})
        client.fetch(ENDPOINT_MODELS, {"make": "Honda", "year": 2020})
        client.fetch(ENDPOINT_MODELS, {"make": "Honda", "year": 2021})

        assert client.total == 3
        assert client.failures == 1  # only the 500 counts; 200 and 404 do not
        assert client.fail_rate == pytest.approx(1 / 3)
