"""
Logical component: raw VPIC response cache + manifest + per-class TTL policy + file lock.

Layout under cache_dir (default `data-source/.cache/vpic/`, gitignored):

    .lock                            -> fcntl advisory lock; one writer at a time
    manifest.json                    -> single committed source of truth for "what's cached"
    GetMakesForVehicleType/<key>.json -> raw response body, one file per request
    GetModelsForMakeYear/<key>.json
    GetCanadianVehicleSpecifications/<key>.json

The manifest is the canonical index. Per-response files exist alongside it for
forensic diffing; if they ever drift from the manifest, the manifest wins.

This module does NOT touch the network. It is consumed by VpicClient (which
brings the network) and by the `plan` CLI (which only reads).
"""

from __future__ import annotations

import dataclasses
import errno
import fcntl
import hashlib
import json
import os
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping
from urllib.parse import urlencode

# Logical component: the four endpoint classes that need TTL handling.
ENDPOINT_MAKES = "GetMakesForVehicleType"
ENDPOINT_MODELS = "GetModelsForMakeYear"
ENDPOINT_SPECS = "GetCanadianVehicleSpecifications"
KNOWN_ENDPOINTS = frozenset({ENDPOINT_MAKES, ENDPOINT_MODELS, ENDPOINT_SPECS})

# Logical component: per-class TTLs from the plan's "Per-class TTL policy" table.
# `None` means "always re-fetch" (every run); `"infinite"` means "never expires".
_SECONDS_PER_DAY = 86400
TTL_MAKES_SECONDS = 7 * _SECONDS_PER_DAY
TTL_SPECS_HISTORICAL_SECONDS = 30 * _SECONDS_PER_DAY


# Logical component: stable cache key — sha256 over a canonicalized "endpoint?sorted_params".
# Same input → same key across machines, processes, and Python versions.
def _canonical_param_string(params: Mapping[str, Any]) -> str:
    items = sorted((str(k), "" if v is None else str(v)) for k, v in params.items())
    return urlencode(items)


def cache_key(endpoint: str, params: Mapping[str, Any]) -> str:
    """Return a stable 16-hex-char key for (endpoint, params)."""
    canonical = f"{endpoint}?{_canonical_param_string(params)}"
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# Logical component: a single cache entry — what the manifest stores and what
# read() returns. JSON-serializable; dataclasses.asdict produces the manifest row.
@dataclasses.dataclass
class CacheEntry:
    endpoint: str
    params: dict[str, Any]
    url: str
    status: int
    fetched_at: float
    response_sha256: str
    etag: str | None
    body_path: str  # repo-relative path under cache_dir; for the manifest

    def to_manifest_row(self) -> dict[str, Any]:
        d = dataclasses.asdict(self)
        # Logical component: store params with sorted keys for deterministic manifests.
        d["params"] = {k: self.params[k] for k in sorted(self.params)}
        return d

    @classmethod
    def from_manifest_row(cls, row: Mapping[str, Any]) -> "CacheEntry":
        return cls(
            endpoint=row["endpoint"],
            params=dict(row.get("params", {})),
            url=row["url"],
            status=int(row["status"]),
            fetched_at=float(row["fetched_at"]),
            response_sha256=row["response_sha256"],
            etag=row.get("etag"),
            body_path=row["body_path"],
        )


# Logical component: per-class TTL policy. Pure function of (endpoint, params, fetched_at, run_at, current_year).
class TTLPolicy:
    """Implements the table from `plan.md > Per-class TTL policy`.

    Use `is_fresh()` to decide whether a cached entry can be reused or must be refetched.
    """

    def __init__(self, current_year: int) -> None:
        self.current_year = int(current_year)

    def is_fresh(
        self,
        endpoint: str,
        params: Mapping[str, Any],
        fetched_at: float,
        run_at: float,
        *,
        ignore_ttl: bool = False,
    ) -> bool:
        if ignore_ttl:
            return True

        age = max(0.0, run_at - fetched_at)

        if endpoint == ENDPOINT_MAKES:
            return age < TTL_MAKES_SECONDS

        if endpoint == ENDPOINT_MODELS:
            year = _extract_year(params)
            if year is None:
                return False  # be conservative — refetch unknown-year requests
            if year >= self.current_year - 1:
                return False  # current and prior year refetched every run
            return True  # historical — immutable, only cleared by --full-refresh

        if endpoint == ENDPOINT_SPECS:
            year = _extract_year(params)
            if year is None:
                return False
            if year >= self.current_year - 1:
                return False  # current/prior year refetched every run
            return age < TTL_SPECS_HISTORICAL_SECONDS

        # Unknown endpoint — treat as missing so a curator notices.
        return False


def _extract_year(params: Mapping[str, Any]) -> int | None:
    """Pull a numeric year out of the params blob; tolerate string-shaped years."""
    candidates = [params.get("year"), params.get("modelYear"), params.get("modelyear")]
    for c in candidates:
        if c is None:
            continue
        try:
            return int(c)
        except (TypeError, ValueError):
            continue
    return None


# Logical component: fcntl-based advisory lock with `wait` and `fail` modes.
class CacheLockTimeout(RuntimeError):
    """Raised when --lock-mode=fail finds the cache already locked."""


