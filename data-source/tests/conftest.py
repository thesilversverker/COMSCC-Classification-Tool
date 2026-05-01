"""
Logical component: shared pytest plumbing — sys.path, fixture loading, deterministic
clock for cache age tests.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Logical component: make the data-source modules importable without packaging.
DATA_SOURCE = Path(__file__).resolve().parent.parent
if str(DATA_SOURCE) not in sys.path:
    sys.path.insert(0, str(DATA_SOURCE))

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "vpic"


# Logical component: fixture loader — keeps test bodies short and uniform.
@pytest.fixture
def fixture_bytes():
    def _load(name: str) -> bytes:
        return (FIXTURES / name).read_bytes()

    return _load


@pytest.fixture
def fixture_json():
    def _load(name: str) -> dict:
        with (FIXTURES / name).open(encoding="utf-8") as f:
            return json.load(f)

    return _load


# Logical component: per-test cache directory under tmp_path so file lock and
# manifest tests don't see each other's state.
@pytest.fixture
def cache_dir(tmp_path) -> Path:
    d = tmp_path / "vpic-cache"
    d.mkdir()
    return d
