"""Hardware selection (wizard replacement) and probe tuner."""
import pytest
from fastapi.testclient import TestClient

from common import common
from core import hardware, tuner


class TestHardware:
	def test_catalogue_lists_modules_and_current(self, settings):
		cat = hardware.catalogue()
		assert 'pcb_4.x.x' in cat['modules']['grillplatform']
		assert 'ili9341e' in cat['modules']['display'] and cat['modules']['display']['ili9341e']['config']
		assert 'vl53l0x' in cat['modules']['distance']
		assert cat['current']['display'] == 'none' and cat['current']['units'] == 'F'
		pcb = cat['modules']['grillplatform']['pcb_4.x.x']
		assert pcb['settings']['dc_fan']['path'] == 'platform.dc_fan' and pcb['settings']['dc_fan']['options']

	def test_apply_pcb4_display_distance(self, settings):
		out = hardware.apply({
			'grillplatform': {'id': 'pcb_4.x.x', 'settings': {'dc_fan': 'True', 'triggerlevel': 'HIGH', 'system_type': 'raspberry_pi_all', 'real_hw': 'True'}},
			'display': {'id': 'ili9341e', 'settings': {}, 'config': {'rotation': '2', 'spi_device': '0'}},
			'distance': {'id': 'vl53l0x'},
			'units': 'C',
			'board_probe_map': 'pcb_4.x.x',
		})
		assert out['restart_required'] and out['reboot_required'] is True
		s = common.read_settings()
		assert s['platform']['current'] == 'pcb_4.x.x' and s['platform']['dc_fan'] is True and s['platform']['triggerlevel'] == 'HIGH'
		assert s['modules']['display'] == 'ili9341e' and s['display']['selected'] == 'ili9341e'
		assert s['display']['config']['ili9341e']['rotation'] == 2
		assert s['modules']['dist'] == 'vl53l0x'
		assert s['modules']['grillplat'] == 'raspberry_pi_all'
		assert s['globals']['units'] == 'C' and s['globals']['first_time_setup'] is False
		assert s['probe_settings']['probe_map']['probe_devices'][0]['device'] == 'ADS1115'
		assert 'Grill' in s['history_page']['probe_config']

	def test_simulator_platform_is_preserved(self, sim_settings):
		hardware.apply({'display': {'id': 'none'}})
		assert common.read_settings()['modules']['grillplat'] == 'simulator'

	def test_invalid_selections(self, settings):
		with pytest.raises(ValueError):
			hardware.apply({'display': {'id': 'nope'}})
		with pytest.raises(ValueError):
			hardware.apply({'grillplatform': {'id': 'pcb_4.x.x', 'settings': {'dc_fan': 'Maybe'}}})
		with pytest.raises(ValueError):
			hardware.apply({'display': {'id': 'ili9341e', 'config': {'bogus': 1}}})

	@pytest.mark.parametrize('raw,expected', [('True', True), ('false', False), ('12', 12), ('1.5', 1.5), ('abc', 'abc'), ('[1, 2]', [1, 2]), (3, 3)])
	def test_convert_value(self, raw, expected):
		assert hardware.convert_value(raw) == expected


class TestTuner:
	def test_manual_fit_roundtrips(self):
		# Known thermistor-like points (F, ohms)
		a, b, c = tuner.shh_coefficients(32, 122, 212, 32650, 3600, 680, 'F')
		for t, r in ((32, 32650), (122, 3600), (212, 680)):
			assert tuner.tr_to_temp(r, a, b, c, 'F') == pytest.approx(t, abs=0.5)
		curve = tuner.fit_curve(a, b, c, 'F', temp_range=220)
		assert curve and curve[0]['temp'] == 0 and all(p['tr'] > 0 for p in curve)

	def test_manual_fit_rejects_duplicate_resistances(self):
		with pytest.raises(ValueError):
			tuner.shh_coefficients(32, 122, 212, 1000, 1000, 500)

	def test_autotune_flow(self, sim_settings, control, redis_client):
		tuner.start_autotune()
		common.execute_control_writes()
		c = common.read_control()
		assert c['tuning_mode'] and c['mode'] == 'Monitor'
		# feed samples: reference temp rising, probe Tr falling
		for i in range(15):
			common.write_current({'probe_history': {'primary': {'Grill': 100 + i * 10}, 'food': {'Probe1': 0}, 'aux': {}, 'tr': {}}, 'primary_setpoint': 0, 'notify_targets': {}})
			common.write_tr({'Probe1': 20000 - i * 1000, 'Grill': 0})
			out = tuner.record_sample('Probe1', 'Grill')
		assert out['current_tr'] == 6000 and out['current_temp'] == 240
		st = tuner.autotune_status('F')
		assert st['ready'] and st['low']['temp'] == 100 and st['high']['temp'] == 240 and st['medium']['temp'] == 170
		tuner.stop_autotune()
		common.execute_control_writes()
		assert common.read_control()['tuning_mode'] is False

	def test_autotune_not_ready_with_few_samples(self, sim_settings, control):
		common.read_autotune(flush=True)
		assert tuner.autotune_status('F')['ready'] is False