@contextmanager
def cache_dir_lock(cache_dir: Path, *, mode: str = "fail") -> Iterator[None]:
    """Acquire a POSIX advisory lock on `<cache_dir>/.lock`.

    mode='fail' (default): raise CacheLockTimeout immediately if held.
    mode='wait': block until the lock is available.
    """
    if mode not in ("fail", "wait"):
        raise ValueError(f"unknown lock mode: {mode}")

    cache_dir.mkdir(parents=True, exist_ok=True)
    lock_path = cache_dir / ".lock"
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        flag = fcntl.LOCK_EX if mode == "wait" else fcntl.LOCK_EX | fcntl.LOCK_NB
        try:
            fcntl.flock(fd, flag)
        except OSError as e:
            if e.errno in (errno.EWOULDBLOCK, errno.EAGAIN):
                raise CacheLockTimeout(f"cache locked: {lock_path}") from None
            raise
        yield
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


# Logical component: VpicCache — read/write API over the disk layout. Knows nothing about HTTP.
class VpicCache:
    def __init__(self, cache_dir: Path | str) -> None:
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.manifest_path = self.cache_dir / "manifest.json"

    # Manifest API ---------------------------------------------------------

    def load_manifest(self) -> dict[str, CacheEntry]:
        """Return key → CacheEntry. Empty dict when no manifest yet."""
        if not self.manifest_path.exists():
            return {}
        with self.manifest_path.open(encoding="utf-8") as f:
            doc = json.load(f)
        out: dict[str, CacheEntry] = {}
        for key, row in (doc.get("entries") or {}).items():
            out[key] = CacheEntry.from_manifest_row(row)
        return out

    def save_manifest(self, entries: Mapping[str, CacheEntry]) -> None:
        """Atomically write manifest with deterministically-ordered keys + entry fields."""
        ordered_keys = sorted(entries)
        doc = {
            "schemaVersion": "1.0.0",
            "writtenAt": time.time(),
            "entries": {k: entries[k].to_manifest_row() for k in ordered_keys},
        }
        tmp = self.manifest_path.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, self.manifest_path)

    # Per-response file API ------------------------------------------------

    def _body_path(self, endpoint: str, key: str) -> Path:
        return self.cache_dir / endpoint / f"{key}.json"

    def write(
        self,
        *,
        endpoint: str,
        params: Mapping[str, Any],
        url: str,
        status: int,
        body: bytes,
        etag: str | None,
        fetched_at: float | None = None,
    ) -> CacheEntry:
        """Write a per-response file and return the CacheEntry to merge into the manifest.

        Caller is responsible for batching manifest saves (one disk write per fetch_many run
        keeps step 5+ cheap even with thousands of entries).
        """
        if endpoint not in KNOWN_ENDPOINTS:
            raise ValueError(f"unknown endpoint for cache: {endpoint}")

        key = cache_key(endpoint, params)
        body_path = self._body_path(endpoint, key)
        body_path.parent.mkdir(parents=True, exist_ok=True)
        body_path.write_bytes(body)

        return CacheEntry(
            endpoint=endpoint,
            params=dict(params),
            url=url,
            status=int(status),
            fetched_at=time.time() if fetched_at is None else float(fetched_at),
            response_sha256=sha256_bytes(body),
            etag=etag,
            body_path=str(body_path.relative_to(self.cache_dir)),
        )

    def read_body(self, entry: CacheEntry) -> bytes:
        """Re-read the on-disk response body for a manifest entry."""
        path = self.cache_dir / entry.body_path
        return path.read_bytes()


# Logical component: helper used by the `plan` CLI and step 5+ refresh logic.
# Classifies each (endpoint, params) request against the cache and TTL policy.
def classify_request(
    endpoint: str,
    params: Mapping[str, Any],
    *,
    manifest: Mapping[str, CacheEntry],
    policy: TTLPolicy,
    run_at: float,
    ignore_ttl: bool = False,
) -> str:
    """Return one of: 'cached-fresh', 'cached-stale', 'missing'."""
    key = cache_key(endpoint, params)
    entry = manifest.get(key)
    if entry is None:
        return "missing"
    if policy.is_fresh(endpoint, params, entry.fetched_at, run_at, ignore_ttl=ignore_ttl):
        return "cached-fresh"
    return "cached-stale"


def classify_many(
    requests: Iterable[tuple[str, Mapping[str, Any]]],
    *,
    manifest: Mapping[str, CacheEntry],
    policy: TTLPolicy,
    run_at: float,
    ignore_ttl: bool = False,
) -> dict[str, list[tuple[str, Mapping[str, Any]]]]:
    """Bucket many requests at once. Order within each bucket follows input order."""
    buckets: dict[str, list[tuple[str, Mapping[str, Any]]]] = {
        "cached-fresh": [],
        "cached-stale": [],
        "missing": [],
    }
    for endpoint, params in requests:
        bucket = classify_request(
            endpoint, params, manifest=manifest, policy=policy, run_at=run_at, ignore_ttl=ignore_ttl
        )
        buckets[bucket].append((endpoint, params))
    return buckets
