"""Read-side helpers: one function that assembles everything a dashboard needs.

The snapshot is what the WebSocket pushes, what the REST ``/state`` endpoint
returns and what the cloud bridge mirrors to RTDB. Keeping it in one place
means every client sees the same shape.
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from common import common

_settings_cache: dict[str, Any] = {'mtime': None, 'data': None, 'checked': 0.0}


def cached_settings(max_age_s: float = 1.0) -> dict:
	"""settings.json parsed at most once per max_age_s (or when its mtime changes)."""
	import os

	now = time.time()
	if _settings_cache['data'] is not None and (now - _settings_cache['checked']) < max_age_s:
		return _settings_cache['data']
	try:
		mtime = os.stat('settings.json').st_mtime
	except OSError:
		mtime = None
	if _settings_cache['data'] is None or mtime != _settings_cache['mtime']:
		_settings_cache['data'] = common.read_settings()
		_settings_cache['mtime'] = mtime
	_settings_cache['checked'] = now
	return _settings_cache['data']


def invalidate_settings_cache() -> None:
	_settings_cache['data'] = None
	_settings_cache['mtime'] = None


def probe_meta(settings: dict) -> list[dict]:
	"""Static probe descriptions (label, name, type, device, enabled) in map order."""
	return [
		{'label': p['label'], 'name': p['name'], 'type': p['type'], 'device': p['device'], 'port': p['port'],
		 'enabled': p.get('enabled', True)}
		for p in settings['probe_settings']['probe_map']['probe_info']
	]


def snapshot() -> dict:
	"""Everything the dashboard shows, in one document."""
	settings = cached_settings()
	current = common.read_current() or {}
	control = common.read_control()
	status = common.read_status()
	try:
		pelletdb = common.read_pellet_db()
		pellet_id = pelletdb['current']['pelletid']
		pellet = pelletdb['archive'].get(pellet_id, {})
		hopper = {
			'level': pelletdb['current']['hopper_level'],
			'enabled': settings['modules']['dist'] != 'none',
			'pellets': f"{pellet.get('brand', '')} {pellet.get('wood', '')}".strip(),
			'est_usage_g': pelletdb['current'].get('est_usage', 0),
		}
	except Exception:
		hopper = {'level': None, 'enabled': False, 'pellets': '', 'est_usage_g': 0}

	notify = [
		{k: v for k, v in n.items()}
		for n in control.get('notify_data', [])
	]
	try:
		probe_status = common.read_probe_status(settings['probe_settings']['probe_map']['probe_info'])
	except Exception:  # control process not running yet -> no device info in Redis
		probe_status = {'P': {}, 'F': {}, 'AUX': {}}

	return {
		'ts': current.get('TS') or int(time.time() * 1000),
		'name': settings['globals']['grill_name'],
		'units': settings['globals']['units'],
		'mode': control.get('mode', 'Stop'),
		'next_mode': control.get('next_mode'),
		'status': control.get('status'),
		'display_mode': status.get('mode'),
		'critical_error': control.get('critical_error', False),
		'temps': {
			'primary': current.get('P', {}),
			'food': current.get('F', {}),
			'aux': current.get('AUX', {}),
		},
		'setpoint': control.get('primary_setpoint', 0),
		'notify_targets': current.get('NT', {}),
		'smoke_plus': control.get('s_plus', False),
		'pwm_control': control.get('pwm_control', False),
		'duty_cycle': control.get('duty_cycle'),
		'p_mode': status.get('p_mode'),
		'outputs': status.get('outpins', {}),
		'timer': control.get('timer', {}),
		'lid_open': {'detected': status.get('lid_open_detected', False), 'end_time': status.get('lid_open_endtime', 0)},
		'startup': {
			'timestamp': status.get('startup_timestamp', 0),
			'start_time': status.get('start_time', 0),
			'duration': status.get('start_duration', 0),
		},
		'shutdown_duration': status.get('shutdown_duration', 0),
		'prime': {'duration': status.get('prime_duration', 0), 'amount': status.get('prime_amount', 0)},
		'recipe': {'active': status.get('recipe', False), 'paused': status.get('recipe_paused', False)},
		'hopper': hopper,
		'notify': notify,
		'probes': probe_meta(settings),
		'probe_status': probe_status,
		'manual': control.get('manual', {}),
		'errors': common.read_errors(),
		'warnings': common.read_warnings(),
	}


def snapshot_hash(snap: dict) -> str:
	"""Hash of the parts that matter for change detection (timestamp excluded)."""
	body = {k: v for k, v in snap.items() if k != 'ts'}
	return hashlib.sha1(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()
