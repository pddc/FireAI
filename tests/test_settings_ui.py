"""Settings UI schema: every field points at a real setting and dynamic groups resolve."""
import pytest

from common import common
from core import settings_ui
from core.settings_schema import get_path


@pytest.fixture
def schema(settings):
	return settings_ui.build_schema(settings, local=True)


def test_every_static_field_exists_in_default_settings(schema, settings):
	missing = [p for p in settings_ui.all_paths(schema) if get_path(settings, p, default='__missing__') == '__missing__']
	assert missing == [], missing


def test_sections_and_dynamic_groups(schema, settings):
	ids = [s['id'] for s in schema['sections']]
	assert ids[:3] == ['general', 'control', 'safety']
	control = next(s for s in schema['sections'] if s['id'] == 'control')
	titles = [g['title'] for g in control['groups']]
	assert any('PID' in t or 'Controller' in t or 'settings' in t for t in titles)
	sel = next(f for g in control['groups'] for f in g['fields'] if f['path'] == 'controller.selected')
	assert {o['value'] for o in sel['options']} >= {'pid', 'pid_ac', 'pid_sp'}
	# DC fan group hidden when the platform has no DC fan
	assert 'DC fan (PWM)' not in titles


def test_dc_fan_group_appears_when_enabled(settings):
	settings['platform']['dc_fan'] = True
	schema = settings_ui.build_schema(settings)
	control = next(s for s in schema['sections'] if s['id'] == 'control')
	assert 'DC fan (PWM)' in [g['title'] for g in control['groups']]


def test_cloud_build_omits_local_only_sections(settings):
	schema = settings_ui.build_schema(settings, local=False)
	ids = {s['id'] for s in schema['sections']}
	assert 'cloud' not in ids and 'system' not in ids and 'control' in ids


def test_display_group_uses_module_metadata(settings):
	settings['modules']['display'] = 'ili9341e'
	settings['display']['config'].setdefault('ili9341e', {})
	schema = settings_ui.build_schema(settings)
	system = next(s for s in schema['sections'] if s['id'] == 'system')
	disp = [g for g in system['groups'] if g['title'].startswith('Display:')]
	assert disp and any(f['path'].startswith('display.config.ili9341e.') for f in disp[0]['fields'])


def test_visible_if_and_widgets_are_well_formed(schema):
	for s in schema['sections']:
		for g in s['groups']:
			for f in g['fields']:
				assert f['widget'] in {'toggle', 'number', 'temp', 'text', 'password', 'select', 'slider', 'list', 'color'}, f
				if f['widget'] in ('select',):
					assert f['options'], f['path']
				if f['visible_if']:
					for path in f['visible_if']:
						assert isinstance(path, str)


def test_coerce_patch_uses_current_types(settings, schema):
	patch = settings_ui.coerce_patch(schema, {'cycle_data': {'PMode': '4', 'u_min': '0.2', 'LidOpenDetectEnabled': 'true'}, 'globals': {'grill_name': 'x'}}, settings)
	assert patch == {'cycle_data': {'PMode': 4, 'u_min': 0.2, 'LidOpenDetectEnabled': True}, 'globals': {'grill_name': 'x'}}


def test_schema_endpoint(settings):
	from fastapi.testclient import TestClient

	from server.app import create_app

	common.read_control(flush=True)
	with TestClient(create_app()) as c:
		c.post('/api/v1/auth/setup', json={'password': 'correct horse'})
		tok = c.post('/api/v1/auth/login', json={'password': 'correct horse'}).json()['token']
		r = c.get('/api/v1/settings/schema', headers={'Authorization': f'Bearer {tok}'})
		assert r.status_code == 200 and r.json()['units'] == 'F' and len(r.json()['sections']) >= 6
