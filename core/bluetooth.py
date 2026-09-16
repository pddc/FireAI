"""Bluetooth helpers for the API: scan for BLE probes through the control process, and a diagnostics report.

The scan goes through the control process (system command queue) because only one process should own the
adapter while a Bluetooth probe module is streaming; the report runs read-only shell commands directly.
"""
from __future__ import annotations

import importlib.metadata
import platform
import shutil
import subprocess
import sys
import time

from common import common
from common.redis_queue import RedisQueue

SCAN_TIMEOUT_S = 12


def scan(timeout: float = SCAN_TIMEOUT_S) -> dict:
	"""Ask the control process to scan (bleak on the Pi, a fixed list on the simulator). Returns {devices, error}."""
	RedisQueue('control:systemq').push(['scan_bluetooth'])
	out = common.get_system_command_output(requested='scan_bluetooth', timeout=timeout)
	if out.get('result') != 'OK':
		return {'devices': [], 'error': out.get('message') or 'Scan failed'}
	devices = []
	for d in out.get('data', {}).get('bt_devices', []):
		devices.append({'name': d.get('name') or 'Unknown', 'address': str(d.get('hw_id', '')).lower(), 'info': d.get('info', '')})
	return {'devices': devices, 'error': None if devices else 'No Bluetooth devices found. Make sure the thermometer is on and close by.'}


def _run(cmd: list[str], timeout: float = 10) -> str:
	if shutil.which(cmd[0]) is None:
		return f'{cmd[0]}: not installed'
	try:
		p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
	except subprocess.TimeoutExpired:
		return f'{" ".join(cmd)}: timed out'
	except OSError as e:
		return f'{" ".join(cmd)}: {e}'
	return (p.stdout or p.stderr).strip() or '(no output)'


def _package(name: str) -> str:
	try:
		return importlib.metadata.version(name)
	except importlib.metadata.PackageNotFoundError:
		return 'not installed'


def diagnostics() -> list[dict]:
	"""Sections of {title, output} mirroring PiFire's bt_diag.py, safe to run while the grill is cooking."""
	sections = [
		{'title': 'Python', 'output': f'{sys.version.split()[0]} ({sys.executable})\nbleak {_package("bleak")}\nbluepy {_package("bluepy")}'},
	]
	if platform.system() != 'Linux':
		sections.append({'title': 'Bluetooth stack', 'output': f'Diagnostics run on the Raspberry Pi only (this is {platform.system()}).'})
		return sections
	sections += [
		{'title': 'BlueZ', 'output': _run(['bluetoothd', '--version']) + '\n' + _run(['dpkg', '-s', 'bluez'])},
		{'title': 'bluetooth.service', 'output': _run(['systemctl', 'is-active', 'bluetooth']) + '\n' + _run(['systemctl', 'status', 'bluetooth', '--no-pager', '-l'])},
		{'title': 'Adapters (hciconfig -a)', 'output': _run(['hciconfig', '-a'])},
		{'title': 'bluetoothctl show', 'output': _run(['bluetoothctl', 'show'])},
		{'title': 'rfkill', 'output': _run(['rfkill', 'list', 'bluetooth'])},
		{'title': 'Process capabilities', 'output': _run(['capsh', '--print'])},
	]
	helper = shutil.which('bluepy-helper')
	if helper:
		sections.append({'title': 'bluepy-helper', 'output': f'{helper}\n{_run(["getcap", helper])}\n{_run(["ls", "-la", helper])}'})
	return sections


def diagnostics_text(sections: list[dict]) -> str:
	stamp = time.strftime('%Y-%m-%d %H:%M:%S')
	body = [f'FireAI Bluetooth diagnostics - {stamp}']
	for s in sections:
		body += ['', '=' * 60, f'  {s["title"]}', '=' * 60, s['output']]
	return '\n'.join(body) + '\n'
