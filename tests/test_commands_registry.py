"""core.commands: typed registry over the control structure."""
import pytest

from common import common
from core import commands as reg


def run(name, **args):
	return reg.execute(name, args, origin='test', direct_write=True)


@pytest.mark.usefixtures('control')
class TestRegistry:
	def test_catalogue_has_schemas(self):
		cat = reg.describe()
		names = {c['name'] for c in cat}
		assert {'mode.startup', 'mode.hold', 'settings.patch', 'timer.start', 'notify.set'} <= names
		hold = next(c for c in cat if c['name'] == 'mode.hold')
		assert 'setpoint' in hold['args']['properties']
		assert next(c for c in cat if c['name'] == 'system.reboot')['cloud_allowed'] is False

	def test_unknown_command(self):
		assert run('mode.warp').result == 'ERROR'

	def test_invalid_args_are_rejected_with_details(self):
		out = run('mode.hold', setpoint='hot')
		assert out.result == 'ERROR' and out.data['errors']

	def test_extra_args_forbidden(self):
		assert run('mode.smoke', bogus=1).result == 'ERROR'

	@pytest.mark.parametrize('name,mode', [
		('mode.startup', 'Startup'), ('mode.smoke', 'Smoke'), ('mode.shutdown', 'Shutdown'), ('mode.stop', 'Stop'),
		('mode.monitor', 'Monitor'), ('mode.manual', 'Manual'), ('mode.reignite', 'Reignite'),
	])
	def test_mode_commands(self, name, mode):
		assert run(name).result == 'OK'
		c = common.read_control()
		assert c['mode'] == mode and c['updated'] is True

	def test_hold_int_in_f(self):
		out = run('mode.hold', setpoint=225.7)
		assert out.data['setpoint'] == 225
		assert common.read_control()['primary_setpoint'] == 225

	def test_hold_float_in_c(self):
		run('units', units='C')
		run('mode.hold', setpoint=107.5)
		assert common.read_control()['primary_setpoint'] == 107.5

	def test_prime(self):
		run('mode.prime', amount=20, next_mode='Startup')
		c = common.read_control()
		assert c['mode'] == 'Prime' and c['prime_amount'] == 20 and c['next_mode'] == 'Startup'

	def test_prime_bounds(self):
		assert run('mode.prime', amount=0).result == 'ERROR'
		assert run('mode.prime', amount=101).result == 'ERROR'

	def test_queued_by_default(self, redis_client):
		reg.execute('mode.smoke', {}, origin='test')
		assert redis_client.llen('control:write') == 1
		common.execute_control_writes()
		assert common.read_control()['mode'] == 'Smoke'

	def test_smoke_plus_and_pwm(self):
		run('smoke_plus', enabled=True)
		run('pwm_control', enabled=True)
		run('duty_cycle', duty_cycle=55)
		c = common.read_control()
		assert c['s_plus'] and c['pwm_control'] and c['duty_cycle'] == 55

	def test_pmode_writes_settings(self):
		run('pmode', pmode=7)
		assert common.read_settings()['cycle_data']['PMode'] == 7
		assert common.read_control()['settings_update'] is True

	def test_units_switch(self):
		run('units', units='C')
		assert common.read_settings()['globals']['units'] == 'C'
		c = common.read_control()
		assert c['units_change'] and c['updated']

	def test_lid_open_toggle(self):
		run('lid_open.toggle')
		assert common.read_control()['lid_open_toggle'] is True


@pytest.mark.usefixtures('control')
class TestTimer:
	def test_start_pause_resume_stop(self, clock):
		out = run('timer.start', seconds=600, shutdown=True)
		c = common.read_control()
		assert c['timer']['end'] == pytest.approx(clock.time() + 600)
		timer_entry = next(n for n in c['notify_data'] if n['type'] == 'timer')
		assert timer_entry['req'] and timer_entry['shutdown']
		clock.advance(100)
		run('timer.pause')
		c = common.read_control()
		assert c['timer']['paused'] == pytest.approx(clock.time())
		clock.advance(50)
		run('timer.resume')
		c = common.read_control()
		assert c['timer']['end'] == pytest.approx(clock.time() + 500)
		run('timer.stop')
		c = common.read_control()
		assert c['timer']['start'] == 0 and c['timer']['end'] == 0
		assert out.data['end'] > 0

	def test_pause_without_running_is_state_error(self):
		out = run('timer.pause')
		assert out.result == 'ERROR' and out.data['code'] == 'state'


@pytest.mark.usefixtures('control')
class TestNotify:
	def test_set_probe_target(self):
		out = run('notify.set', label='Probe1', req=True, target=165, shutdown=True)
		assert out.result == 'OK'
		entry = next(n for n in common.read_control()['notify_data'] if n['label'] == 'Probe1' and n['type'] == 'probe')
		assert entry['req'] and entry['target'] == 165 and entry['shutdown']

	def test_target_in_celsius_stays_on_the_notify_entry(self):
		run('units', units='C')
		run('notify.set', label='Probe1', target=74.5)
		c = common.read_control()
		entry = next(n for n in c['notify_data'] if n['label'] == 'Probe1' and n['type'] == 'probe')
		assert entry['target'] == 74.5
		assert c['primary_setpoint'] == 0  # legacy bug: this used to be overwritten

	def test_limit_high(self):
		run('notify.set', label='Grill', kind='probe_limit_high', req=True, target=300)
		entry = next(n for n in common.read_control()['notify_data'] if n['label'] == 'Grill' and n['type'] == 'probe_limit_high')
		assert entry['req'] and entry['target'] == 300

	def test_unknown_label(self):
		out = run('notify.set', label='Nope', req=True)
		assert out.result == 'ERROR' and out.data['code'] == 'not_found'

	def test_timer_has_no_target(self):
		out = run('notify.set', label='Timer', kind='timer', target=100)
		assert out.result == 'ERROR' and out.data['code'] == 'invalid'


@pytest.mark.usefixtures('control')
class TestManualAndSettings:
	def test_manual_output_requires_manual_mode(self):
		out = run('manual.output', output='fan', on=True)
		assert out.result == 'ERROR' and out.data['code'] == 'state'
		run('mode.manual')
		out = run('manual.output', output='fan', on=True)
		assert out.result == 'OK'
		assert common.read_control()['manual'] == {'change': 'fan', 'output': True, 'pwm': 100} or common.read_control()['manual']['change'] == 'fan'

	def test_settings_patch_sets_flags(self):
		out = run('settings.patch', patch={'cycle_data': {'PMode': 3}, 'controller': {'selected': 'pid_ac'}})
		assert out.result == 'OK'
		assert 'cycle_data.PMode' in out.data['changed']
		c = common.read_control()
		assert c['settings_update'] and c['controller_update']
		assert common.read_settings()['cycle_data']['PMode'] == 3

	def test_settings_patch_protected_path(self):
		out = run('settings.patch', patch={'versions': {'server': '9.9.9'}})
		assert out.result == 'ERROR'
