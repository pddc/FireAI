"""Probe profile tuning: Steinhart-Hart coefficient fitting.

Manual: three (temperature, resistance) points -> A, B, C.
Auto: the control process records (reference temp, probe Tr) pairs while
``tuning_mode`` is on; ``autotune_status`` picks low/medium/high points and
says when the spread is wide enough to fit.
"""
from __future__ import annotations

import math

from common import common


def to_kelvin(temp: float, units: str) -> float:
	return ((temp - 32) * 5 / 9) + 273.15 if units == 'F' else temp + 273.15


def shh_coefficients(t1: float, t2: float, t3: float, r1: float, r2: float, r3: float, units: str = 'F') -> tuple[float, float, float]:
	"""Fit A, B, C from three temperature/resistance pairs (https://en.wikipedia.org/wiki/Steinhart–Hart_equation)."""
	k1, k2, k3 = (to_kelvin(t, units) for t in (t1, t2, t3))
	l1, l2, l3 = math.log(r1), math.log(r2), math.log(r3)
	y1, y2, y3 = 1 / k1, 1 / k2, 1 / k3
	if l2 == l1 or l3 == l1 or l3 == l2:
		raise ValueError('resistances must be distinct')
	g2 = (y2 - y1) / (l2 - l1)
	g3 = (y3 - y1) / (l3 - l1)
	c = ((g3 - g2) / (l3 - l2)) * (1 / (l1 + l2 + l3))
	b = g2 - c * (l1 * l1 + l1 * l2 + l2 * l2)
	a = y1 - (b + l1 * l1 * c) * l1
	return a, b, c


def tr_to_temp(tr: float, a: float, b: float, c: float, units: str = 'F') -> float | None:
	if tr <= 0:
		return None
	ln = math.log(tr)
	denom = a + b * ln + c * ln**3
	if denom == 0:
		return None
	k = 1 / denom
	celsius = k - 273.15
	return celsius * 9 / 5 + 32 if units == 'F' else celsius


def temp_to_tr(temp: float, a: float, b: float, c: float, units: str = 'F') -> float | None:
	"""Inverse fit; returns None where the cubic has no real solution."""
	try:
		k = to_kelvin(temp, units)
		x = (a - 1 / k) / c
		y = math.sqrt((b / (3 * c)) ** 3 + (x * x) / 4)
		return math.exp((y - x / 2) ** (1 / 3) - (y + x / 2) ** (1 / 3))
	except (ValueError, ZeroDivisionError, OverflowError):
		return None


def fit_curve(a: float, b: float, c: float, units: str = 'F', temp_range: int = 220, points: int = 22) -> list[dict]:
	"""Temperature -> resistance samples for plotting a fitted profile."""
	out = []
	step = max(1, temp_range // points)
	for t in range(0, temp_range + 1, step):
		r = temp_to_tr(t, a, b, c, units)
		if r is None:
			continue
		out.append({'temp': t, 'tr': round(r)})
	return out


# --------------------------------------------------------------------------
# Auto-tune session (uses the control process's tuning_mode + Redis buffers)
# --------------------------------------------------------------------------


def start_autotune() -> None:
	control = common.read_control()
	if not control['tuning_mode']:
		common.read_autotune(flush=True)
	patch = {'tuning_mode': True}
	if control['mode'] == 'Stop':
		patch.update({'mode': 'Monitor', 'updated': True})
	common.write_control(patch, origin='tuner')


def stop_autotune() -> None:
	common.write_control({'tuning_mode': False}, origin='tuner')


def record_sample(probe_label: str, reference_label: str) -> dict:
	"""Read the tuned probe's Tr and the reference probe's temperature; append to the autotune buffer."""
	tr_all = common.read_tr() or {}
	current = common.read_current() or {}
	tr = tr_all.get(probe_label, -1)
	temp = -1
	for group in ('P', 'F', 'AUX'):
		if reference_label in current.get(group, {}):
			temp = current[group][reference_label]
			break
	size = common.read_autotune(size_only=True)
	if tr is not None and temp is not None and tr >= 0 and temp >= 0 and (size > 4 or temp > 0):
		common.write_autotune({'ref_T': temp, 'probe_Tr': tr})
	return {'current_tr': tr, 'current_temp': temp}


def autotune_status(units: str) -> dict:
	"""Low/medium/high picks from the recorded pairs, and whether the spread is enough to fit."""
	data = common.read_autotune() or []
	status = {'samples': len(data), 'ready': False, 'high': None, 'medium': None, 'low': None}
	if len(data) <= 10:
		return status
	by_temp: dict[float, float] = {}
	for d in data:
		by_temp[d['ref_T']] = d['probe_Tr']  # latest reading per temperature wins
	temps = sorted(by_temp)
	lo, hi = temps[0], temps[-1]
	mid_target = (hi - lo) / 2 + lo
	mid = min(temps, key=lambda t: abs(t - mid_target))
	status.update({'low': {'temp': lo, 'tr': by_temp[lo]}, 'high': {'temp': hi, 'tr': by_temp[hi]}, 'medium': {'temp': mid, 'tr': by_temp[mid]}})
	status['ready'] = (hi - lo) >= (50 if units == 'F' else 25) and len({by_temp[lo], by_temp[mid], by_temp[hi]}) == 3
	return status
