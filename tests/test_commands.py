"""process_command(): the single entry point every UI/API uses to drive the controller."""
import pytest

from common import common


def cmd(action, *args, **kw):
	return common.process_command(action=action, arglist=list(args), origin='test', **kw)


@pytest.mark.usefixtures('control')
class TestGet:
	def test_get_mode(self):
		out = cmd('get', 'mode')
		assert out['result'] == 'OK'
		assert out['data']['mode'] == 'Stop'

	def test_get_current_zeroed(self):
		common.read_current(zero_out=True)
		out = cmd('get', 'current')
		assert 'P' in out['data'] and 'F' in out['data']

	def test_get_temp_unknown_probe(self):
		common.read_current(zero_out=True)
		out = cmd('get', 'temp', 'NoSuchProbe')
		assert out['result'] == 'ERROR'

	def test_get_versions(self):
		out = cmd('get', 'versions')
		assert 'version' in out['data'] and 'build' in out['data']


@pytest.mark.usefixtures('control')
class TestSetMode:
	@pytest.mark.parametrize('mode,expected', [
		('startup', 'Startup'), ('smoke', 'Smoke'), ('shutdown', 'Shutdown'), ('stop', 'Stop'),
		('monitor', 'Monitor'), ('manual', 'Manual'), ('reignite', 'Reignite'),
	])
	def test_simple_modes(self, mode, expected):
		out = cmd('set', 'mode', mode, direct_write=True)
		assert out['result'] == 'OK'
		assert common.read_control()['mode'] == expected

	def test_hold_sets_setpoint(self):
		out = cmd('set', 'mode', 'hold', '225', direct_write=True)
		assert out['result'] == 'OK'
		c = common.read_control()
		assert c['mode'] == 'Hold' and c['primary_setpoint'] == 225

	def test_hold_rejects_non_number(self):
		out = cmd('set', 'mode', 'hold', 'hot')
		assert out['result'] == 'ERROR'

	def test_hold_requires_temp(self):
		assert cmd('set', 'mode', 'hold')['result'] == 'ERROR'

	def test_prime_with_next_mode(self):
		out = cmd('set', 'mode', 'prime', '20', 'startup', direct_write=True)
		assert out['result'] == 'OK'
		c = common.read_control()
		assert c['mode'] == 'Prime' and c['prime_amount'] == 20 and c['next_mode'] == 'Startup'

	def test_prime_rejects_bad_amount(self):
		assert cmd('set', 'mode', 'prime', 'lots')['result'] == 'ERROR'

	def test_unknown_mode(self):
		assert cmd('set', 'mode', 'warp')['result'] == 'ERROR'

	def test_queued_by_default(self, redis_client):
		cmd('set', 'mode', 'smoke')
		assert redis_client.llen('control:write') == 1
		assert common.read_control()['mode'] == 'Stop'


@pytest.mark.usefixtures('control')
class TestSetValues:
	def test_psp(self):
		cmd('set', 'psp', '250', direct_write=True)
		c = common.read_control()
		assert c['mode'] == 'Hold' and c['primary_setpoint'] == 250

	def test_psp_float_in_celsius(self):
		cmd('set', 'units', 'C', direct_write=True)
		cmd('set', 'psp', '107.5', direct_write=True)
		assert common.read_control()['primary_setpoint'] == 107.5

	@pytest.mark.parametrize('value,ok', [('0', True), ('9', True), ('10', False), ('x', False)])
	def test_pmode_range(self, value, ok):
		out = cmd('set', 'pmode', value)
		assert (out['result'] == 'OK') is ok
		if ok:
			assert common.read_settings()['cycle_data']['PMode'] == int(value)

	def test_splus(self):
		cmd('set', 'splus', 'true', direct_write=True)
		assert common.read_control()['s_plus'] is True
		cmd('set', 'splus', 'false', direct_write=True)
		assert common.read_control()['s_plus'] is False

	def test_units_switch_converts_settings(self):
		before = common.read_settings()['safety']['maxtemp']
		cmd('set', 'units', 'C', direct_write=True)
		s = common.read_settings()
		assert s['globals']['units'] == 'C'
		assert s['safety']['maxtemp'] < before

	def test_units_rejects_unknown(self):
		assert cmd('set', 'units', 'K')['result'] == 'ERROR'


def test_unknown_action_is_error(control):
	out = cmd('fly')
	assert out['result'] == 'ERROR'
