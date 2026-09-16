from core import redis_client


def test_fake_redis_is_shared_within_process():
	a = redis_client.get_redis()
	b = redis_client.get_redis()
	assert a is b
	a.set('k', 'v')
	assert b.get('k') == 'v'


def test_decode_responses():
	r = redis_client.get_redis()
	r.rpush('l', '1')
	assert r.lrange('l', 0, -1) == ['1']


def test_url_default(monkeypatch):
	monkeypatch.delenv('FIREAI_REDIS_URL', raising=False)
	assert redis_client.redis_url() == 'redis://localhost:6379/0'
	monkeypatch.setenv('FIREAI_REDIS_URL', 'redis://pi:6380/2')
	assert redis_client.redis_url() == 'redis://pi:6380/2'


def test_resilient_client_degrades_to_defaults(caplog):
	import logging

	import redis

	from core.redis_client import ResilientRedisClient

	class Down:
		def get(self, key):
			raise redis.exceptions.ConnectionError('refused')

		def llen(self, key):
			raise redis.exceptions.TimeoutError('slow')

		def ping(self):
			return True

	c = ResilientRedisClient(Down())
	with caplog.at_level(logging.WARNING, logger='common.redis'):
		assert c.get('x') is None
		assert c.llen('q') == 0
		assert c.ping() is True
	assert sum('Redis is unavailable' in r.message for r in caplog.records) == 1  # rate-limited to one per minute


def test_decode_json_or_default():
	from common.common import _decode_json_or_default

	assert _decode_json_or_default(None, {'a': 1}) == {'a': 1}
	assert _decode_json_or_default('not json', []) == []
	assert _decode_json_or_default('{"b": 2}', {}) == {'b': 2}
