"""ThermoMaven cloud probe module: signing, parsing and port mapping (no network)."""
import hashlib
import json

import pytest

from probes import cloud_thermomaven as tm


@pytest.fixture(autouse=True)
def _no_threads(monkeypatch):
	monkeypatch.setattr(tm, 'AUTOSTART', False)


class TestClient:
	def test_sign_matches_reference_algorithm(self):
		params = {'x-token': 'none', 'x-appId': 'id', 'x-nonce': 'n', 'x-timestamp': '1'}
		body = '{"a":1}'
		expected = hashlib.md5(('key|x-appId=id;x-nonce=n;x-timestamp=1;x-token=none|' + body).encode()).hexdigest()
		assert tm.ThermoMavenClient.sign('key', params, body) == expected

	def test_sign_without_body_has_no_trailing_separator(self):
		assert tm.ThermoMavenClient.sign('k', {'x': '1'}) == hashlib.md5(b'k|x=1').hexdigest()

	def test_headers_are_signed_and_sorted(self):
		c = tm.ThermoMavenClient('e', 'p', region='us', app_key='k', app_id='app')
		h = c.build_headers({'b': 2, 'a': 1}, nonce='abc', timestamp_ms=123)
		assert h['x-region'] == 'US' and h['x-token'] == 'none' and h['x-nonce'] == 'abc'
		params = {k: v for k, v in h.items() if k.startswith('x-') and k != 'x-sign'}
		assert h['x-sign'] == tm.ThermoMavenClient.sign('k', params, '{"b":2,"a":1}')
		assert h['User-Agent'] == 'okhttp/4.12.0'

	def test_body_encoding_is_compact(self):
		assert tm.ThermoMavenClient.encode_body({'a': 1, 'b': [1, 2]}) == '{"a":1,"b":[1,2]}'
		assert tm.ThermoMavenClient.encode_body({}) == ''

	@pytest.mark.parametrize('region,url', [
		('US', tm.API_BASE_URL_COM), ('CA', tm.API_BASE_URL_COM), ('DE', tm.API_BASE_URL_DE), ('UK', tm.API_BASE_URL_DE),
	])
	def test_region_selects_base_url(self, region, url):
		assert tm.ThermoMavenClient('e', 'p', region=region).base_url == url

	def test_login_sets_token_and_hashes_password(self):
		calls = []

		class FakeResp:
			def raise_for_status(self):
				pass

			def json(self):
				return {'code': '0', 'data': {'token': 'T', 'userId': 42}}

		class FakeSession:
			def post(self, url, data=None, headers=None, timeout=None):
				calls.append((url, json.loads(data), headers))
				return FakeResp()

		c = tm.ThermoMavenClient('me@x.com', 'secret', session=FakeSession())
		c.login()
		url, body, headers = calls[0]
		assert url.endswith('/app/account/login')
		assert body['accountPassword'] == hashlib.md5(b'secret').hexdigest()
		assert c.token == 'T' and c.user_id == 42
		assert headers['x-token'] == 'none'

	def test_api_error_code_raises(self):
		class FakeResp:
			def raise_for_status(self):
				pass

			def json(self):
				return {'code': '1001', 'msg': 'bad password'}

		class FakeSession:
			def post(self, *a, **k):
				return FakeResp()

		with pytest.raises(RuntimeError, match='bad password'):
			tm.ThermoMavenClient('e', 'p', session=FakeSession()).login()


def device(**cfg):
	config = {'email': 'e', 'password': 'p', 'region': 'US', 'num_probes': 1}
	config.update(cfg)
	return tm.ThermoMavenDevice({'P1_MEAT': 'Brisket', 'P1_AMBIENT': 'Grill'}, 'P1_AMBIENT', 'F', config, autostart=False)


def report(meat=1650, ambient=2250, areas=None, battery=80, status='online', device_id=None):
	probe = {'curTemperature': meat, 'curAmbientTemperature': ambient, 'batteryValue': battery}
	if areas is not None:
		probe['areaTemperature'] = areas
	msg = {'cmdType': 'WT10:status:report',
		   'cmdData': {'globalStatus': status, 'batteryValue': 90, 'rssi': -60, 'probes': [probe]}}
	if device_id:
		msg['deviceId'] = device_id
	return json.dumps(msg)


