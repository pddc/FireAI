"""FastAPI local API: auth gate, state, commands, settings redaction, websocket."""
import pytest
from fastapi.testclient import TestClient

from common import common


@pytest.fixture
def client(control, monkeypatch):
	monkeypatch.delenv('FIREAI_AUTH_DISABLED', raising=False)
	from server.app import create_app

	common.read_current(zero_out=True)
	common.read_status(init=True)
	with TestClient(create_app()) as c:
		yield c


@pytest.fixture
def authed(client):
	r = client.post('/api/v1/auth/setup', json={'password': 'correct horse'})
	assert r.status_code == 200
	token = r.json()['token']
	client.headers['Authorization'] = f'Bearer {token}'
	return client


class TestAuthGate:
	def test_health_is_open(self, client):
		r = client.get('/health')
		assert r.status_code == 200 and r.json()['ok'] is True

	def test_everything_requires_setup_first(self, client):
		assert client.get('/api/v1/auth/status').json()['setup_required'] is True
		r = client.get('/api/v1/state')
		assert r.status_code == 403 and r.json()['detail']['code'] == 'setup_required'
		r = client.post('/api/v1/auth/login', json={'password': 'x'})
		assert r.status_code == 403

	def test_setup_then_login(self, client):
		r = client.post('/api/v1/auth/setup', json={'password': 'correct horse'})
		assert r.status_code == 200 and r.json()['role'] == 'admin'
		assert client.post('/api/v1/auth/setup', json={'password': 'again again'}).status_code == 409
		assert client.post('/api/v1/auth/login', json={'password': 'wrong wrong'}).status_code == 401
		r = client.post('/api/v1/auth/login', json={'password': 'correct horse'})
		assert r.status_code == 200
		token = r.json()['token']
		r = client.get('/api/v1/auth/me', headers={'Authorization': f'Bearer {token}'})
		assert r.status_code == 200 and r.json()['role'] == 'admin'

	def test_short_password_rejected(self, client):
		assert client.post('/api/v1/auth/setup', json={'password': 'short'}).status_code == 422

	def test_no_token_is_401(self, client):
		client.post('/api/v1/auth/setup', json={'password': 'correct horse'})
		assert client.get('/api/v1/state').status_code == 401
		assert client.get('/api/v1/state', headers={'Authorization': 'Bearer nope'}).status_code == 401

	def test_change_password(self, authed):
		assert authed.post('/api/v1/auth/password', json={'password': 'new password 1'}).status_code == 200
		assert authed.post('/api/v1/auth/login', json={'password': 'correct horse'}).status_code == 401
		assert authed.post('/api/v1/auth/login', json={'password': 'new password 1'}).status_code == 200

	def test_auth_disabled_env(self, client, monkeypatch):
		monkeypatch.setenv('FIREAI_AUTH_DISABLED', '1')
		assert client.get('/api/v1/state').status_code == 200


class TestState:
	def test_snapshot_shape(self, authed):
		snap = authed.get('/api/v1/state').json()
		for key in ['mode', 'units', 'temps', 'setpoint', 'outputs', 'timer', 'notify', 'probes', 'hopper', 'ts']:
			assert key in snap, key
		assert snap['mode'] == 'Stop'
		assert 'Grill' in snap['temps']['primary']
		assert any(p['type'] == 'Primary' for p in snap['probes'])

	def test_settings_are_redacted(self, authed):
		s = common.read_settings()
		s['notify_services']['pushover']['API_key'] = 'sekrit'
		common.write_settings(s)
		out = authed.get('/api/v1/settings').json()
		assert out['notify_services']['pushover']['API_key'] == '***'
		assert 'auth' not in out.get('server', {})  # the whole local auth block stays on the Pi

	def test_patch_settings_keeps_secret_when_sentinel(self, authed):
		s = common.read_settings()
		s['notify_services']['pushover']['API_key'] = 'sekrit'
		common.write_settings(s)
		r = authed.patch('/api/v1/settings', json={'patch': {'notify_services': {'pushover': {'API_key': '***', 'enabled': True}},
														 'globals': {'grill_name': 'Backyard'}}})
		assert r.status_code == 200
		assert set(r.json()['changed']) == {'notify_services.pushover.enabled', 'globals.grill_name'}
		s = common.read_settings()
		assert s['notify_services']['pushover']['API_key'] == 'sekrit'
		assert s['globals']['grill_name'] == 'Backyard'

	def test_patch_protected_is_400(self, authed):
		r = authed.patch('/api/v1/settings', json={'patch': {'versions': {'server': '0'}}})
		assert r.status_code == 400

	def test_history_events_pellets(self, authed):
		assert authed.get('/api/v1/history?limit=10').json()['count'] == 0
		assert 'events' in authed.get('/api/v1/events').json()
		assert 'current' in authed.get('/api/v1/pellets').json()
		assert 'devices' in authed.get('/api/v1/probes/devices').json()