def test_endpoints(settings, control):
	from fastapi.testclient import TestClient

	from server.app import create_app

	with TestClient(create_app()) as c:
		tok = c.post('/api/v1/auth/setup', json={'password': 'correct horse'}).json()['token']
		h = {'Authorization': f'Bearer {tok}'}
		cat = c.get('/api/v1/hardware', headers=h).json()
		assert 'pcb_4.x.x' in cat['modules']['grillplatform']
		r = c.put('/api/v1/hardware', json={'display': {'id': 'ili9341e', 'config': {'rotation': 1}}}, headers=h)
		assert r.status_code == 200 and r.json()['restart_required']
		assert c.put('/api/v1/hardware', json={'display': {'id': 'nope'}}, headers=h).status_code == 400
		r = c.post('/api/v1/tuner/fit', json={'t1': 32, 't2': 122, 't3': 212, 'r1': 32650, 'r2': 3600, 'r3': 680}, headers=h)
		assert r.status_code == 200 and r.json()['curve']
		assert c.post('/api/v1/tuner/fit', json={'t1': 32, 't2': 122, 't3': 212, 'r1': 1000, 'r2': 1000, 'r3': 500}, headers=h).status_code == 400
		assert c.post('/api/v1/tuner/auto/start', headers=h).status_code == 200
		assert c.post('/api/v1/tuner/auto/sample', json={'probe': 'Probe1', 'reference': 'Grill'}, headers=h).status_code == 200
		assert c.get('/api/v1/tuner/tr', headers=h).json()['tuning_mode'] in (True, False)
		assert c.post('/api/v1/tuner/auto/stop', headers=h).status_code == 200


class TestBluetooth:
	def test_scan_through_control_queue(self, sim_settings, control, monkeypatch):
		import control as ctl
		from common.redis_queue import RedisQueue
		from core import bluetooth
		from grillplat.simulator import GrillPlatform

		# The control loop drains control:systemq; emulate it right after the API pushes the command.
		real_push = RedisQueue.push

		def push_and_serve(self_, item):
			real_push(self_, item)
			if self_.hashname == 'control:systemq':
				ctl._process_system_commands(GrillPlatform({}))

		monkeypatch.setattr(RedisQueue, 'push', push_and_serve)
		r = bluetooth.scan(timeout=5)
		assert r['error'] is None
		assert r['devices'][0] == {'name': 'iBBQ', 'address': 'aa:bb:cc:dd:ee:01', 'info': 'simulated'}

	def test_scan_times_out_without_control(self, settings, control):
		from core import bluetooth

		r = bluetooth.scan(timeout=0.2)
		assert r['devices'] == [] and 'could not be found' in r['error']

	def test_diagnostics_never_raise(self, settings):
		from core import bluetooth

		sections = bluetooth.diagnostics()
		assert sections[0]['title'] == 'Python' and 'bleak' in sections[0]['output']
		text = bluetooth.diagnostics_text(sections)
		assert 'FireAI Bluetooth diagnostics' in text and 'Python' in text

	def test_endpoints(self, settings, control):
		from server.app import create_app

		with TestClient(create_app()) as c:
			tok = c.post('/api/v1/auth/setup', json={'password': 'correct horse'}).json()['token']
			h = {'Authorization': f'Bearer {tok}'}
			r = c.get('/api/v1/bluetooth/diagnostics', headers=h)
			assert r.status_code == 200 and r.json()['sections'][0]['title'] == 'Python'
			r = c.get('/api/v1/bluetooth/diagnostics?format=text', headers=h)
			assert r.headers['content-type'].startswith('text/plain')


def test_wizard_dismiss_clears_first_time_setup(settings, control):
	from server.app import create_app

	s = common.read_settings()
	s['globals']['first_time_setup'] = True
	common.write_settings(s)
	with TestClient(create_app()) as c:
		tok = c.post('/api/v1/auth/setup', json={'password': 'correct horse'}).json()['token']
		h = {'Authorization': f'Bearer {tok}'}
		assert c.get('/api/v1/hardware', headers=h).json()['current']['first_time_setup'] is True
		assert c.post('/api/v1/hardware/wizard/dismiss', headers=h).status_code == 200
		assert c.get('/api/v1/hardware', headers=h).json()['current']['first_time_setup'] is False
