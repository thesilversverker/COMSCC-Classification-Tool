"""
Logical component: smoke tests for apply_proposed_open_vehicle cutover helper.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCRIPT = _REPO_ROOT / "data-source" / "apply_proposed_open_vehicle.py"
_PROPOSED = _REPO_ROOT / "rules-source" / "open-vehicle" / "_proposed"


@pytest.fixture
def proposed_bundle():
    if not (_PROPOSED / "makes_and_models.json").exists():
        pytest.skip("rules-source/open-vehicle/_proposed/makes_and_models.json not present")
    return _PROPOSED


def test_apply_dry_run_exits_zero_and_prints_plan(proposed_bundle: Path) -> None:
    r = subprocess.run(
        [sys.executable, str(_SCRIPT)],
        cwd=str(_REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert r.returncode == 0, r.stderr + r.stdout
    assert "Dry-run only" in r.stdout


def test_apply_writes_to_target_dir(proposed_bundle: Path, tmp_path: Path) -> None:
    target = tmp_path / "open-vehicle"
    r = subprocess.run(
        [
            sys.executable,
            str(_SCRIPT),
            "--proposed-dir",
            str(proposed_bundle),
            "--target-dir",
            str(target),
            "--apply",
        ],
        cwd=str(_REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert r.returncode == 0, r.stderr + r.stdout
    assert (target / "makes_and_models.json").is_file()
    assert (target / "styles").is_dir()
    style_files = list((target / "styles").glob("*.json"))
    assert len(style_files) >= 1