class TestCommands:
	def test_catalogue(self, authed):
		cat = authed.get('/api/v1/commands').json()
		assert any(c['name'] == 'mode.hold' for c in cat)

	def test_execute_queues_control_change(self, authed, redis_client):
		r = authed.post('/api/v1/commands/mode.hold', json={'args': {'setpoint': 250}})
		assert r.status_code == 200 and r.json()['result'] == 'OK'
		assert redis_client.llen('control:write') == 1
		common.execute_control_writes()
		c = common.read_control()
		assert c['mode'] == 'Hold' and c['primary_setpoint'] == 250

	def test_execute_without_body(self, authed):
		assert authed.post('/api/v1/commands/mode.smoke').status_code == 200

	def test_bad_args_400(self, authed):
		r = authed.post('/api/v1/commands/mode.hold', json={'args': {'setpoint': 'hot'}})
		assert r.status_code == 400 and 'errors' in r.json()['detail']['data']

	def test_unknown_404(self, authed):
		assert authed.post('/api/v1/commands/nope').status_code == 404

	def test_state_error_400(self, authed):
		r = authed.post('/api/v1/commands/timer.pause')
		assert r.status_code == 400 and r.json()['detail']['code'] == 'state'


class TestWebSocket:
	def test_ws_requires_token(self, authed):
		from starlette.websockets import WebSocketDisconnect

		with pytest.raises(WebSocketDisconnect):
			with authed.websocket_connect('/ws/state'):
				pass

	def test_ws_sends_snapshot_then_pong(self, authed):
		token = authed.headers['Authorization'].split()[1]
		with authed.websocket_connect(f'/ws/state?token={token}') as ws:
			first = ws.receive_json()
			assert first['type'] == 'state' and first['data']['mode'] == 'Stop'
			ws.send_text('ping')
			assert ws.receive_json()['type'] == 'pong'


class TestCloud:
	def test_status_unpaired(self, authed, monkeypatch, tmp_path):
		from server import cloud

		monkeypatch.setattr(cloud, 'DEFAULT_PATH', tmp_path / 'creds.json')
		r = authed.get('/api/v1/cloud/status')
		assert r.status_code == 200
		body = r.json()
		assert body['paired'] is False and body['control_enabled'] is False and body['pairing'] is None

	def test_pair_start_and_cancel(self, authed, monkeypatch, tmp_path):
		from server import cloud

		monkeypatch.setattr(cloud, 'DEFAULT_PATH', tmp_path / 'creds.json')

		class FakePairing:
			def __init__(self, *a, **k):
				self.state = None

			def start(self):
				from bridge.pairing import PairingState

				self.state = PairingState('123456', 's' * 40, 0, 10**12)
				return self.state

			def poll(self):
				return self.state

		monkeypatch.setattr(cloud, 'Pairing', FakePairing)
		r = authed.post('/api/v1/cloud/pair')
		assert r.status_code == 202 and r.json()['code'] == '123456'
		assert authed.get('/api/v1/cloud/status').json()['pairing']['status'] == 'pending'
		assert authed.delete('/api/v1/cloud/pair').status_code == 200
		assert authed.get('/api/v1/cloud/status').json()['pairing'] is None

	def test_unpair_removes_credentials(self, authed, monkeypatch, tmp_path):
		from bridge.credentials import Credentials
		from server import cloud

		path = tmp_path / 'creds.json'
		Credentials('g1', 'p', 'k', 'https://db', 'rt').save(path)
		monkeypatch.setattr(cloud, 'DEFAULT_PATH', path)
		assert authed.get('/api/v1/cloud/status').json()['paired'] is True
		assert authed.post('/api/v1/cloud/pair').status_code == 409
		assert authed.post('/api/v1/cloud/unpair').status_code == 200
		assert not path.exists()


def test_query_token_is_accepted_for_asset_style_requests(authed):
	token = authed.headers.pop('Authorization').split()[1]
	assert authed.get('/api/v1/state').status_code == 401
	assert authed.get(f'/api/v1/state?token={token}').status_code == 200
