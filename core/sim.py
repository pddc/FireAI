"""Lightweight thermal model of a pellet grill for tests and local development.

The model is deliberately simple but responds to the controller's outputs the
way a real pit does: the auger adds pellets to the firepot, the igniter lights
them, the fan sets how fast they burn, and the pit temperature integrates
heat-in minus heat-loss. Food probes lag the pit.

One ``SimWorld`` is shared per process (see ``get_world``). The simulator grill
platform writes outputs into it and the simulator probe device reads
temperatures from it. All times come from ``time.time()`` so a patched clock
(see tests/conftest.py ``FakeClock``) drives the physics deterministically.

All internal temperatures are degrees Fahrenheit.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field


@dataclass
class SimConfig:
	ambient_f: float = 70.0
	# Auger delivery rate in grams/second while the auger output is on.
	auger_rate_gps: float = 0.3
	# Max burn rate (g/s) with the fan on; smouldering rate with the fan off.
	burn_max_fan_on: float = 0.6
	burn_max_fan_off: float = 0.08
	# First-order pellet consumption: burn = min(burn_max, pellets * burn_k).
	burn_k: float = 0.08
	# Pit heating per g/s burned (°F/s per g/s) and heat loss to ambient (1/s).
	k_energy: float = 5.9
	k_loss: float = 0.004
	# Direct heat contributed by the igniter element (°F/s) while it is on.
	igniter_heat: float = 0.35
	# Seconds the igniter must be on with pellets present before the fire lights.
	ignition_delay_s: float = 20.0
	# Seconds without fuel before a lit fire goes out.
	flameout_delay_s: float = 60.0
	# Food probe lag: dfood/dt = (pit - food) * k_food.
	k_food: float = 0.0008
	# Number of food probes to model.
	food_probes: int = 3
	# Physics is advanced in sub-steps no larger than this many seconds.
	max_step_s: float = 1.0


@dataclass
class SimWorld:
	config: SimConfig = field(default_factory=SimConfig)
	pit_f: float = 70.0
	food_f: list[float] = field(default_factory=list)
	pellets_g: float = 0.0
	lit: bool = False
	outputs: dict = field(default_factory=lambda: {'power': False, 'fan': False, 'auger': False, 'igniter': False, 'pwm': 100.0})
	_igniter_on_since: float | None = None
	_no_fuel_since: float | None = None
	_last_t: float = field(default_factory=lambda: time.time())  # lambda so a patched clock is honoured
	_lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
	# Optional overrides for tests: force a probe reading regardless of physics.
	forced_pit_f: float | None = None
	forced_food_f: dict[int, float] = field(default_factory=dict)

	def __post_init__(self):
		self.pit_f = self.config.ambient_f
		self.food_f = [self.config.ambient_f] * self.config.food_probes

	# ----- outputs ---------------------------------------------------------
	def set_output(self, name: str, value) -> None:
		with self._lock:
			self._advance_locked()
			self.outputs[name] = value

	# ----- readings --------------------------------------------------------
	def pit_temp_f(self) -> float:
		with self._lock:
			self._advance_locked()
			return self.forced_pit_f if self.forced_pit_f is not None else self.pit_f

	def food_temp_f(self, index: int) -> float:
		with self._lock:
			self._advance_locked()
			if index in self.forced_food_f:
				return self.forced_food_f[index]
			if index < len(self.food_f):
				return self.food_f[index]
			return self.config.ambient_f

	def snapshot(self) -> dict:
		with self._lock:
			self._advance_locked()
			return {
				'pit_f': round(self.pit_f, 2),
				'food_f': [round(f, 2) for f in self.food_f],
				'pellets_g': round(self.pellets_g, 2),
				'lit': self.lit,
				'outputs': dict(self.outputs),
			}

	# ----- physics ---------------------------------------------------------
	def advance(self) -> None:
		with self._lock:
			self._advance_locked()

	def _advance_locked(self) -> None:
		now = time.time()
		remaining = now - self._last_t
		if remaining <= 0:
			return
		t = self._last_t
		while remaining > 0:
			dt = min(remaining, self.config.max_step_s)
			t += dt
			self._step(dt, t)
			remaining -= dt
		self._last_t = now

	def _step(self, dt: float, t: float) -> None:
		c = self.config
		o = self.outputs
		powered = o.get('power', False)
		auger = powered and o.get('auger', False)
		igniter = powered and o.get('igniter', False)
		fan = powered and o.get('fan', False)

		# Fuel delivery
		if auger:
			self.pellets_g += c.auger_rate_gps * dt

		# Ignition
		if igniter and self.pellets_g > 0.5:
			if self._igniter_on_since is None:
				self._igniter_on_since = t
			elif (t - self._igniter_on_since) >= c.ignition_delay_s:
				self.lit = True
		else:
			self._igniter_on_since = None
		if not self.lit and self.pit_f > 400 and self.pellets_g > 0.5:
			self.lit = True  # embers re-light fresh fuel on a very hot pit

		# Combustion
		burn = 0.0
		if self.lit:
			burn_max = c.burn_max_fan_on if fan else c.burn_max_fan_off
			burn = min(burn_max, self.pellets_g * c.burn_k)
			burn = min(burn, self.pellets_g / dt) if dt > 0 else burn
			self.pellets_g = max(0.0, self.pellets_g - burn * dt)
			if self.pellets_g < 0.05:
				if self._no_fuel_since is None:
					self._no_fuel_since = t
				elif (t - self._no_fuel_since) >= c.flameout_delay_s:
					self.lit = False
			else:
				self._no_fuel_since = None

		# Pit temperature
		heat = burn * c.k_energy + (c.igniter_heat if igniter else 0.0)
		loss = (self.pit_f - c.ambient_f) * c.k_loss
		self.pit_f += (heat - loss) * dt
		self.pit_f = max(c.ambient_f - 5, self.pit_f)

		# Food probes lag the (effective) pit temperature
		pit = self.forced_pit_f if self.forced_pit_f is not None else self.pit_f
		for i, f in enumerate(self.food_f):
			self.food_f[i] = f + (pit - f) * c.k_food * dt

	# ----- test helpers ----------------------------------------------------
	def reset(self, config: SimConfig | None = None) -> None:
		with self._lock:
			if config is not None:
				self.config = config
			self.pit_f = self.config.ambient_f
			self.food_f = [self.config.ambient_f] * self.config.food_probes
			self.pellets_g = 0.0
			self.lit = False
			self.outputs = {'power': False, 'fan': False, 'auger': False, 'igniter': False, 'pwm': 100.0}
			self._igniter_on_since = None
			self._no_fuel_since = None
			self._last_t = time.time()
			self.forced_pit_f = None
			self.forced_food_f = {}


_world: SimWorld | None = None
_world_lock = threading.Lock()


def get_world() -> SimWorld:
	"""Return the process-wide simulated grill, creating it on first use."""
	global _world
	if _world is None:
		with _world_lock:
			if _world is None:
				_world = SimWorld()
	return _world


def reset_world(config: SimConfig | None = None) -> SimWorld:
	w = get_world()
	w.reset(config)
	return w
