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
