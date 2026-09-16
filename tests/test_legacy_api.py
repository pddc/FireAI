"""PiFire-compatible /api (docs.pifire.io → Advanced) and API keys."""
import pytest
from fastapi.testclient import TestClient

from common import common
from server import auth


@pytest.fixture
def client(settings, control):
	from server.app import create_app

	with TestClient(create_app()) as c:
		tok = c.post('/api/v1/auth/setup', json={'password': 'correct horse'}).json()['token']
		c.headers.update({'Authorization': f'Bearer {tok}'})
		yield c


class TestGet:
	def test_current_status_mode_hopper(self, client):
		common.write_current({'probe_history': {'primary': {'Grill': 225.0}, 'food': {'Probe1': 140.0}, 'aux': {}}, 'primary_setpoint': 225, 'notify_targets': {}})
		r = client.get('/api/get/current')
		assert r.status_code == 201 and r.json()['result'] == 'OK' and r.json()['data']['P']['Grill'] == 225.0
		assert client.get('/api/get/temp/Probe1').json()['data']['temp'] == 140.0
		assert client.get('/api/get/temp/Nope').json()['result'] == 'ERROR'
		assert client.get('/api/get/mode').json()['data']['mode'] == 'Stop'
		st = client.get('/api/get/status').json()['data']
		assert {'mode', 'outpins', 'units', 'p_mode', 's_plus', 'start_duration'} <= set(st)
		assert client.get('/api/get/hopper').json()['data']['hopper'] == 100  # PiFire's key; waits ~3 s for a re-read
		assert 'shutdown' in client.get('/api/get/timer').json()['data']
		assert client.get('/api/get/notify').json()['result'] == 'OK'

	def test_low_level_reads(self, client):
		s = client.get('/api/settings')
		assert s.status_code == 201 and s.json()['settings']['globals']['units'] in ('F', 'C')
		assert 'auth' not in s.json()['settings'].get('server', {})  # local auth block never leaves the Pi
		assert client.get('/api/control').json()['control']['mode'] == 'Stop'
		cur = client.get('/api/current').json()
		assert set(cur) == {'current', 'notify_data', 'status'} and 'ui_hash' in cur['status']
		h = client.get('/api/hopper').json()
		assert h['hopper_level'] == 100 and h['hopper_pellets']
		assert client.get('/api/server').json()['server_status'] == 'available'
		assert client.get('/api/bogus').status_code == 404

	def test_v1_routes_are_not_shadowed(self, client):
		assert client.get('/api/v1/state').status_code == 200
		assert client.get('/api/v1/does-not-exist').status_code == 404


class TestSet:
	def test_mode_setpoint_pmode_splus_timer(self, client):
		assert client.get('/api/set/mode/startup').json()['result'] == 'OK'
		common.execute_control_writes()
		assert common.read_control()['mode'] == 'Startup'
		assert client.post('/api/set/mode/hold/250').json()['result'] == 'OK'
		common.execute_control_writes()
		c = common.read_control()
		assert c['mode'] == 'Hold' and c['primary_setpoint'] == 250
		assert client.get('/api/set/psp/240').json()['result'] == 'OK'
		assert client.get('/api/set/pmode/3').json()['result'] == 'OK'
		assert common.read_settings()['cycle_data']['PMode'] == 3
		assert client.get('/api/set/splus/true').json()['result'] == 'OK'
		assert client.get('/api/set/timer/start/90').json()['result'] == 'OK'
		common.execute_control_writes()
		assert common.read_control()['timer']['end'] > common.read_control()['timer']['start']
		assert client.get('/api/set/timer/stop').json()['result'] == 'OK'
		assert client.get('/api/set/mode/bogus').json()['result'] == 'ERROR'

	def test_notify_and_units(self, client):
		assert client.get('/api/set/notify/Probe1/target/165').json()['result'] == 'OK'
		common.execute_control_writes()  # each call queues a full control document, like PiFire's web app
		assert client.get('/api/set/notify/Probe1/req/true').json()['result'] == 'OK'
		common.execute_control_writes()
		nd = [n for n in common.read_control()['notify_data'] if n['label'] == 'Probe1' and n['type'] == 'probe'][0]
		assert nd['target'] == 165 and nd['req'] is True
		assert client.get('/api/set/units/C').json()['result'] == 'OK'
		assert common.read_settings()['globals']['units'] == 'C'

	def test_manual_requires_manual_mode(self, client):
		r = client.get('/api/set/manual/fan/true').json()
		assert r['result'] == 'ERROR'
		client.get('/api/set/mode/manual')
		common.execute_control_writes()
		assert client.get('/api/set/manual/fan/true').json()['result'] == 'OK'


