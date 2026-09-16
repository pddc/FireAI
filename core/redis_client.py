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

import logging
import os
import threading
import time

import redis

_lock = threading.Lock()
_client: redis.Redis | None = None
_fake_server = None


def redis_url() -> str:
	return os.environ.get('FIREAI_REDIS_URL', 'redis://localhost:6379/0')


def use_fake_redis() -> bool:
	return os.environ.get('FIREAI_FAKE_REDIS', '') in ('1', 'true', 'yes')


REDIS_UNAVAILABLE_WARNING = 'Redis is unavailable. Using safe fallbacks until the service recovers.'


class ResilientRedisClient:
	"""Best-effort wrapper (from PiFire): a Redis outage degrades to safe defaults instead of raising.

	The control loop must keep the auger/fan/igniter logic running even if redis-server restarts, so every
	command returns the value an empty store would have returned; one warning per minute is logged.
	"""

	DEFAULTS = {
		'append': 0, 'config_set': False, 'delete': 0, 'exists': False, 'get': None, 'keys': [], 'lindex': None,
		'llen': 0, 'lpop': None, 'lpush': 0, 'lrange': [], 'lrem': 0, 'rpop': None, 'rpush': 0, 'sadd': 0, 'set': False,
		'smembers': set(), 'srem': 0, 'xadd': None, 'xrange': [], 'xrevrange': [], 'xlen': 0, 'xtrim': 0, 'xread': [],
	}

	def __init__(self, client: redis.Redis):
		self._redis_client = client
		self._logger = logging.getLogger('common.redis')
		self._last_warning = 0.0

	def _log_warning(self, operation: str, error: Exception) -> None:
		now = time.time()
		if now - self._last_warning >= 60:
			self._logger.warning('%s Operation=%s Error=%s', REDIS_UNAVAILABLE_WARNING, operation, error)
			self._last_warning = now

	def __getattr__(self, name: str):
		attribute = getattr(self._redis_client, name)
		if not callable(attribute):
			return attribute

		def wrapped(*args, **kwargs):
			try:
				return attribute(*args, **kwargs)
			except redis.exceptions.RedisError as error:
				self._log_warning(name, error)
				return self.DEFAULTS.get(name, None)

		return wrapped


def _make_client() -> redis.Redis:
	if use_fake_redis():
		global _fake_server
		import fakeredis

		if _fake_server is None:
			_fake_server = fakeredis.FakeServer()
		return fakeredis.FakeStrictRedis(server=_fake_server, decode_responses=True)
	client = redis.StrictRedis.from_url(redis_url(), decode_responses=True, socket_connect_timeout=1, socket_timeout=1,
										health_check_interval=30)
	return ResilientRedisClient(client)  # type: ignore[return-value]


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
