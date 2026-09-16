"""Shared pytest fixtures.

Design goals:
* No external services: Redis is replaced by an in-process fakeredis server
  (``FIREAI_FAKE_REDIS=1`` must be set *before* ``common`` is imported).
* Filesystem isolation: legacy modules read/write ``settings.json``,
  ``pelletdb.json``, ``logs/`` etc. relative to the CWD, so every test runs in
  a fresh temporary directory seeded with the manifests it needs.
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent

# Must happen before anything imports ``common`` (which builds the client at import time).
os.environ.setdefault('FIREAI_FAKE_REDIS', '1')
sys.path.insert(0, str(REPO_ROOT))

from core.redis_client import get_redis  # noqa: E402

# Files/dirs that legacy code expects to find in the working directory.
_SEED_DIRS = ['updater', 'wizard', 'probes', 'controller', 'display', 'notify', 'grillplat', 'distance', 'dashboard']
_SEED_FILES: list[str] = []


@pytest.fixture
def workdir(tmp_path, monkeypatch):
	"""Chdir into an isolated copy of the runtime data files."""
	for d in _SEED_DIRS:
		src = REPO_ROOT / d
		if src.exists():
			shutil.copytree(src, tmp_path / d, ignore=shutil.ignore_patterns('__pycache__'))
	for f in _SEED_FILES:
		shutil.copy(REPO_ROOT / f, tmp_path / f)
	(tmp_path / 'logs').mkdir()
	(tmp_path / 'history').mkdir()
	(tmp_path / 'backups').mkdir()
	(tmp_path / 'recipes').mkdir()
	monkeypatch.chdir(tmp_path)
	return tmp_path


@pytest.fixture(autouse=True)
def _clean_redis():
	"""Every test starts and ends with an empty store."""
	r = get_redis()
	r.flushall()
	yield r
	r.flushall()


@pytest.fixture
def redis_client(_clean_redis):
	return _clean_redis


class FakeClock:
	"""Deterministic replacement for time.time()/time.sleep().

	``sleep`` advances the clock instead of blocking, so loops that pace
	themselves with ``time.sleep`` run at full speed under test.
	"""

	def __init__(self, start=1_700_000_000.0):
		self.now = float(start)

	def time(self):
		return self.now

	def sleep(self, seconds):
		self.now += float(seconds)

	def advance(self, seconds):
		self.now += float(seconds)


@pytest.fixture
def clock(monkeypatch):
	"""Patch ``time.time`` and ``time.sleep`` process-wide for the test."""
	import time as _time

	c = FakeClock()
	monkeypatch.setattr(_time, 'time', c.time)
	monkeypatch.setattr(_time, 'sleep', c.sleep)
	return c


@pytest.fixture
def settings(workdir):
	"""Fresh default settings written to settings.json in the workdir."""
	from common.common import read_settings

	return read_settings(init=True)


@pytest.fixture
def control(settings):
	from common.common import read_control

	return read_control(flush=True)
