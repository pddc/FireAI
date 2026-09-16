"""Single place that hands out the Redis connection used for IPC.

Configuration (environment variables):

    FIREAI_REDIS_URL   redis://host:port/db   (default redis://localhost:6379/0)
    FIREAI_FAKE_REDIS  "1" to use an in-process fakeredis server. Every caller in
                       the process shares the same fake server, so the control
                       loop, API and tests see one consistent store.

``get_redis()`` is safe to call at import time from legacy modules; the client
is created lazily on first use and cached for the life of the process.
"""
from __future__ import annotations

import os
import threading

import redis

_lock = threading.Lock()
_client: redis.Redis | None = None
_fake_server = None


def redis_url() -> str:
	return os.environ.get('FIREAI_REDIS_URL', 'redis://localhost:6379/0')


def use_fake_redis() -> bool:
	return os.environ.get('FIREAI_FAKE_REDIS', '') in ('1', 'true', 'yes')


def _make_client() -> redis.Redis:
	if use_fake_redis():
		global _fake_server
		import fakeredis

		if _fake_server is None:
			_fake_server = fakeredis.FakeServer()
		return fakeredis.FakeStrictRedis(server=_fake_server, decode_responses=True)
	return redis.StrictRedis.from_url(redis_url(), decode_responses=True)


def get_redis() -> redis.Redis:
	"""Return the process-wide Redis client (created on first call)."""
	global _client
	if _client is None:
		with _lock:
			if _client is None:
				_client = _make_client()
	return _client


def reset_redis(flush: bool = False) -> None:
	"""Drop the cached client (and optionally flush the fake server).

	Used by the test-suite between tests so every test starts from an empty
	store. Production code should never need this.
	"""
	global _client, _fake_server
	with _lock:
		if flush and _client is not None:
			try:
				_client.flushall()
			except Exception:
				pass
		_client = None
		if flush:
			_fake_server = None