class TestPost:
	def test_settings_patch_and_control(self, client):
		r = client.post('/api/settings', json={'globals': {'grill_name': 'Smokey the Bear'}})
		assert r.status_code == 201 and r.json()['result'] == 'success'
		assert common.read_settings()['globals']['grill_name'] == 'Smokey the Bear'
		# protected paths are refused in-band, PiFire style
		r = client.post('/api/settings', json={'server': {'auth': {'password_hash': 'x'}}})
		assert r.json()['result'] == 'error'
		assert client.post('/api/control', json={'updated': True, 'mode': 'Monitor'}).json()['result'] == 'success'
		common.execute_control_writes()
		assert common.read_control()['mode'] == 'Monitor'
		assert client.post('/api/settings', content=b'not json', headers={'Content-Type': 'application/json'}).status_code == 400


class TestApiKeys:
	def test_create_use_and_revoke(self, client):
		r = client.post('/api/v1/auth/api-keys', json={'name': 'Home Assistant', 'role': 'operator'})
		assert r.status_code == 201
		key, key_id = r.json()['key'], r.json()['id']
		assert key.startswith('fireai_') and 'hash' not in r.json()
		listed = client.get('/api/v1/auth/api-keys').json()['keys']
		assert listed[0]['name'] == 'Home Assistant' and 'hash' not in listed[0]
		# keys never leave the server in settings dumps
		assert key not in str(client.get('/api/settings').json()) and 'api_keys' not in str(client.get('/api/v1/settings').json())

		anon = TestClient(client.app)
		assert anon.get('/api/get/mode').status_code == 401
		assert anon.get('/api/get/mode', headers={'X-API-Key': key}).status_code == 201
		assert anon.get(f'/api/get/mode?api_key={key}').status_code == 201
		assert anon.get('/api/set/mode/monitor', headers={'Authorization': f'Bearer {key}'}).status_code == 201
		import base64

		basic = base64.b64encode(f'grill:{key}'.encode()).decode()
		assert anon.get('/api/get/mode', headers={'Authorization': f'Basic {basic}'}).status_code == 201
		# operator keys cannot run cmd or POST settings
		assert anon.get('/api/cmd/restart', headers={'X-API-Key': key}).status_code == 403
		assert anon.post('/api/settings', json={}, headers={'X-API-Key': key}).status_code == 403

		assert client.delete(f'/api/v1/auth/api-keys/{key_id}').status_code == 200
		assert anon.get('/api/get/mode', headers={'X-API-Key': key}).status_code == 401
		assert client.delete(f'/api/v1/auth/api-keys/{key_id}').status_code == 404

	def test_viewer_key_is_read_only(self, client):
		key = client.post('/api/v1/auth/api-keys', json={'name': 'dash', 'role': 'viewer'}).json()['key']
		anon = TestClient(client.app)
		assert anon.get('/api/get/current', headers={'X-API-Key': key}).status_code == 201
		assert anon.get('/api/set/mode/monitor', headers={'X-API-Key': key}).status_code == 403
		assert client.post('/api/v1/auth/api-keys', json={'name': 'x', 'role': 'root'}).status_code == 400

	def test_bad_key_rejected(self, settings):
		assert auth.verify_api_key('fireai_nope') is None
		assert auth.verify_api_key('') is None
