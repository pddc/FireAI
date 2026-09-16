"""Probe map validation, apply, profiles and the API around them."""
import copy

import pytest

from common import common
from core import probes_config as pc


@pytest.fixture
def pmap(settings):
	return copy.deepcopy(settings['probe_settings']['probe_map'])


def test_default_map_is_valid(pmap):
	assert pc.validate_probe_map(pmap) == []


def test_validation_catches_common_mistakes(pmap):
	pmap['probe_info'][0]['type'] = 'Food'  # no primary
	pmap['probe_info'][1]['label'] = 'Probe 1'  # space
	pmap['probe_info'][2]['port'] = 'ADC9'  # bad port
	pmap['probe_info'][3]['device'] = 'nope'
	errs = pc.validate_probe_map(pmap)
	assert any('exactly one Primary' in e for e in errs)
	assert any('letters and digits' in e for e in errs)
	assert any('ADC9' in e for e in errs)
	assert any("unknown device 'nope'" in e for e in errs)


def test_duplicate_ports_and_labels(pmap):
	pmap['probe_info'][2]['port'] = pmap['probe_info'][1]['port']
	pmap['probe_info'][2]['label'] = pmap['probe_info'][1]['label']
	errs = pc.validate_probe_map(pmap)
	assert any('more than one probe' in e for e in errs) and any('used more than once' in e for e in errs)


def test_virtual_device_references(pmap):
	pmap['probe_devices'].append(pc.default_device('virtual_average', 'Avg'))
	pmap['probe_devices'][-1]['config']['probes_list'] = ['Probe1', 'Ghost']
	errs = pc.validate_probe_map(pmap)
	assert any("missing probe 'Ghost'" in e for e in errs)


def test_default_device_from_manifest():
	d = pc.default_device('cloud_thermomaven', 'My G1')
	assert d['device'] == 'MyG1' and d['module_filename'] == 'cloud_thermomaven'
	assert pc.default_device('cloud_thermomaven')['device'] == 'ThermoMaven'
	assert 'P1_MEAT' in d['ports'] and d['config']['region'] == 'US' and d['config']['num_probes'] == 1


def test_apply_reports_restart_only_for_structural_changes(settings, pmap):
	# rename only -> no restart
	pmap['probe_info'][1]['name'] = 'Brisket'
	out = pc.apply_probe_map(pmap)
	assert out['restart_required'] is False
	assert common.read_settings()['probe_settings']['probe_map']['probe_info'][1]['name'] == 'Brisket'
	# add a device -> restart
	pmap['probe_devices'].append(pc.default_device('cloud_thermomaven', 'G1'))
	pmap['probe_info'].append({'type': 'Food', 'label': 'Meat', 'name': 'Meat', 'device': 'G1', 'port': 'P1_MEAT', 'enabled': True,
							   'profile': pmap['probe_info'][1]['profile']})
	out = pc.apply_probe_map(pmap)
	assert out['restart_required'] is True
	s = common.read_settings()
	assert 'Meat' in s['history_page']['probe_config']


def test_apply_rejects_invalid(settings, pmap):
	pmap['probe_info'] = []
	with pytest.raises(ValueError):
		pc.apply_probe_map(pmap)


def test_profiles_upsert_and_delete(settings):
	entry = pc.upsert_profile({'name': 'My probe', 'A': 1e-3, 'B': 2e-4, 'C': 3e-7})
	s = common.read_settings()
	assert s['probe_settings']['probe_profiles'][entry['id']]['name'] == 'My probe'
	# updating a profile in use refreshes the probe's copy
	in_use = s['probe_settings']['probe_map']['probe_info'][1]['profile']['id']
	pc.upsert_profile({'id': in_use, 'name': 'Renamed', 'A': 1, 'B': 2, 'C': 3})
	s = common.read_settings()
	assert s['probe_settings']['probe_map']['probe_info'][1]['profile']['name'] == 'Renamed'
	with pytest.raises(ValueError):
		pc.delete_profile(in_use)
	pc.delete_profile(entry['id'])
	assert entry['id'] not in common.read_settings()['probe_settings']['probe_profiles']


def test_api_roundtrip(settings, control):
	from fastapi.testclient import TestClient

	from server.app import create_app

	with TestClient(create_app()) as c:
		tok = c.post('/api/v1/auth/setup', json={'password': 'correct horse'}).json()['token']
		h = {'Authorization': f'Bearer {tok}'}
		cfg = c.get('/api/v1/probes/config', headers=h).json()
		assert 'cloud_thermomaven' in cfg['modules'] and cfg['probe_map']['probe_info']
		tmpl = c.post('/api/v1/probes/devices/template', json={'module': 'cloud_thermomaven', 'name': 'G1'}, headers=h).json()
		tmpl['config']['password'] = 'hunter2'
		pm = cfg['probe_map']
		pm['probe_devices'].append(tmpl)
		r = c.put('/api/v1/probes/config', json={'probe_map': pm}, headers=h)
		assert r.status_code == 200 and r.json()['restart_required'] is True
		# secret is redacted on read and preserved on write-back
		cfg2 = c.get('/api/v1/probes/config', headers=h).json()
		g1 = next(d for d in cfg2['probe_map']['probe_devices'] if d['device'] == 'G1')
		assert g1['config']['password'] == '***'
		r = c.put('/api/v1/probes/config', json={'probe_map': cfg2['probe_map']}, headers=h)
		assert r.status_code == 200
		stored = next(d for d in common.read_settings()['probe_settings']['probe_map']['probe_devices'] if d['device'] == 'G1')
		assert stored['config']['password'] == 'hunter2'
		bad = cfg2['probe_map']
		bad['probe_info'][0]['type'] = 'Food'
		assert c.put('/api/v1/probes/config', json={'probe_map': bad}, headers=h).status_code == 400
