"""PiFire-compatible HTTP API (docs.pifire.io → Advanced → API), so existing integrations keep working.

    GET/POST /api/get/...   /api/set/...   /api/cmd/...   /api/sys/...
    GET      /api/settings  /api/control   /api/current   /api/hopper   /api/server
    POST     /api/settings  /api/control

The get/set/cmd/sys verbs are handled by ``common.process_command`` — the same engine PiFire uses — so the
argument grammar and the ``{result, message, data}`` envelope are identical. Authentication is the only
addition: a session token or an API key (Settings → System → API keys) via ``Authorization: Bearer``,
``X-API-Key`` or ``?api_key=``. Reads need any principal; set/sys need operator or admin; cmd and POST
need admin. The new app uses ``/api/v1`` — this module is for third-party clients.
"""
from __future__ import annotations

import hashlib
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse

from common import common
from core import settings_schema
from core import state as core_state
from server import auth
from server.deps import current_principal, require_admin

router = APIRouter(tags=['legacy-api'])

WRITE_ROLES = ('admin', 'operator')


def _require_operator(p: auth.Principal = Depends(current_principal)) -> auth.Principal:
	if p.role not in WRITE_ROLES:
		raise HTTPException(status.HTTP_403_FORBIDDEN, detail={'code': 'forbidden', 'message': 'Operator or admin required.'})
	return p


def _ui_hash(settings: dict, current: dict) -> int:
	"""PiFire's create_ui_hash: changes whenever the probe set or units change so clients rebuild their UI."""
	probe_string = ''.join(p for group in ('P', 'F') for p in current.get(group, {}))
	probe_string += settings['globals']['units']
	return int(hashlib.md5(probe_string.encode()).hexdigest()[:15], 16)


def _current_payload(settings: dict) -> dict:
	current = common.read_current() or {}
	control = common.read_control()
	display = common.read_status()
	try:
		probe_status = common.read_probe_status(settings['probe_settings']['probe_map']['probe_info'])
	except Exception:  # control not running yet
		probe_status = {'P': {}, 'F': {}, 'AUX': {}}
	status_ = {
		'mode': control['mode'], 'display_mode': display.get('mode'), 'status': control.get('status', ''),
		's_plus': control.get('s_plus', False), 'units': settings['globals']['units'], 'name': settings['globals']['grill_name'],
		'start_time': display.get('start_time', 0), 'start_duration': display.get('start_duration', 0),
		'shutdown_duration': display.get('shutdown_duration', 0), 'prime_duration': display.get('prime_duration', 0),
		'prime_amount': display.get('prime_amount', 0), 'lid_open_detected': display.get('lid_open_detected', False),
		'lid_open_endtime': display.get('lid_open_endtime', 0), 'p_mode': display.get('p_mode', 0),
		'outpins': display.get('outpins', {}), 'startup_timestamp': display.get('startup_timestamp', 0),
		'ui_hash': _ui_hash(settings, current), 'probe_status': probe_status,
		'critical_error': control.get('critical_error', False), 'eta_calculation': settings['globals'].get('eta_calculation', True),
	}
	return {'current': current, 'notify_data': control.get('notify_data', []), 'status': status_}


def _verb(action: str, args: list[str | None], principal: auth.Principal) -> JSONResponse:
	if action in ('set', 'sys') and principal.role not in WRITE_ROLES:
		raise HTTPException(status.HTTP_403_FORBIDDEN, detail={'code': 'forbidden', 'message': 'Operator or admin required.'})
	if action == 'cmd' and principal.role != 'admin':
		raise HTTPException(status.HTTP_403_FORBIDDEN, detail={'code': 'forbidden', 'message': 'Admin only.'})
	arglist = (args + [None] * 4)[:4]
	data = common.process_command(action=action, arglist=arglist, origin='api')
	if action == 'sys':
		data = common.get_system_command_output(requested=arglist[0], timeout=8)
	core_state.invalidate_settings_cache()
	return JSONResponse(data, status_code=201)


