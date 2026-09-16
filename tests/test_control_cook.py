"""Golden simulated cooks: the real control process driving the thermal model.

These are the regression guard for control.py. They exercise the mode state
machine, the safety logic and the work cycle exactly as shipped, just faster.
"""
import pytest

pytestmark = pytest.mark.slow


def test_boots_into_stop_mode(harness):
	c = harness.control()
	assert c['mode'] == 'Stop'
	out = harness.outputs()
	assert not out['auger'] and not out['igniter'] and not out['fan']


def test_startup_lights_fire_and_transitions_to_smoke(harness):
	harness.command('set', 'mode', 'startup')
	harness.wait_mode('Startup', sim_seconds=30)
	harness.wait_outputs(power=True, fan=True, igniter=True, sim_seconds=30)
	# default startup duration is 240 s, then start_to_mode -> Smoke
	harness.wait_mode('Smoke', sim_seconds=300)
	assert harness.world.lit
	assert harness.pit() > 100
	assert not harness.outputs()['igniter']


def test_hold_reaches_and_holds_setpoint(harness):
	harness.command('set', 'mode', 'startup')
	harness.wait_mode('Smoke', sim_seconds=300)
	harness.command('set', 'mode', 'hold', '225')
	harness.wait_mode('Hold', sim_seconds=30)
	harness.wait_for(lambda: harness.pit() >= 215, sim_seconds=1800, msg='reach 215F')
	# Hold for 20 simulated minutes and check it stays in band
	samples = []
	for _ in range(20):
		harness.run_sim(60)
		samples.append(harness.pit())
	assert harness.control()['mode'] == 'Hold'
	assert min(samples) > 195, samples
	assert max(samples) < 260, samples
	cur = harness.current()
	assert cur['PSP'] == 225


def test_shutdown_burns_off_and_stops(harness):
	harness.command('set', 'mode', 'startup')
	harness.wait_mode('Smoke', sim_seconds=300)
	harness.command('set', 'mode', 'shutdown')
	harness.wait_mode('Shutdown', sim_seconds=30)
	harness.wait_outputs(fan=True, auger=False, igniter=False, sim_seconds=30)
	harness.wait_mode('Stop', sim_seconds=300)
	harness.wait_outputs(fan=False, power=False, sim_seconds=30)


def test_over_temp_trips_error(harness):
	harness.command('set', 'mode', 'startup')
	harness.wait_mode('Smoke', sim_seconds=300)
	harness.world.forced_pit_f = 600  # above safety.maxtemp (550F)
	harness.wait_mode('Error', sim_seconds=60)
	harness.wait_outputs(auger=False, igniter=False, sim_seconds=30)


def test_flameout_in_smoke_triggers_reignite_then_error(harness):
	harness.command('set', 'mode', 'startup')
	harness.wait_mode('Smoke', sim_seconds=300)
	# Pit falls below the startup safety temperature -> one reignite retry (default reigniteretries=1)
	harness.world.forced_pit_f = 60
	harness.wait_mode('Reignite', sim_seconds=60)
	harness.wait_outputs(igniter=True, sim_seconds=30)
	# Reignite runs a startup cycle then returns to Smoke; still cold -> Error
	harness.wait_mode('Error', sim_seconds=600)


def test_prime_then_startup(harness):
	harness.command('set', 'mode', 'prime', '10', 'startup')
	harness.wait_mode('Prime', sim_seconds=30)
	harness.wait_outputs(auger=True, fan=False, sim_seconds=30)
	harness.wait_mode('Startup', sim_seconds=120)
	assert harness.world.pellets_g > 5


def test_monitor_mode_reads_without_outputs(harness):
	harness.world.forced_pit_f = 180
	harness.command('set', 'mode', 'monitor')
	harness.wait_mode('Monitor', sim_seconds=30)
	harness.run_sim(10)
	out = harness.outputs()
	assert not out['auger'] and not out['igniter'] and not out['fan'] and not out['power']
	assert harness.pit() == 180


def test_stop_from_hold_turns_everything_off(harness):
	harness.command('set', 'mode', 'startup')
	harness.wait_mode('Smoke', sim_seconds=300)
	harness.command('set', 'mode', 'stop')
	harness.wait_mode('Stop', sim_seconds=60)
	harness.wait_outputs(auger=False, igniter=False, fan=False, power=False, sim_seconds=30)


def test_settings_change_is_picked_up_live(harness):
	harness.command('set', 'mode', 'startup')
	harness.wait_mode('Smoke', sim_seconds=300)
	harness.settings_patch({'cycle_data': {'PMode': 5}})
	harness.run_sim(5)
	assert harness.control()['settings_update'] is False
	from common import common

	assert common.read_settings()['cycle_data']['PMode'] == 5


def test_history_and_current_are_written(harness):
	from common import common

	harness.command('set', 'mode', 'startup')
	harness.wait_mode('Startup', sim_seconds=30)
	harness.run_sim(30)
	assert len(common.read_history()) >= 5
	cur = harness.current()
	assert 'Grill' in cur['P'] and 'Probe1' in cur['F']
	st = harness.status()
	assert st['mode'] == 'Startup'
	assert st['outpins']['fan'] is True
