"""Probe map editing: devices, probes (ports) and profiles.

The probe map lives in settings['probe_settings']['probe_map'] and is loaded by
the control process at startup (ProbesMain). Profile changes are picked up
live via the ``probe_profile_update`` flag; adding/removing/reconfiguring
devices requires a control restart, which ``apply_probe_map`` reports.
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

from common import common

LABEL_RE = re.compile(r'[^A-Za-z0-9]')


def modules_catalogue() -> dict:
	"""Probe device modules from the wizard manifest, including per-module config options."""
	try:
		manifest = json.loads(Path('wizard/wizard_manifest.json').read_text())
		return manifest['modules']['probes']
	except (OSError, ValueError, KeyError):
		return {}


def to_label(name: str) -> str:
	return LABEL_RE.sub('', name)


def validate_probe_map(probe_map: dict, modules: dict | None = None) -> list[str]:
	"""Return a list of human-readable problems; empty means valid."""
	modules = modules if modules is not None else modules_catalogue()
	errors: list[str] = []
	devices = probe_map.get('probe_devices', [])
	probes = probe_map.get('probe_info', [])

	names = [d.get('device', '') for d in devices]
	for n in names:
		if not n:
			errors.append('A device has no name.')
		elif names.count(n) > 1:
			errors.append(f'Device name {n!r} is used more than once.')
	device_ports = {d.get('device'): set(d.get('ports', [])) for d in devices}
	device_module = {d.get('device'): d.get('module') for d in devices}
	for d in devices:
		mod = d.get('module')
		if modules and mod not in modules:
			errors.append(f'Device {d.get("device")!r} uses unknown module {mod!r}.')

	labels = [p.get('label', '') for p in probes]
	primaries = [p for p in probes if p.get('type') == 'Primary']
	if len(primaries) != 1:
		errors.append(f'There must be exactly one Primary probe (found {len(primaries)}).')
	used_ports: set[tuple] = set()
	for p in probes:
		label = p.get('label', '')
		if not label or to_label(label) != label:
			errors.append(f'Probe label {label!r} must be letters and digits only.')
		if labels.count(label) > 1:
			errors.append(f'Probe label {label!r} is used more than once.')
		if p.get('type') not in ('Primary', 'Food', 'Aux'):
			errors.append(f'Probe {label!r} has invalid type {p.get("type")!r}.')
		dev, port = p.get('device'), p.get('port')
		if dev not in device_ports:
			errors.append(f'Probe {label!r} references unknown device {dev!r}.')
		elif port not in device_ports[dev]:
			errors.append(f'Probe {label!r} uses port {port!r} which device {dev!r} does not have.')
		if (dev, port) in used_ports:
			errors.append(f'Port {port!r} on {dev!r} is assigned to more than one probe.')
		used_ports.add((dev, port))
		prof = p.get('profile')
		if not isinstance(prof, dict) or not {'A', 'B', 'C', 'id', 'name'} <= set(prof):
			errors.append(f'Probe {label!r} has an incomplete profile.')
	for d in devices:
		if 'virtual' in str(device_module.get(d.get('device'), '')):
			for ref in d.get('config', {}).get('probes_list', []) or []:
				if ref not in labels:
					errors.append(f'Virtual device {d.get("device")!r} references missing probe {ref!r}.')
	return errors


def default_device(module: str, name: str | None = None, modules: dict | None = None) -> dict:
	"""A device entry for ``module`` with the manifest's default config values."""
	modules = modules if modules is not None else modules_catalogue()
	meta = modules[module]
	spec = meta.get('device_specific', {})
	config: dict[str, Any] = {}
	for opt in spec.get('config', []):
		config[opt['label']] = [] if opt['label'] == 'probes_list' else opt.get('default', '')
	friendly = meta.get('friendly_name', module)
	# "Cloud - ThermoMaven (G1 / G2 / G4 / P-series)" -> "ThermoMaven"
	short = re.sub(r'\s*\(.*?\)', '', friendly.split(' - ', 1)[-1]).strip()
	return {
		'device': to_label(name or short) or module,
		'module': module,
		'module_filename': meta.get('filename', module),
		'ports': list(spec.get('ports', [])),
		'config': config,
	}


def apply_probe_map(probe_map: dict, *, current_settings: dict | None = None) -> dict:
	"""Validate and store a new probe map. Returns {restart_required, changed}."""
	errors = validate_probe_map(probe_map)
	if errors:
		raise ValueError('; '.join(errors))
	settings = current_settings if current_settings is not None else common.read_settings()
	old = settings['probe_settings']['probe_map']
	devices_changed = json.dumps(old.get('probe_devices'), sort_keys=True) != json.dumps(probe_map.get('probe_devices'), sort_keys=True)
	ports_changed = [(p['label'], p['device'], p['port'], p['type']) for p in old.get('probe_info', [])] != [
		(p['label'], p['device'], p['port'], p['type']) for p in probe_map.get('probe_info', [])
	]
	settings['probe_settings']['probe_map'] = copy.deepcopy(probe_map)
	# Keep dependent structures consistent (history graph config, recipe probe map, notify entries)
	settings['history_page']['probe_config'] = common.default_probe_config(settings)
	common.write_settings(settings)
	return {'restart_required': devices_changed or ports_changed, 'changed': True}


def upsert_profile(profile: dict) -> dict:
	"""Add or update a probe profile; also refresh any probes using it."""
	settings = common.read_settings()
	profiles = settings['probe_settings']['probe_profiles']
	pid = profile.get('id') or common.generate_uuid()
	entry = {'id': pid, 'name': str(profile.get('name', 'Custom')), 'A': float(profile['A']), 'B': float(profile['B']), 'C': float(profile['C'])}
	profiles[pid] = entry
	for p in settings['probe_settings']['probe_map']['probe_info']:
		if p.get('profile', {}).get('id') == pid:
			p['profile'] = dict(entry)
	common.write_settings(settings)
	return entry


def delete_profile(pid: str) -> None:
	settings = common.read_settings()
	if any(p.get('profile', {}).get('id') == pid for p in settings['probe_settings']['probe_map']['probe_info']):
		raise ValueError('Profile is in use by a probe.')
	settings['probe_settings']['probe_profiles'].pop(pid, None)
	common.write_settings(settings)
