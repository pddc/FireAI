"""Run the real control process against the thermal simulator, fast.

``ControlHarness`` starts ``control.main()`` in a background thread on the
simulator grill platform + simulator probe device with a patched clock, and
gives tests a small API to issue commands and wait for state.

Because ``time.time``/``time.sleep`` are patched process-wide, *simulated*
seconds advance only when some thread calls ``time.sleep``; the control loop
does so ~every 50-100 ms of simulated time, so a 4-minute startup takes well
under a second of wall time.
"""
from __future__ import annotations

import threading
import time as _time

from common import common
from core.sim import SimConfig, get_world, reset_world

REAL_SLEEP = _time.sleep  # captured before any monkeypatching


class _NoopMonitor:
	"""Stands in for Process_Monitor (which would spawn a heartbeat thread)."""

	def __init__(self, *a, **k):
		pass

	def start_monitor(self):
		pass

	def heartbeat(self):
		pass

	def stop_monitor(self):
		pass


def simulator_settings(settings: dict, *, units='F', dc_fan=False) -> dict:
	"""Point a default settings dict at the simulator modules."""
	settings['modules']['grillplat'] = 'simulator'
	settings['modules']['display'] = 'none'
	settings['modules']['dist'] = 'none'
	settings['platform']['real_hw'] = False
	settings['platform']['standalone'] = True
	settings['platform']['dc_fan'] = dc_fan
	settings['globals']['first_time_setup'] = False
	settings['globals']['units'] = units
	profiles = settings['probe_settings']['probe_profiles']
	settings['probe_settings']['probe_map'] = {
		'probe_devices': [{
			'device': 'sim', 'module': 'simulator', 'module_filename': 'simulator',
			'ports': ['SIM0', 'SIM1', 'SIM2', 'SIM3'], 'config': {},
		}],
		'probe_info': [
			{'type': 'Primary', 'label': 'Grill', 'name': 'Grill', 'profile': profiles['99b8f02d-233d-11ee-a7a2-e5396c02c5fd'], 'device': 'sim', 'port': 'SIM0', 'enabled': True},
			{'type': 'Food', 'label': 'Probe1', 'name': 'Probe-1', 'profile': profiles['TWPS00'], 'device': 'sim', 'port': 'SIM1', 'enabled': True},
			{'type': 'Food', 'label': 'Probe2', 'name': 'Probe-2', 'profile': profiles['TWPS00'], 'device': 'sim', 'port': 'SIM2', 'enabled': True},
		],
	}
	return settings


class ControlHarness:
	def __init__(self, clock, monkeypatch, sim_config: SimConfig | None = None):
		self.clock = clock
		self.world = reset_world(sim_config)
		import control as control_module

		self.module = control_module
		monkeypatch.setattr(control_module, 'Process_Monitor', _NoopMonitor)
		self.stop_event = threading.Event()
		self.thread: threading.Thread | None = None
		self.error: BaseException | None = None

	# ----- lifecycle -------------------------------------------------------
	def start(self):
		def run():
			try:
				self.module.main(stop_event=self.stop_event)
			except BaseException as e:  # noqa: BLE001 - surfaced to the test
				self.error = e

		# The module keeps its globals between harness runs; clear them so the
		# readiness wait below sees *this* run's objects.
		self.module.grill_platform = None
		self.module.dist_device = None
		common.cmdsts.delete('probe_device_info')
		self.thread = threading.Thread(target=run, name='control-sim', daemon=True)
		self.thread.start()
		# _initialize() first stores the module *name* in grill_platform, then the object.
		self.wait_for(lambda: hasattr(self.module.grill_platform, 'get_output_status') and self.module.dist_device is not None,
					  sim_seconds=60, msg='control init')
		# _initialize() flushes Redis; a command queued before the main loop's first pass would be lost on a slow
		# machine. probe_device_info is written at the top of every loop iteration, so its presence means the
		# flush is over and execute_control_writes() is about to run.
		self.wait_for(lambda: common.read_generic_key('probe_device_info') is not None, sim_seconds=60, msg='control loop')
		return self

	def stop(self):
		# Ask for Stop mode first so any work cycle exits, then stop the loop.
		if self.thread and self.thread.is_alive():
			try:
				self.command('set', 'mode', 'stop')
				self.wait_for(lambda: self.control()['mode'] in ('Stop', 'Error'), sim_seconds=120, msg='stop before shutdown')
			except AssertionError:
				pass
			self.stop_event.set()
			self.thread.join(timeout=10)
		if self.error:
			raise self.error

	# ----- state -----------------------------------------------------------
	def control(self) -> dict:
		return common.read_control()

	def current(self) -> dict:
		return common.read_current()

	def status(self) -> dict:
		return common.read_status()

	def outputs(self) -> dict:
		return self.module.grill_platform.get_output_status()

	def pit(self) -> float:
		cur = self.current()
		return list(cur.get('P', {}).values())[0] if cur.get('P') else 0

	# ----- actions ---------------------------------------------------------
	def command(self, action, *args):
		return common.process_command(action=action, arglist=list(args), origin='test')

	def settings_patch(self, patch: dict):
		s = common.read_settings()
		common.deep_update(s, patch)
		common.write_settings(s)
		common.write_control({'settings_update': True}, origin='test')

	# ----- waiting ---------------------------------------------------------
	def wait_for(self, predicate, *, sim_seconds: float, msg: str = '', poll_real=0.001):
		"""Block (in real time) until predicate() is true or the *simulated* clock
		has advanced by ``sim_seconds``."""
		deadline = self.clock.time() + sim_seconds
		real_deadline = _time.monotonic() + 60  # hard wall-clock cap
		while True:
			if self.error:
				raise self.error
			if predicate():
				return True
			if self.clock.time() >= deadline:
				raise AssertionError(f'timed out after {sim_seconds}s simulated waiting for {msg or predicate}')
			if _time.monotonic() > real_deadline:
				raise AssertionError(f'wall-clock timeout waiting for {msg or predicate} (sim clock stuck?)')
			REAL_SLEEP(poll_real)

	def wait_mode(self, mode, sim_seconds):
		return self.wait_for(lambda: self.control()['mode'] == mode, sim_seconds=sim_seconds, msg=f'mode {mode}')

	def wait_outputs(self, *, sim_seconds, **expected):
		"""Wait until every named output matches (e.g. fan=True, auger=False)."""

		def ok():
			out = self.outputs()
			return all(out.get(k) == v for k, v in expected.items())

		return self.wait_for(ok, sim_seconds=sim_seconds, msg=f'outputs {expected} (now {self.outputs()})')

	def run_sim(self, sim_seconds: float):
		"""Let the controller run for a span of simulated time."""
		target = self.clock.time() + sim_seconds
		self.wait_for(lambda: self.clock.time() >= target, sim_seconds=sim_seconds + 5, msg='run_sim')


__all__ = ['ControlHarness', 'simulator_settings', 'get_world']
