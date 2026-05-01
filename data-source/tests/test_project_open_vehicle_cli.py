"""
Logical component: CLI integration for project_open_vehicle (--strict exit code).
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCRIPT = _REPO_ROOT / "data-source" / "project_open_vehicle.py"


def test_strict_exits_one_on_unresolved_catalog_row(tmp_path: Path) -> None:
    """Unknown catalog make → `--strict` exits 1 after catalog gate."""
    doc = {"vehicleCatalog": [{"vehicleMake": "TotallyUnknownMakeXYZ", "vehicleModel": "Foo"}]}
    path = tmp_path / "bad-catalog.json"
    path.write_text(json.dumps(doc), encoding="utf-8")

    r = subprocess.run(
        [sys.executable, str(_SCRIPT), "--catalog", str(path), "--verify", "--strict"],
        cwd=str(_REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert r.returncode == 1, r.stderr + r.stdout


def test_strict_ok_when_catalog_empty(tmp_path: Path) -> None:
    path = tmp_path / "empty.json"
    path.write_text(json.dumps({"vehicleCatalog": []}), encoding="utf-8")
    r = subprocess.run(
        [sys.executable, str(_SCRIPT), "--catalog", str(path), "--verify", "--strict"],
        cwd=str(_REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert r.returncode == 0
