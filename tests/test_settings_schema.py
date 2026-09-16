"""Redaction and patch helpers."""
import pytest

from common import common
from core import settings_schema as ss


def test_secret_key_detection():
	for k in ['password', 'api_key', 'apikey', 'token', 'app_key', 'user_key', 'jwt_secret', 'p12Password', 'passwd']:
		assert ss.is_secret_key(k), k
	for k in ['url', 'enabled', 'password_set', 'token_ttl', 'grill_name', 'auth_required']:
		assert not ss.is_secret_key(k), k


def test_redact_replaces_values_but_keeps_structure():
	doc = {'a': {'password': 'hunter2', 'token': '', 'url': 'x'}, 'list': [{'api_key': 'k'}], 'n': 1}
	out = ss.redact(doc)
	assert out == {'a': {'password': '***', 'token': '', 'url': 'x'}, 'list': [{'api_key': '***'}], 'n': 1}
	assert doc['a']['password'] == 'hunter2'  # input untouched


def test_strip_sentinels():
	assert ss.strip_sentinels({'a': {'password': '***', 'x': 1}, 'b': '***', 'c': 2}) == {'a': {'x': 1}, 'c': 2}


def test_apply_patch_changes_and_reports_paths(settings):
	changed = ss.apply_patch({'globals': {'grill_name': 'Pit', 'units': 'F'}, 'cycle_data': {'PMode': 4}})
	assert set(changed) == {'globals.grill_name', 'cycle_data.PMode'}
	s = common.read_settings()
	assert s['globals']['grill_name'] == 'Pit' and s['cycle_data']['PMode'] == 4


def test_apply_patch_ignores_sentinel_secrets(settings):
	settings['notify_services']['pushover']['API_key'] = 'realkey'
	common.write_settings(settings)
	changed = ss.apply_patch({'notify_services': {'pushover': {'API_key': '***', 'enabled': True}}})
	assert changed == ['notify_services.pushover.enabled']
	assert common.read_settings()['notify_services']['pushover']['API_key'] == 'realkey'


def test_apply_patch_protects_versions(settings):
	with pytest.raises(ValueError):
		ss.apply_patch({'versions': {'server': '0'}})
	with pytest.raises(ValueError):
		ss.apply_patch({'server': {'auth': {'password_hash': 'x'}}})


def test_get_path():
	assert ss.get_path({'a': {'b': 1}}, 'a.b') == 1
	assert ss.get_path({'a': {'b': 1}}, 'a.c', 'dflt') == 'dflt'