class TestDeviceParsing:
	def test_status_report_updates_readings_in_tenths_f(self, clock):
		d = device()
		d.handle_message('device/WT10/123/pub', report())
		v = d.get_port_values_f()
		assert v['P1_MEAT'] == 165.0 and v['P1_AMBIENT'] == 225.0
		assert d.get_status()['battery_percentage'] == 80
		assert d.rssi == -60

	def test_area_temperatures(self, clock):
		d = device()
		d.handle_message('device/WT10/123/pub', report(areas=[1000, 1100, 1200]))
		v = d.get_port_values_f()
		assert v['P1_AREA1'] == 100.0 and v['P1_AREA3'] == 120.0 and v['P1_AREA4'] is None

	def test_offline_report_yields_none(self, clock):
		d = device()
		d.handle_message('device/WT10/123/pub', report(status='offline'))
		assert d.get_port_values_f()['P1_MEAT'] is None

	def test_stale_readings_become_none(self, clock):
		d = device()
		d.handle_message('device/WT10/123/pub', report())
		clock.advance(tm.STALE_AFTER_S + 1)
		assert d.get_port_values_f()['P1_MEAT'] is None

	def test_device_id_filter(self, clock):
		d = device(device_id='999')
		d.handle_message('device/WT10/123/pub', report(device_id='123'))
		assert d.get_port_values_f()['P1_MEAT'] is None
		d.handle_message('device/WT10/999/pub', report(device_id='999', meat=2000))
		assert d.get_port_values_f()['P1_MEAT'] == 200.0

	def test_device_id_from_topic(self):
		assert tm.ThermoMavenDevice.device_id_from_topic('device/WT10/216510650012434433/pub') == '216510650012434433'
		assert tm.ThermoMavenDevice.device_id_from_topic('app/user/42/sub') is None

	def test_device_list_records_model(self, clock):
		d = device()
		d.handle_message('app/user/1/sub', json.dumps({'cmdType': 'user:device:list', 'cmdData': {'devices': [
			{'deviceId': '123', 'deviceModel': 'WT10', 'subTopics': ['app/WT10/123/sub']}]}}))
		assert d.device_model == 'WT10'

	def test_bad_payload_raises_for_caller_to_log(self, clock):
		d = device()
		with pytest.raises(json.JSONDecodeError):
			d.handle_message('x', 'not json')

	def test_unconfigured_credentials_do_not_start_thread(self):
		d = tm.ThermoMavenDevice({}, None, 'F', {'email': '', 'password': ''}, autostart=True)
		assert not d.thread.is_alive()
		assert 'credentials' in d.get_status()['error']


class TestReadProbes:
	DEVICE_INFO = {'device': 'tmav', 'module': 'cloud_thermomaven', 'ports': ['P1_MEAT', 'P1_AMBIENT'],
				   'config': {'email': 'e', 'password': 'p', 'region': 'US', 'num_probes': 1, 'transient': 'True'}}
	PROBE_INFO = [
		{'type': 'Primary', 'label': 'Grill', 'device': 'tmav', 'port': 'P1_AMBIENT', 'profile': {}, 'enabled': True},
		{'type': 'Food', 'label': 'Brisket', 'device': 'tmav', 'port': 'P1_MEAT', 'profile': {}, 'enabled': True},
	]

	def make(self, units='F'):
		return tm.ReadProbes(self.PROBE_INFO, json.loads(json.dumps(self.DEVICE_INFO)), units)

	def test_ports_map_to_primary_and_food(self, clock):
		rp = self.make()
		assert not rp.device.thread.is_alive()
		for _ in range(12):
			rp.device.handle_message('device/WT10/1/pub', report(meat=1650, ambient=2250))
			out = rp.read_all_ports({})
		assert out['primary']['Grill'] == 225
		assert out['food']['Brisket'] == 165

	def test_celsius_conversion(self, clock):
		rp = self.make(units='C')
		for _ in range(12):
			rp.device.handle_message('device/WT10/1/pub', report(meat=2120, ambient=2120))
			out = rp.read_all_ports({})
		assert out['primary']['Grill'] == pytest.approx(100.0, abs=0.2)

	def test_missing_reading_reports_none(self, clock):
		rp = self.make()
		out = rp.read_all_ports({})
		assert out['primary']['Grill'] is None and out['food']['Brisket'] is None

	def test_update_units_keeps_device(self, clock):
		rp = self.make()
		dev = rp.device
		rp.update_units('C')
		assert rp.device is dev and rp.units == 'C'

	def test_device_info_status(self, clock):
		rp = self.make()
		info = rp.get_device_info()
		assert info['status']['connected'] is False


class TestDeviceListSeeding:
	def test_last_status_in_device_list_marks_offline(self, clock):
		d = device()
		d.connected = True
		d.handle_message('app/user/1/sub', json.dumps({'cmdType': 'user:device:list', 'cmdData': {'devices': [{
			'deviceId': '123', 'deviceModel': 'WT10', 'subTopics': ['device/WT10/123/pub'],
			'lastStatusCmd': {'cmdType': 'WT10:status:report', 'cmdData': {'globalStatus': 'offline'}, 'serverTime': int(clock.time() * 1000)},
		}]}}))
		st = d.get_status()
		assert st['device_online'] is False and st['connected'] is False and st['cloud_connected'] is True
		assert 'offline' in st['error']

	def test_last_status_online_seeds_readings(self, clock):
		d = device()
		d.handle_message('app/user/1/sub', json.dumps({'cmdType': 'user:device:list', 'cmdData': {'devices': [{
			'deviceId': '123', 'deviceModel': 'WT10',
			'lastStatusCmd': {'cmdType': 'WT10:status:report', 'cmdData': {'globalStatus': 'online', 'probes': [{'curTemperature': 1800, 'curAmbientTemperature': 2300}]}, 'serverTime': int(clock.time() * 1000)},
		}]}}))
		assert d.get_port_values_f()['P1_MEAT'] == 180.0 and d.get_status()['device_online'] is True
