"""Sanity checks on the thermal model itself (no controller involved)."""
from core.sim import SimConfig, reset_world


def run(world, seconds, clock):
	clock.advance(seconds)
	world.advance()


def test_cold_pit_stays_at_ambient(clock):
	w = reset_world()
	run(w, 600, clock)
	assert abs(w.pit_temp_f() - 70) < 1


def test_igniter_and_auger_light_the_fire_and_heat_the_pit(clock):
	w = reset_world()
	w.set_output('power', True)
	w.set_output('fan', True)
	w.set_output('auger', True)
	w.set_output('igniter', True)
	run(w, 60, clock)
	assert w.lit
	t1 = w.pit_temp_f()
	run(w, 120, clock)
	assert w.pit_temp_f() > t1 > 70


def test_fire_goes_out_without_fuel(clock):
	w = reset_world()
	w.set_output('power', True)
	w.set_output('fan', True)
	w.set_output('auger', True)
	w.set_output('igniter', True)
	run(w, 60, clock)
	assert w.lit
	w.set_output('auger', False)
	w.set_output('igniter', False)
	run(w, 600, clock)
	assert not w.lit
	assert w.pit_temp_f() < 150


def test_food_lags_pit(clock):
	w = reset_world(SimConfig(k_food=0.01))
	w.forced_pit_f = 225
	w.set_output('power', True)
	run(w, 30, clock)
	f = w.food_temp_f(0)
	assert 70 < f < 225


def test_steady_fuel_reaches_equilibrium(clock):
	w = reset_world()
	w.set_output('power', True)
	w.set_output('fan', True)
	w.set_output('igniter', True)
	w.set_output('auger', True)
	run(w, 60, clock)
	w.set_output('igniter', False)
	# Full auger duty: pit should climb well past 300F and level off, not run away.
	run(w, 1800, clock)
	a = w.pit_temp_f()
	run(w, 600, clock)
	b = w.pit_temp_f()
	assert a > 300
	assert abs(b - a) < 5
