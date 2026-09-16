"""PID controllers are pure(ish) objects: behaviour must be stable across the refactor."""
import importlib
import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent

CYCLE = {
	'HoldCycleTime': 25, 'SmokeOnCycleTime': 15, 'SmokeOffCycleTime': 45, 'PMode': 2,
	'u_min': 0.1, 'u_max': 0.9, 'LidOpenDetectEnabled': False, 'LidOpenThreshold': 15, 'LidOpenPauseTime': 60,
}
CONTROLLERS = ['pid', 'pid_ac', 'pid_clamping', 'pid_parallel', 'pid_sp', 'pid_clamping_percent_pb']


def default_config(name):
	"""Build the config dict the wizard would generate from controllers.json defaults."""
	meta = json.load(open(REPO_ROOT / 'controller' / 'controllers.json'))['metadata'][name]
	return {opt['option_name']: opt['option_default'] for opt in meta['config']}


@pytest.fixture(params=CONTROLLERS)
def controller(request, clock):
	mod = importlib.import_module(f'controller.{request.param}')
	return mod.Controller(default_config(request.param), 'F', dict(CYCLE))


def test_cold_grill_below_target_demands_more_fuel(controller, clock):
	controller.set_target(225)
	clock.advance(25)
	low = controller.update(100)
	assert isinstance(low, float | int)
	assert low > 0


def test_hot_grill_above_target_demands_less_fuel_than_cold(controller, clock):
	controller.set_target(225)
	clock.advance(25)
	low = controller.update(150)
	controller.set_target(225)
	clock.advance(25)
	high = controller.update(300)
	assert high < low


def test_set_target_updates_setpoint(controller):
	controller.set_target(250)
	assert controller.set_point == 250


def test_config_roundtrip(controller):
	cfg = controller.get_config()
	controller.set_config(dict(cfg))
	assert controller.get_config() == cfg


def test_pid_gains_from_pb_ti_td():
	from controller.pid import Controller

	c = Controller({'PB': 60.0, 'Ti': 180.0, 'Td': 45.0, 'center': 0.5}, 'F', dict(CYCLE))
	assert c.kp == pytest.approx(-1 / 60)
	assert c.ki == pytest.approx(c.kp / 180)
	assert c.kd == pytest.approx(c.kp * 45)


def test_pid_zero_pb_disables_proportional():
	from controller.pid import Controller

	c = Controller({'PB': 0, 'Ti': 0, 'Td': 0}, 'F', dict(CYCLE))
	assert c.kp == 0 and c.ki == 0 and c.kd == 0