@router.api_route('/api/{action}', methods=['GET', 'POST'])
@router.api_route('/api/{action}/{arg0}', methods=['GET', 'POST'])
@router.api_route('/api/{action}/{arg0}/{arg1}', methods=['GET', 'POST'])
@router.api_route('/api/{action}/{arg0}/{arg1}/{arg2}', methods=['GET', 'POST'])
@router.api_route('/api/{action}/{arg0}/{arg1}/{arg2}/{arg3}', methods=['GET', 'POST'])
async def legacy_api(request: Request, action: str, arg0: str | None = None, arg1: str | None = None, arg2: str | None = None,
					 arg3: str | None = None, principal: auth.Principal = Depends(current_principal)):
	if action == 'v1':
		raise HTTPException(status.HTTP_404_NOT_FOUND, detail={'code': 'not_found', 'message': 'Unknown /api/v1 route.'})
	if action in ('get', 'set', 'cmd', 'sys'):
		return _verb(action, [arg0, arg1, arg2, arg3], principal)

	settings = common.read_settings()
	if request.method == 'GET':
		if action == 'settings':
			return JSONResponse({'settings': settings_schema.redact(settings)}, status_code=201)
		if action == 'server':
			return JSONResponse({'server_status': 'available'}, status_code=201)
		if action == 'control':
			return JSONResponse({'control': common.read_control()}, status_code=201)
		if action == 'current':
			return JSONResponse(_current_payload(settings), status_code=201)
		if action == 'hopper':
			pelletdb = common.read_pellet_db()
			pellet = pelletdb['archive'].get(pelletdb['current']['pelletid'], {})
			return JSONResponse({'hopper_level': pelletdb['current']['hopper_level'],
								 'hopper_pellets': f"{pellet.get('brand', '')} {pellet.get('wood', '')}".strip()})
		return JSONResponse({'Error': 'Received undefined/unsupported request.'}, status_code=404)

	# POST settings / control: admin only, same body shapes as PiFire
	if principal.role != 'admin':
		raise HTTPException(status.HTTP_403_FORBIDDEN, detail={'code': 'forbidden', 'message': 'Admin only.'})
	try:
		body: Any = await request.json()
	except Exception:
		return JSONResponse({'Error': 'Received POST request without JSON data.'}, status_code=400)
	if not isinstance(body, dict):
		return JSONResponse({'Error': 'Received POST request without JSON data.'}, status_code=400)
	if action == 'settings':
		try:
			settings_schema.apply_patch(body)
			common.write_control({'settings_update': True}, origin='api')
			core_state.invalidate_settings_cache()
			return JSONResponse({'settings': 'success', 'result': 'success', 'message': 'Settings updated successfully.'}, status_code=201)
		except Exception as e:  # noqa: BLE001 - PiFire reports failures in-band
			return JSONResponse({'settings': 'error', 'result': 'error', 'message': f'Settings update failed: {e}'}, status_code=201)
	if action == 'control':
		try:
			common.write_control(body, origin='app')
			return JSONResponse({'control': 'success', 'result': 'success', 'message': 'Settings updated successfully.'}, status_code=201)
		except Exception as e:  # noqa: BLE001
			return JSONResponse({'control': 'error', 'result': 'error', 'message': f'Settings update failed: {e}'}, status_code=201)
	return JSONResponse({'Error': 'Received POST request no valid action.'}, status_code=404)


# ----- API key management (new; lives under /api/v1) ----------------------

keys_router = APIRouter(prefix='/api/v1', tags=['auth'])


@keys_router.get('/auth/api-keys')
def api_keys(_: auth.Principal = Depends(require_admin)):
	return {'keys': auth.list_api_keys()}


@keys_router.post('/auth/api-keys', status_code=status.HTTP_201_CREATED)
def api_key_create(body: dict, _: auth.Principal = Depends(require_admin)):
	try:
		key, record = auth.create_api_key(str(body.get('name', '')), str(body.get('role', 'operator')))
	except ValueError as e:
		raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={'code': 'invalid', 'message': str(e)})
	return {'key': key, **record}


@keys_router.delete('/auth/api-keys/{key_id}')
def api_key_delete(key_id: str, _: auth.Principal = Depends(require_admin)):
	if not auth.delete_api_key(key_id):
		raise HTTPException(status.HTTP_404_NOT_FOUND, detail={'code': 'not_found', 'message': key_id})
	return {'ok': True}
