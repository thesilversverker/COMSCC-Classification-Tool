"""
Logical component: VpicClient — token-bucket-rated, retried, cache-aware HTTP client for VPIC.

Implements the contract from the plan's "VpicClient requirements":
- pluggable transport (HTTPX by default, stubs in tests; no network in unit tests),
- exponential-backoff retries on connection/timeout/5xx via tenacity,
- two independent caps: ThreadPoolExecutor concurrency + per-second token bucket,
- failure classification: connection/timeout/DNS, 5xx-after-retries, and non-404 4xx
  count toward the run's fail rate; 404 and `Count:0` legitimately negative responses
  do not,
- max-fail-rate guard refuses to declare success if too many requests failed,
- polite headers (`format=json`, `User-Agent`) and configurable per-request timeout.

This module never touches Layer 2 or Layer 3 — it only fills the raw cache.
"""

from __future__ import annotations

import dataclasses
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Iterable, Mapping
from urllib.parse import quote

import httpx
from tenacity import (
    Retrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

from vpic_cache import KNOWN_ENDPOINTS, CacheEntry, VpicCache, cache_key

log = logging.getLogger(__name__)

# Logical component: VPIC base URL + endpoint URL templates.
VPIC_BASE_URL = "https://vpic.nhtsa.dot.gov/api/vehicles"
DEFAULT_USER_AGENT_FMT = "comscc-classification-tool/{version} (+{repo})"


# Logical component: transport layer abstraction. Returns TransportResult on HTTP-level
# completion (any status); raises TransportError on connection-level failures so tenacity
# can retry. The default httpx implementation is wrapped by HttpxTransport below.
class TransportError(Exception):
    """Connection error, timeout, or DNS failure. Always counts toward the fail rate."""


class RetryableServerError(Exception):
    """5xx response that should be retried before being declared a failure."""

    def __init__(self, status: int, body: bytes) -> None:
        super().__init__(f"VPIC 5xx after retries: {status}")
        self.status = status
        self.body = body


@dataclasses.dataclass
class TransportResult:
    url: str
    status: int
    body: bytes
    headers: dict[str, str]


# Logical component: the only assumption VpicClient makes about its transport.
Transport = Callable[[str, Mapping[str, Any], Mapping[str, str], float], TransportResult]


def httpx_transport(client: httpx.Client) -> Transport:
    """Wrap an httpx.Client into the Transport callable shape, mapping connection
    failures to TransportError so tenacity (in VpicClient) can retry them."""

    def _call(
        url: str, params: Mapping[str, Any], headers: Mapping[str, str], timeout: float
    ) -> TransportResult:
        try:
            resp = client.get(url, params=dict(params), headers=dict(headers), timeout=timeout)
        except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as e:
            raise TransportError(str(e)) from e
        return TransportResult(
            url=str(resp.url),
            status=resp.status_code,
            body=resp.content,
            headers={k: v for k, v in resp.headers.items()},
        )

    return _call


# Logical component: thread-safe token bucket for global RPS cap. Independent
# of the worker pool — the pool caps in-flight count, the bucket caps rate.
class TokenBucket:
    def __init__(self, rate_per_sec: float, burst: float | None = None) -> None:
        if rate_per_sec <= 0:
            raise ValueError("rate_per_sec must be > 0")
        self.rate = float(rate_per_sec)
        self.capacity = float(burst if burst is not None else rate_per_sec)
        self._tokens = self.capacity
        self._last = time.monotonic()
        self._lock = threading.Lock()

    def acquire(self, tokens: float = 1.0) -> None:
        """Block until `tokens` are available. Returns once they have been deducted."""
        while True:
            with self._lock:
                now = time.monotonic()
                elapsed = now - self._last
                self._last = now
                self._tokens = min(self.capacity, self._tokens + elapsed * self.rate)
                if self._tokens >= tokens:
                    self._tokens -= tokens
                    return
                # Logical component: wait long enough that the deficit is refilled.
                deficit = tokens - self._tokens
                wait = deficit / self.rate
            time.sleep(wait)


# Logical component: URL formatting. Path-arg endpoints get the args baked into
# the URL; query-arg endpoints get them in the query string. Either way, the
# `params` dict passed to fetch() is the full canonical set used for cache_key.
def format_url(endpoint: str, params: Mapping[str, Any]) -> tuple[str, dict[str, Any]]:
    """Return (url, query_params) for a (endpoint, params) pair.

    The remaining query_params are sent as `?key=value`, plus `format=json` always.
    """
    if endpoint == "GetMakesForVehicleType":
        vt = params["vehicleType"]
        return f"{VPIC_BASE_URL}/GetMakesForVehicleType/{quote(str(vt))}", {"format": "json"}

    if endpoint == "GetModelsForMakeYear":
        make = quote(str(params["make"]))
        year = int(params["year"])
        return (
            f"{VPIC_BASE_URL}/GetModelsForMakeYear/make/{make}/modelyear/{year}",
            {"format": "json"},
        )

    if endpoint == "GetCanadianVehicleSpecifications":
        query = {
            "year": int(params["year"]),
            "make": str(params["make"]),
            "model": str(params["model"]),
            "units": str(params.get("units", "Metric")),
            "format": "json",
        }
        return f"{VPIC_BASE_URL}/GetCanadianVehicleSpecifications/", query

    raise ValueError(f"unknown VPIC endpoint: {endpoint}")


# Logical component: failure classification per the plan's "VpicClient requirements".
# Only HTTP-level outcomes pass through here; TransportError is always a failure
# upstream of this function.
def is_failure_status(status: int) -> bool:
    """Return True if a status counts toward the run's fail rate."""
    if status == 404:
        return False  # definitive negative answer; not a failure
    if 200 <= status < 300:
        return False
    return True


# Logical component: per-fetch outcome envelope handed back to the caller.
@dataclasses.dataclass
class FetchOutcome:
    endpoint: str
    params: dict[str, Any]
    cache_key: str
    entry: CacheEntry | None  # None when the request was a hard failure
    status: int | None
    is_failure: bool
    error: str | None


# Logical component: the client. Holds transport + cache + caps + fail-rate accounting.
class FailRateExceeded(RuntimeError):
    """Raised when more than max_fail_rate of requests in this run failed."""


class VpicClient:
    def __init__(
        self,
        *,
        cache: VpicCache,
        transport: Transport,
        max_workers: int = 6,
        max_rps: float = 5.0,
        max_fail_rate: float = 0.02,
        timeout: float = 20.0,
        max_retries: int = 4,
        user_agent: str = "comscc-classification-tool/0.1.0 (+local)",
    ) -> None:
        if max_fail_rate < 0 or max_fail_rate > 1:
            raise ValueError("max_fail_rate must be in [0, 1]")
        self.cache = cache
        self.transport = transport
        self.max_workers = max_workers
        self.max_fail_rate = max_fail_rate
        self.timeout = timeout
        self.user_agent = user_agent
        self._bucket = TokenBucket(rate_per_sec=max_rps)
        self._retrying = Retrying(
            retry=retry_if_exception_type((TransportError, RetryableServerError)),
            stop=stop_after_attempt(max_retries),
            wait=wait_exponential_jitter(initial=0.5, max=8.0),
            reraise=True,
        )
        # Logical component: per-run accounting; reset by reset_counters().
        self._lock = threading.Lock()
        self._total = 0
        self._failures = 0

    # Counters ------------------------------------------------------------

    def reset_counters(self) -> None:
        with self._lock:
            self._total = 0
            self._failures = 0

    @property
    def total(self) -> int:
        return self._total

    @property
    def failures(self) -> int:
        return self._failures

    @property
    def fail_rate(self) -> float:
        return 0.0 if self._total == 0 else self._failures / self._total

    def assert_fail_rate_under_limit(self) -> None:
        """Raise FailRateExceeded if `fail_rate > max_fail_rate`."""
        rate = self.fail_rate
        if rate > self.max_fail_rate:
            raise FailRateExceeded(
                f"VPIC fail rate {rate:.2%} > max {self.max_fail_rate:.2%} "
                f"({self._failures}/{self._total} requests)"
            )

    # Single-fetch path ---------------------------------------------------

    def fetch(self, endpoint: str, params: Mapping[str, Any]) -> FetchOutcome:
        """Fetch one (endpoint, params) and write it to the cache. Pure I/O — no parsing."""
        if endpoint not in KNOWN_ENDPOINTS:
            raise ValueError(f"unknown VPIC endpoint: {endpoint}")
        key = cache_key(endpoint, params)
        url, query = format_url(endpoint, params)
        headers = {"User-Agent": self.user_agent, "Accept": "application/json"}

        self._bucket.acquire()
        try:
            result = self._retrying(self._do_one_request, url, query, headers)
        except TransportError as e:
            with self._lock:
                self._total += 1
                self._failures += 1
            return FetchOutcome(
                endpoint=endpoint,
                params=dict(params),
                cache_key=key,
                entry=None,
                status=None,
                is_failure=True,
                error=f"transport: {e}",
            )
        except RetryableServerError as e:
            with self._lock:
                self._total += 1
                self._failures += 1
            return FetchOutcome(
                endpoint=endpoint,
                params=dict(params),
                cache_key=key,
                entry=None,
                status=e.status,
                is_failure=True,
                error=f"5xx after retries: {e.status}",
            )

        # Logical component: 4xx/5xx-not-in-retry-set/200 all reach here as TransportResult.
        is_fail = is_failure_status(result.status)
        with self._lock:
            self._total += 1
            if is_fail:
                self._failures += 1

        # Logical component: cache every response — even non-2xx — so refresh runs are
        # auditable. The pydantic parse step in step 5 will skip non-200s.
        entry = self.cache.write(
            endpoint=endpoint,
            params=params,
            url=result.url,
            status=result.status,
            body=result.body,
            etag=result.headers.get("etag") or result.headers.get("ETag"),
        )
        return FetchOutcome(
            endpoint=endpoint,
            params=dict(params),
            cache_key=key,
            entry=entry,
            status=result.status,
            is_failure=is_fail,
            error=None,
        )

    def _do_one_request(
        self, url: str, query: Mapping[str, Any], headers: Mapping[str, str]
    ) -> TransportResult:
        """One transport call. Tenacity retries this on TransportError + RetryableServerError."""
        result = self.transport(url, query, headers, self.timeout)
        if 500 <= result.status < 600:
            raise RetryableServerError(result.status, result.body)
        return result

    # Many-fetch path -----------------------------------------------------

    def fetch_many(
        self,
        requests: Iterable[tuple[str, Mapping[str, Any]]],
        *,
        on_progress: Callable[[FetchOutcome], None] | None = None,
    ) -> list[FetchOutcome]:
        """Fetch many requests concurrently and persist the manifest exactly once.

        The token bucket and concurrency cap are independent: workers may sit idle
        waiting on the bucket when the network is fast, and the bucket may sit full
        while all workers are busy.
        """
        items = list(requests)
        outcomes: list[FetchOutcome] = []
        with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
            futures = {pool.submit(self.fetch, ep, p): (ep, p) for ep, p in items}
            for fut in as_completed(futures):
                outcome = fut.result()
                outcomes.append(outcome)
                if on_progress is not None:
                    on_progress(outcome)

        # Logical component: persist manifest once at end (cheap + crash-resistant
        # because each per-response file is written before this point).
        manifest = self.cache.load_manifest()
        for o in outcomes:
            if o.entry is not None:
                manifest[o.cache_key] = o.entry
        self.cache.save_manifest(manifest)
        return outcomes


# Logical component: convenience JSON parse helper for callers that want to roundtrip
# a successful FetchOutcome straight into a pydantic model. Step 5 will use this.
def parse_outcome_body(outcome: FetchOutcome, cache: VpicCache) -> dict[str, Any] | None:
    """Read the cached body for a successful outcome and return parsed JSON, or None."""
    if outcome.entry is None or outcome.is_failure or outcome.status != 200:
        return None
    return json.loads(cache.read_body(outcome.entry).decode("utf-8"))
