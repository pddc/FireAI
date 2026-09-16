"""FireAI local API (FastAPI).

Routes (all under /api/v1 unless noted):

  GET  /health                       liveness (no auth)
  GET  /auth/status                  {setup_required, auth_disabled}
  POST /auth/setup                   set the admin password once
  POST /auth/login                   -> {token}
  GET  /auth/me
  GET  /state                        dashboard snapshot (core.state.snapshot)
  WS   /ws/state?token=...           same snapshot pushed on change, <= 1 Hz (mounted at /ws/state)
  GET  /commands                     command catalogue with JSON schemas
  POST /commands/{name}              execute a command
  GET  /settings                     redacted settings
  PATCH /settings                    deep-merge (secrets: "***" keeps existing)
  GET  /history?limit=N              recent history rows
  GET  /events?limit=N               recent event log lines
  GET  /pellets                      pellet database
  GET  /probes/devices               probe device info incl. live status

Run with ``uvicorn server.app:app`` or ``scripts/simulate.py --with-server``.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import time
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from common import common
from core import commands as cmdreg
from core import state as core_state
from core.settings_schema import redact
from server import auth, cloud, probes
from server.deps import current_principal, require_admin

API_PREFIX = '/api/v1'


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------


class SetupRequest(BaseModel):
	password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
	password: str


class TokenResponse(BaseModel):
	token: str
	role: str


class CommandRequest(BaseModel):
	args: dict[str, Any] = Field(default_factory=dict)


class SettingsPatch(BaseModel):
	patch: dict[str, Any]


# --------------------------------------------------------------------------
# WebSocket hub
# --------------------------------------------------------------------------


class StateHub:
	"""Polls Redis at ~2 Hz and pushes a snapshot to every socket when it changes (max 1/s)."""

	def __init__(self, poll_s: float = 0.5, min_interval_s: float = 1.0):
		self.poll_s = poll_s
		self.min_interval_s = min_interval_s
		self.clients: set[WebSocket] = set()
		self._task: asyncio.Task | None = None
		self._last_hash = None
		self._last_sent = 0.0

	async def start(self):
		if self._task is None:
			self._task = asyncio.create_task(self._loop())

	async def stop(self):
		if self._task:
			self._task.cancel()
			with contextlib.suppress(asyncio.CancelledError):
				await self._task
			self._task = None

	async def _loop(self):
		while True:
			try:
				if self.clients:
					snap = await asyncio.to_thread(core_state.snapshot)
					h = core_state.snapshot_hash(snap)
					now = time.monotonic()
					if h != self._last_hash and (now - self._last_sent) >= self.min_interval_s:
						self._last_hash = h
						self._last_sent = now
						await self.broadcast({'type': 'state', 'data': snap})
			except Exception as e:  # keep the hub alive whatever Redis does
				await self.broadcast({'type': 'error', 'message': str(e)})
			await asyncio.sleep(self.poll_s)

	async def broadcast(self, message: dict):
		payload = json.dumps(message, default=str)
		dead = []
		for ws in list(self.clients):
			try:
				await ws.send_text(payload)
			except Exception:
				dead.append(ws)
		for ws in dead:
			self.clients.discard(ws)

	async def add(self, ws: WebSocket):
		self.clients.add(ws)
		snap = await asyncio.to_thread(core_state.snapshot)
		await ws.send_text(json.dumps({'type': 'state', 'data': snap}, default=str))

	def remove(self, ws: WebSocket):
		self.clients.discard(ws)


# --------------------------------------------------------------------------
# App factory
# --------------------------------------------------------------------------


def create_app(*, hub: StateHub | None = None) -> FastAPI:
	hub = hub or StateHub()

	@contextlib.asynccontextmanager
	async def lifespan(app: FastAPI):
		await hub.start()
		try:
			yield
		finally:
			await hub.stop()

	app = FastAPI(title='FireAI Local API', version='2.0.0a0', lifespan=lifespan, docs_url='/docs', openapi_url='/openapi.json')
	app.state.hub = hub
	app.include_router(cloud.router)
	app.include_router(probes.router)
	app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173'],
					   allow_methods=['*'], allow_headers=['*'])

	# ----- health / auth ---------------------------------------------------
	@app.get('/health', tags=['system'])
	def health():
		try:
			mode = common.read_control().get('mode')
			redis_ok = True
		except Exception:
			mode, redis_ok = None, False
		return {'ok': redis_ok, 'mode': mode, 'version': core_state.cached_settings()['versions']['server']}

	@app.get(f'{API_PREFIX}/auth/status', tags=['auth'])
	def auth_status():
		return {'setup_required': not auth.auth_disabled() and not auth.password_is_set(), 'auth_disabled': auth.auth_disabled()}

	@app.post(f'{API_PREFIX}/auth/setup', response_model=TokenResponse, tags=['auth'])
	def auth_setup(body: SetupRequest):
		if auth.password_is_set():
			raise HTTPException(status.HTTP_409_CONFLICT, detail={'code': 'already_setup', 'message': 'Password already set.'})
		auth.set_password(body.password)
		return TokenResponse(token=auth.issue_token(), role='admin')

	@app.post(f'{API_PREFIX}/auth/login', response_model=TokenResponse, tags=['auth'])
	def auth_login(body: LoginRequest):
		if not auth.password_is_set():
			raise HTTPException(status.HTTP_403_FORBIDDEN, detail={'code': 'setup_required', 'message': 'Set the admin password first.'})
		if not auth.verify_password(body.password):
			raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={'code': 'bad_credentials', 'message': 'Wrong password.'})
		return TokenResponse(token=auth.issue_token(), role='admin')

	@app.post(f'{API_PREFIX}/auth/password', tags=['auth'])
	def auth_change_password(body: SetupRequest, _: auth.Principal = Depends(require_admin)):
		auth.set_password(body.password, replace=True)
		return {'ok': True}

	@app.get(f'{API_PREFIX}/auth/me', tags=['auth'])
	def auth_me(p: auth.Principal = Depends(current_principal)):
		return {'uid': p.uid, 'role': p.role, 'via': p.via}

	# ----- state -----------------------------------------------------------
	@app.get(f'{API_PREFIX}/state', tags=['state'])
	def get_state(_: auth.Principal = Depends(current_principal)):
		return core_state.snapshot()

	@app.websocket('/ws/state')
	async def ws_state(ws: WebSocket, token: str | None = Query(default=None)):
		principal = auth.authenticate(token)
		if principal is None or (not auth.auth_disabled() and not auth.password_is_set()):
			await ws.close(code=4401)
			return
		await ws.accept()
		await hub.add(ws)
		try:
			while True:
				# Clients may send {"type":"ping"}; anything else is ignored.
				msg = await ws.receive_text()
				if msg == 'ping' or '"ping"' in msg:
					await ws.send_text('{"type":"pong"}')
		except WebSocketDisconnect:
			pass
		finally:
			hub.remove(ws)

	# ----- commands --------------------------------------------------------
	@app.get(f'{API_PREFIX}/commands', tags=['commands'])
	def list_commands(_: auth.Principal = Depends(current_principal)):
		return cmdreg.describe()

	@app.post(f'{API_PREFIX}/commands/{{name}}', response_model=cmdreg.CommandResult, tags=['commands'])
	def run_command(name: str, body: CommandRequest | None = None, p: auth.Principal = Depends(current_principal)):
		cmd = cmdreg.registry().get(name)
		if cmd is None:
			raise HTTPException(status.HTTP_404_NOT_FOUND, detail={'code': 'unknown_command', 'message': name})
		if cmd.role == 'admin' and p.role != 'admin':
			raise HTTPException(status.HTTP_403_FORBIDDEN, detail={'code': 'forbidden', 'message': 'Admin only.'})
		result = cmdreg.execute(name, (body.args if body else {}), origin=f'api:{p.uid}')
		if result.result == 'ERROR':
			raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={'code': result.data.get('code', 'rejected'), 'message': result.message, 'data': result.data})
		core_state.invalidate_settings_cache()
		return result

	# ----- settings --------------------------------------------------------
	@app.get(f'{API_PREFIX}/settings', tags=['settings'])
	def get_settings(_: auth.Principal = Depends(current_principal)):
		return redact(common.read_settings())

	@app.get(f'{API_PREFIX}/settings/schema', tags=['settings'])
	def get_settings_schema(_: auth.Principal = Depends(current_principal)):
		from core.settings_ui import build_schema

		return build_schema(common.read_settings(), local=True)

	@app.patch(f'{API_PREFIX}/settings', tags=['settings'])
	def patch_settings(body: SettingsPatch, _: auth.Principal = Depends(require_admin)):
		result = cmdreg.execute('settings.patch', {'patch': body.patch}, origin='api')
		if result.result == 'ERROR':
			raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={'code': 'rejected', 'message': result.message})
		core_state.invalidate_settings_cache()
		return {'changed': result.data.get('changed', []), 'settings': redact(common.read_settings())}

	# ----- history / events / pellets / probes -----------------------------
	@app.get(f'{API_PREFIX}/history', tags=['history'])
	def get_history(limit: int = Query(default=0, ge=0, le=28800), _: auth.Principal = Depends(current_principal)):
		rows = common.read_history(num_items=limit)
		return {'rows': rows, 'count': len(rows)}

	@app.get(f'{API_PREFIX}/events', tags=['history'])
	def get_events(limit: int = Query(default=100, ge=1, le=2000), _: auth.Principal = Depends(current_principal)):
		events = common.read_events(legacy=False)
		events = events[-limit:]
		return {'events': [{'date': e[0], 'time': e[1], 'message': e[2].strip() if len(e) > 2 else ''} for e in events]}

	@app.get(f'{API_PREFIX}/pellets', tags=['pellets'])
	def get_pellets(_: auth.Principal = Depends(current_principal)):
		return common.read_pellet_db()

	@app.get(f'{API_PREFIX}/probes/devices', tags=['probes'])
	def get_probe_devices(_: auth.Principal = Depends(current_principal)):
		try:
			info = common.read_generic_key('probe_device_info') or []
		except Exception:
			info = []
		return {'devices': redact({'d': info})['d']}

	return app


app = create_app()
