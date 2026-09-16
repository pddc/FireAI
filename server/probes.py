"""Probe map editing endpoints."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from common import common
from core import probes_config
from core import state as core_state
from core.settings_schema import redact
from server import auth
from server.deps import current_principal, require_admin

router = APIRouter(prefix='/api/v1/probes', tags=['probes'])


class ProbeMapBody(BaseModel):
	probe_map: dict[str, Any]


class ProfileBody(BaseModel):
	id: str | None = None
	name: str = Field(min_length=1, max_length=60)
	A: float
	B: float
	C: float


class NewDeviceBody(BaseModel):
	module: str
	name: str | None = None


@router.get('/config')
def get_config(_: auth.Principal = Depends(current_principal)):
	s = common.read_settings()
	modules = probes_config.modules_catalogue()
	return {
		'probe_map': redact({'m': s['probe_settings']['probe_map']})['m'],
		'profiles': s['probe_settings']['probe_profiles'],
		'modules': {
			k: {
				'friendly_name': v.get('friendly_name', k),
				'description': v.get('description', ''),
				'type': v.get('device_specific', {}).get('type'),
				'ports': v.get('device_specific', {}).get('ports', []),
				'config': v.get('device_specific', {}).get('config', []),
			}
			for k, v in modules.items()
		},
		'units': s['globals']['units'],
	}


@router.put('/config')
def put_config(body: ProbeMapBody, _: auth.Principal = Depends(require_admin)):
	# Preserve secrets the client sent back redacted.
	current = common.read_settings()['probe_settings']['probe_map']
	incoming = body.probe_map
	for dev in incoming.get('probe_devices', []):
		match = next((d for d in current.get('probe_devices', []) if d.get('device') == dev.get('device')), None)
		for k, v in list((dev.get('config') or {}).items()):
			if v == '***' and match:
				dev['config'][k] = match.get('config', {}).get(k, '')
	try:
		result = probes_config.apply_probe_map(incoming)
	except ValueError as e:
		raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={'code': 'invalid', 'message': str(e)})
	core_state.invalidate_settings_cache()
	common.write_control({'settings_update': True, 'probe_profile_update': not result['restart_required']}, origin='api')
	return result


@router.post('/devices/template')
def device_template(body: NewDeviceBody, _: auth.Principal = Depends(current_principal)):
	modules = probes_config.modules_catalogue()
	if body.module not in modules:
		raise HTTPException(status.HTTP_404_NOT_FOUND, detail={'code': 'unknown_module', 'message': body.module})
	return probes_config.default_device(body.module, body.name, modules)


@router.put('/profiles')
def put_profile(body: ProfileBody, _: auth.Principal = Depends(require_admin)):
	entry = probes_config.upsert_profile(body.model_dump())
	core_state.invalidate_settings_cache()
	common.write_control({'probe_profile_update': True}, origin='api')
	return entry


@router.delete('/profiles/{pid}')
def delete_profile(pid: str, _: auth.Principal = Depends(require_admin)):
	try:
		probes_config.delete_profile(pid)
	except ValueError as e:
		raise HTTPException(status.HTTP_409_CONFLICT, detail={'code': 'in_use', 'message': str(e)})
	core_state.invalidate_settings_cache()
	return {'ok': True}
