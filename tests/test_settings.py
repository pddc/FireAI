"""Settings file lifecycle: defaults, persistence, unit conversion, upgrade path."""
import json

import pytest

from common import common


def test_default_settings_has_required_sections(workdir):
	s = common.default_settings()
	for key in ['versions', 'globals', 'platform', 'probe_settings', 'cycle_data', 'safety', 'modules',
				'notify_services', 'pelletlevel', 'startup', 'shutdown', 'smoke_plus']:
		assert key in s, key
	assert s['modules']['grillplat'] == 'prototype'
	assert s['globals']['units'] == 'F'
	assert s['globals']['first_time_setup'] is True


def test_read_settings_creates_file_when_missing(workdir):
	assert not (workdir / 'settings.json').exists()
	s = common.read_settings()
	assert (workdir / 'settings.json').exists()
	on_disk = json.loads((workdir / 'settings.json').read_text())
	assert on_disk['versions'] == s['versions']


def test_write_then_read_roundtrip(settings):
	settings['globals']['grill_name'] = 'Backyard'
	common.write_settings(settings)
	assert common.read_settings()['globals']['grill_name'] == 'Backyard'


def test_corrupt_settings_file_is_recovered(workdir):
	(workdir / 'settings.json').write_text('{not json')
	s = common.read_settings()
	assert 'globals' in s


@pytest.mark.parametrize('units', ['C', 'F'])
def test_convert_settings_units_is_idempotent(settings, units):
	once = common.convert_settings_units(units, json.loads(json.dumps(settings)))
	twice = common.convert_settings_units(units, json.loads(json.dumps(once)))
	assert once['globals']['units'] == units
	assert once['safety']['maxtemp'] == twice['safety']['maxtemp']


def test_convert_temp_f_to_c_and_back():
	assert common.convert_temp('C', 212) == 100
	assert common.convert_temp('F', 100) == 212


def test_upgrade_from_older_version_keeps_user_values(workdir):
	"""Simulate a settings file written by an older release."""
	old = common.default_settings()
	old['versions']['server'] = '1.8.0'
	old['globals']['grill_name'] = 'Keep me'
	(workdir / 'settings.json').write_text(json.dumps(old))
	s = common.read_settings(init=True)
	assert s['globals']['grill_name'] == 'Keep me'
	assert s['versions']['server'] == common.default_settings()['versions']['server']


def test_semantic_version_compare():
	assert common.semantic_ver_is_lower('1.9.0', '1.10.0')
	assert not common.semantic_ver_is_lower('1.10.0', '1.9.0')
	assert not common.semantic_ver_is_lower('1.10.0', '1.10.0')


def test_release_notes_flag_only_on_real_upgrades(settings):
	"""Every control start runs the same-version 'minor upgrade' path; it must not re-arm the what's-new dialog."""
	assert common.read_settings(init=True)['globals']['updated_message'] is False
	assert common.read_settings(init=True)['globals']['updated_message'] is False
	s = common.read_settings()
	s['versions']['server'] = '1.10.10'
	common.write_settings(s)
	assert common.read_settings(init=True)['globals']['updated_message'] is True
	# dismissed by the app, and it stays dismissed on the next start
	s = common.read_settings()
	s['globals']['updated_message'] = False
	common.write_settings(s)
	assert common.read_settings(init=True)['globals']['updated_message'] is False
