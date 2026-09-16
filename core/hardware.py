"""Hardware configuration (the former wizard): platform/board, display, distance sensor.

Everything comes from ``wizard/wizard_manifest.json``:
* each module has ``settings_dependencies`` - {name: {friendly_name, description,
  options?, settings: [path...], hidden?}} - which we expose as a small form and
  write back with ``set_nested_key_value``;
* display modules also carry ``config`` option lists stored under
  settings['display']['config'][<module>];
* boards carry a default probe map for the PCB.

Dependency installation and board-config.py are handled by the FireAI
installer (all module dependencies are installed up front), so applying a
hardware selection here only writes settings and reports whether a control
restart or a reboot is needed.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from common import common
from core.settings_schema import get_path

MANIFEST = Path('wizard/wizard_manifest.json')
MODULE_KINDS = ('grillplatform', 'display', 'distance')


def manifest() -> dict:
	return json.loads(MANIFEST.read_text())


def convert_value(value: Any) -> Any:
	"""Coerce a form string to int/float/bool/None/list like the legacy wizard did."""
	if not isinstance(value, str):
		return value
	v = value.strip()
	if v in ('True', 'true'):
		return True
	if v in ('False', 'false'):
		return False
	if v in ('None', 'none', ''):
		return None if v != '' else ''
	try:
		return int(v)
	except ValueError:
		pass
	try:
		return float(v)
	except ValueError:
		pass
	if v.startswith('[') and v.endswith(']'):
		try:
			return json.loads(v)
		except ValueError:
			return value
	return value


def _module_view(kind: str, key: str, meta: dict, settings: dict) -> dict:
	deps = {}
	for name, dep in (meta.get('settings_dependencies') or {}).items():
		current = get_path(settings, '.'.join(dep['settings']), None)
		deps[name] = {
			'label': dep.get('friendly_name', name), 'help': dep.get('description', ''),
			'options': [{'value': k, 'label': v} for k, v in (dep.get('options') or {}).items()] or None,
			'path': '.'.join(dep['settings']), 'value': str(current) if current is not None else '', 'hidden': bool(dep.get('hidden', False)),
		}
	view = {
		'id': key, 'friendly_name': meta.get('friendly_name', key), 'description': meta.get('description', ''),
		'filename': meta.get('filename', key), 'reboot_required': bool(meta.get('reboot_required', False)),
		'image': meta.get('image', ''), 'settings': deps,
	}
	if kind == 'display':
		cfg_current = settings.get('display', {}).get('config', {}).get(meta.get('filename', key), {})
		view['config'] = [{**opt, 'value': cfg_current.get(opt['option_name'], opt.get('default'))} for opt in meta.get('config', [])]
	return view


def catalogue(settings: dict | None = None) -> dict:
	settings = settings or common.read_settings()
	m = manifest()
	out: dict[str, Any] = {'modules': {}, 'boards': {}, 'current': {}}
	for kind in MODULE_KINDS:
		out['modules'][kind] = {key: _module_view(kind, key, meta, settings) for key, meta in m['modules'][kind].items()}
	for key, board in m.get('boards', {}).items():
		out['boards'][key] = {'id': key, 'name': board.get('name', key), 'description': board.get('description', ''),
							  'probe_devices': [d['device'] for d in board.get('probe_map', {}).get('probe_devices', [])]}
	out['current'] = {
		'grillplatform': settings['platform'].get('current', 'custom'),
		'display': settings['display'].get('selected', settings['modules'].get('display', 'none')),
		'distance': settings['modules'].get('dist', 'none'),
		'units': settings['globals']['units'],
		'real_hw': settings['platform'].get('real_hw', True),
		'first_time_setup': settings['globals'].get('first_time_setup', False),
	}
	return out


def apply(selection: dict) -> dict:
	"""Write a hardware selection to settings.

	selection = {
	  'grillplatform': {'id': 'pcb_4.x.x', 'settings': {name: value}},
	  'display':       {'id': 'ili9341e', 'settings': {...}, 'config': {option_name: value}},
	  'distance':      {'id': 'vl53l0x', 'settings': {...}},
	  'units': 'F' | 'C',            # optional
	  'board_probe_map': 'pcb_4.x.x' # optional: replace the probe map with the board default
	}
	"""
	m = manifest()
	settings = common.read_settings()
	reboot = False
	commands: list[list[str]] = []

	for kind in MODULE_KINDS:
		sel = selection.get(kind)
		if not sel:
			continue
		key = sel['id']
		if key not in m['modules'][kind]:
			raise ValueError(f'unknown {kind} module {key!r}')
		meta = m['modules'][kind][key]
		reboot = reboot or bool(meta.get('reboot_required'))
		commands.extend(meta.get('command_list') or [])
		deps = meta.get('settings_dependencies') or {}
		for name, value in (sel.get('settings') or {}).items():
			if name not in deps:
				raise ValueError(f'{kind}.{key} has no setting {name!r}')
			dep = deps[name]
			if dep.get('options') and str(value) not in dep['options']:
				raise ValueError(f'{name} must be one of {list(dep["options"])}')
			settings = common.set_nested_key_value(settings, dep['settings'], convert_value(value))
		if kind == 'display':
			settings['modules']['display'] = meta.get('filename', key)
			settings['display']['selected'] = key
			if sel.get('config') is not None:
				allowed = {o['option_name'] for o in meta.get('config', [])}
				bad = set(sel['config']) - allowed
				if bad:
					raise ValueError(f'unknown display options {sorted(bad)}')
				settings['display']['config'][meta.get('filename', key)] = {k: convert_value(v) for k, v in sel['config'].items()}
		elif kind == 'distance':
			settings['modules']['dist'] = meta.get('filename', key)
		elif kind == 'grillplatform':
			settings['platform']['current'] = key

	if selection.get('board_probe_map'):
		board = m.get('boards', {}).get(selection['board_probe_map'])
		if not board:
			raise ValueError('unknown board')
		settings['probe_settings']['probe_map'] = json.loads(json.dumps(board['probe_map']))
		settings['history_page']['probe_config'] = common.default_probe_config(settings)

	units = selection.get('units')
	if units in ('C', 'F') and units != settings['globals']['units']:
		settings = common.convert_settings_units(units, settings)

	# The platform module follows system_type; simulator is preserved for dev boxes.
	if settings['modules'].get('grillplat') != 'simulator':
		settings['modules']['grillplat'] = 'raspberry_pi_all' if settings['platform'].get('system_type') == 'raspberry_pi_all' else 'prototype'
	settings['globals']['first_time_setup'] = False
	common.write_settings(settings)
	return {'restart_required': True, 'reboot_required': reboot, 'commands': commands}
