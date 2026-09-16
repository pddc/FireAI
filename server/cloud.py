"""Cloud pairing endpoints for the local API.

The server (not the bridge) runs the pairing handshake because it is the
process the wizard talks to. Once credentials are written the bridge process
picks them up on its next check.
"""
from __future__ import annotations

import threading
import time

from fastapi import APIRouter, Depends, HTTPException, status

from bridge.credentials import DEFAULT_PATH, Credentials
from bridge.pairing import DEFAULT_FUNCTIONS_URL, Pairing
from common import common
from core import state as core_state
from server import auth
from server.deps import current_principal, require_admin

router = APIRouter(prefix='/api/v1/cloud', tags=['cloud'])

_lock = threading.Lock()
_pairing: Pairing | None = None
_poller: threading.Thread | None = None


def _grill_info() -> dict:
	s = common.read_settings()
	return {'name': s['globals'].get('grill_name') or 'FireAI grill', 'board': s.get('platform', {}).get('board', ''),
			'version': s['versions']['server']}


def _functions_url() -> str:
	s = common.read_settings()
	return s.get('cloud', {}).get('functions_url') or DEFAULT_FUNCTIONS_URL


def _poll_loop(p: Pairing):
	while True:
		st = p.poll()
		if st.status != 'pending':
			core_state.invalidate_settings_cache()
			return
		time.sleep(3)


def pairing_status() -> dict | None:
	p = _pairing
	if p is None or p.state is None:
		return None
	st = p.state
	return {'status': st.status, 'code': st.code if st.status == 'pending' else None, 'expires_at': st.expires_at, 'error': st.error, 'grill_id': st.grill_id}


@router.get('/status')
def cloud_status(_: auth.Principal = Depends(current_principal)):
	creds = Credentials.load(DEFAULT_PATH)
	cloud = common.read_settings().get('cloud', common.default_cloud_settings())
	return {
		'paired': creds is not None,
		'grill_id': creds.grill_id if creds else None,
		'project_id': creds.project_id if creds else None,
		'paired_at': creds.paired_at if creds else None,
		'enabled': cloud.get('enabled', True),
		'control_enabled': cloud.get('control_enabled', False),
		'monitor_enabled': cloud.get('monitor_enabled', True),
		'pairing': pairing_status(),
	}


@router.post('/pair', status_code=status.HTTP_202_ACCEPTED)
def start_pairing(_: auth.Principal = Depends(require_admin)):
	global _pairing, _poller
	if Credentials.load(DEFAULT_PATH) is not None:
		raise HTTPException(status.HTTP_409_CONFLICT, detail={'code': 'already_paired', 'message': 'Unpair first.'})
	with _lock:
		if _pairing and _pairing.state and _pairing.state.status == 'pending' and time.time() < _pairing.state.expires_at:
			return pairing_status()
		p = Pairing(_functions_url(), grill_info=_grill_info(), credentials_path=DEFAULT_PATH)
		st = p.start()
		_pairing = p
		if st.status == 'pending':
			_poller = threading.Thread(target=_poll_loop, args=(p,), daemon=True)
			_poller.start()
	if st.status == 'error':
		raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail={'code': 'pairing_failed', 'message': st.error or 'Could not reach the cloud.'})
	return pairing_status()


@router.delete('/pair')
def cancel_pairing(_: auth.Principal = Depends(require_admin)):
	global _pairing
	with _lock:
		if _pairing and _pairing.state:
			_pairing.state.status = 'expired'
		_pairing = None
	return {'ok': True}


@router.post('/unpair')
def unpair(_: auth.Principal = Depends(require_admin)):
	Credentials.delete(DEFAULT_PATH)
	core_state.invalidate_settings_cache()
	return {'ok': True}
