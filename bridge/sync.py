"""The cloud bridge: mirrors the grill to Firebase and applies cloud commands.

Runs as its own supervisor program next to the control process. Everything
it does is best-effort and idempotent; if it dies, the cook continues.

Responsibilities (each a small method so they can be unit-tested):
  publish_state()        RTDB grills/{id}/state         change-only, <= 1 Hz
  publish_presence()     RTDB grills/{id}/presence      every 15 s (server timestamp)
  mirror_settings()      Firestore settings/current     when settings.json changes (redacted)
  forward_notifications() RTDB grills/{id}/notifications from the Redis stream
  stream_samples()       Firestore cooks/{id}/samples   10 s downsample, chunked, during cooks
  handle_command()       RTDB grills/{id}/commands      SSE listener -> core.commands.execute

Command safety: a command is applied only if (a) local cloud.control_enabled
is on, (b) its createdAt (server time) is within COMMAND_MAX_AGE_S of the
bridge's own clock, (c) its nonce has not been seen, (d) the registry marks
it cloud_allowed. Commands are never queued: if the bridge was offline when
they were created they are rejected as stale.
"""
from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field

import httpx

from bridge.credentials import Credentials
from bridge.firebase_rest import SERVER_TIMESTAMP, AuthSession, FirestoreClient, RtdbClient
from common import common
from core import commands as cmdreg
from core import events
from core import state as core_state
from core.settings_schema import redact

log = logging.getLogger('bridge')

COMMAND_MAX_AGE_S = 30
PRESENCE_INTERVAL_S = 15
STATE_MIN_INTERVAL_S = 1.0
SAMPLE_FLUSH_S = 120
SAMPLES_PER_CHUNK = 360  # 1 h at 10 s
BRIDGE_VERSION = '2.0.0a0'
NONCE_MEMORY = 500


@dataclass
class CookTracker:
	"""Tracks the active cook (from Startup/Prime out of Stop until Stop) and buffers samples."""

	cook_id: str | None = None
	started_at: float = 0.0
	chunk_index: int = 0
	buffer: list[dict] = field(default_factory=list)
	last_sample_at: float = 0.0
	last_flush_at: float = 0.0
	probe_labels: list[str] = field(default_factory=list)


class Bridge:
	def __init__(self, creds: Credentials, *, client: httpx.Client | None = None, clock=time.time, sleep=time.sleep):
		self.creds = creds
		self.client = client or httpx.Client(timeout=30)
		self.clock = clock
		self.sleep = sleep
		self.auth = AuthSession(creds.api_key, self.client, refresh_token=creds.refresh_token, clock=clock)
		self.rtdb = RtdbClient(creds.database_url, self.auth.token, self.client)
		self.fs = FirestoreClient(creds.project_id, self.auth.token, self.client)
		self.grill = creds.grill_id
		self.stop_event = threading.Event()

		self._last_state_hash: str | None = None
		self._last_state_at = 0.0
		self._last_presence_at = 0.0
		self._settings_mtime: float | None = None
		self._notify_cursor = events.latest_id()
		self._seen_nonces: OrderedDict[str, float] = OrderedDict()
		self.cook = CookTracker()
		self.errors: list[str] = []
		self._prev_mode: str | None = None

	# ----- helpers ---------------------------------------------------------
	def path(self, *parts: str) -> str:
		return '/'.join(['grills', self.grill, *parts])

	def settings(self) -> dict:
		return core_state.cached_settings()

	def cloud_settings(self) -> dict:
		return self.settings().get('cloud', common.default_cloud_settings())

	def record_error(self, msg: str) -> None:
		log.warning(msg)
		self.errors.append(f'{int(self.clock())}: {msg}')
		self.errors = self.errors[-50:]
		try:
			self.rtdb.put(self.path('bridge', 'errors'), self.errors)
		except Exception:
			pass

	# ----- publishers ------------------------------------------------------
	def publish_state(self, force: bool = False) -> bool:
		now = self.clock()
		if not force and (now - self._last_state_at) < STATE_MIN_INTERVAL_S:
			return False
		snap = core_state.snapshot()
		self._last_state_at = now
		# Cook tracking samples on a timer, independent of whether the state changed.
		self._track_cook(snap)
		h = core_state.snapshot_hash(snap)
		if not force and h == self._last_state_hash:
			return False
		compact = {k: v for k, v in snap.items() if k not in ('probe_status',)}
		compact['probe_status'] = _compact_probe_status(snap.get('probe_status', {}))
		self.rtdb.put(self.path('state'), compact)
		self._last_state_hash = h
		return True

	def publish_presence(self, force: bool = False) -> bool:
		now = self.clock()
		if not force and (now - self._last_presence_at) < PRESENCE_INTERVAL_S:
			return False
		self.rtdb.patch(self.path('presence'), {'lastSeen': SERVER_TIMESTAMP, 'bridgeVersion': BRIDGE_VERSION,
												'controlEnabled': bool(self.cloud_settings().get('control_enabled'))})
		self._last_presence_at = now
		return True

	def mirror_settings(self, force: bool = False) -> bool:
		import os

		try:
			mtime = os.stat('settings.json').st_mtime
		except OSError:
			return False
		if not force and mtime == self._settings_mtime:
			return False
		settings = common.read_settings()
		doc = redact(settings)
		doc.pop('server', None)  # local auth block never leaves the Pi, even redacted
		self.fs.set(self.path('settings', 'current'), {**doc, 'mirroredAt': int(self.clock() * 1000)})
		self._settings_mtime = mtime
		return True

	def forward_notifications(self) -> int:
		entries = events.read_notifications(self._notify_cursor, count=50)
		for entry_id, fields in entries:
			self.rtdb.push(self.path('notifications'), {
				'event': fields.get('event'), 'title': fields.get('title'), 'body': fields.get('body'),
				'label': fields.get('label'), 'target': fields.get('target'), 'ts': fields.get('ts'),
			})
			self._notify_cursor = entry_id
		return len(entries)

	# ----- cook archival ---------------------------------------------------
	def _track_cook(self, snap: dict) -> None:
		mode = snap.get('mode')
		prev = self._prev_mode
		self._prev_mode = mode
		cooking = mode not in ('Stop', 'Error', 'Monitor', 'Manual', None)
		if cooking and self.cook.cook_id is None:
			self._start_cook(snap)
		elif not cooking and self.cook.cook_id is not None and mode in ('Stop', 'Error'):
			self._end_cook(snap, mode)
		if self.cook.cook_id is not None and cooking:
			self._sample(snap)
		_ = prev

	def _start_cook(self, snap: dict) -> None:
		ts = snap.get('startup', {}).get('timestamp') or self.clock()
		cook_id = f'c_{int(ts)}'
		self.cook = CookTracker(cook_id=cook_id, started_at=ts, last_flush_at=self.clock(),
								probe_labels=[p['label'] for p in snap.get('probes', []) if p.get('type') != 'Aux'])
		self.fs.set(self.path('cooks', cook_id), {
			'startedAt': int(ts * 1000), 'endedAt': None, 'title': '', 'notes': '', 'units': snap.get('units'),
			'probeLabels': self.cook.probe_labels, 'status': 'active', 'grillName': snap.get('name'),
		})

	def _sample(self, snap: dict) -> None:
		now = self.clock()
		interval = float(self.cloud_settings().get('sample_interval_s', 10))
		if now - self.cook.last_sample_at < interval:
			return
		self.cook.last_sample_at = now
		temps = snap.get('temps', {})
		row = {'t': int(snap.get('ts') or now * 1000), 'sp': snap.get('setpoint', 0), 'mode': snap.get('mode'),
			   'p': _first(temps.get('primary', {})), 'f': [temps.get('food', {}).get(lbl) for lbl in self.cook.probe_labels[1:]]}
		self.cook.buffer.append(row)
		if len(self.cook.buffer) >= SAMPLES_PER_CHUNK or (now - self.cook.last_flush_at) >= SAMPLE_FLUSH_S:
			self.flush_samples()

	def flush_samples(self) -> None:
		if not self.cook.cook_id or not self.cook.buffer:
			return
		chunk_id = f'k{self.cook.chunk_index:04d}'
		self.fs.set(self.path('cooks', self.cook.cook_id, 'samples', chunk_id), {
			'index': self.cook.chunk_index, 'from': self.cook.buffer[0]['t'], 'to': self.cook.buffer[-1]['t'],
			'rows': self.cook.buffer,
		})
		# A chunk is closed once full; otherwise keep appending to the same document.
		if len(self.cook.buffer) >= SAMPLES_PER_CHUNK:
			self.cook.chunk_index += 1
			self.cook.buffer = []
		self.cook.last_flush_at = self.clock()

	def _end_cook(self, snap: dict, mode: str) -> None:
		self.flush_samples()
		if self.cook.cook_id:
			self.fs.set(self.path('cooks', self.cook.cook_id), {'endedAt': int(self.clock() * 1000), 'status': 'error' if mode == 'Error' else 'done'}, merge=True)
		self.cook = CookTracker()

	# ----- commands --------------------------------------------------------
	def _remember_nonce(self, nonce: str) -> bool:
		"""True if new, False if already seen."""
		if nonce in self._seen_nonces:
			return False
		self._seen_nonces[nonce] = self.clock()
		while len(self._seen_nonces) > NONCE_MEMORY:
			self._seen_nonces.popitem(last=False)
		return True

	def handle_command(self, cmd_id: str, cmd: dict) -> str:
		"""Validate and apply one command document. Returns the final status written."""
		if not isinstance(cmd, dict) or cmd.get('status') != 'pending':
			return 'ignored'
		now_ms = self.clock() * 1000
		reject = None
		name = cmd.get('name', '')
		created = cmd.get('createdAt')
		if not isinstance(created, int | float):
			reject = 'missing createdAt'
		elif abs(now_ms - created) > COMMAND_MAX_AGE_S * 1000:
			reject = f'stale command ({int((now_ms - created) / 1000)}s old)'
		elif not cmd.get('nonce') or not self._remember_nonce(cmd['nonce']):
			reject = 'replayed nonce'
		elif not self.cloud_settings().get('control_enabled'):
			reject = 'cloud control is disabled on this grill'
		else:
			spec = cmdreg.registry().get(name)
			if spec is None or not spec.cloud_allowed:
				reject = f'command {name} not allowed from the cloud'
		if reject:
			self._set_status(cmd_id, 'rejected', error=reject)
			return 'rejected'
		self._set_status(cmd_id, 'acked')
		result = cmdreg.execute(name, cmd.get('args') or {}, origin=f'cloud:{cmd.get("uid", "?")}')
		if result.result == 'OK':
			self._set_status(cmd_id, 'done', result=result.data)
			self.publish_state(force=True)
			return 'done'
		self._set_status(cmd_id, 'failed', error=result.message)
		return 'failed'

	def _set_status(self, cmd_id: str, status: str, *, error: str | None = None, result: dict | None = None) -> None:
		patch: dict = {'status': status}
		if status == 'acked':
			patch['ackedAt'] = int(self.clock() * 1000)
		if status in ('done', 'failed', 'rejected'):
			patch['doneAt'] = int(self.clock() * 1000)
		if error:
			patch['error'] = error[:500]
		if result is not None:
			patch['result'] = _jsonable(result)
		try:
			self.rtdb.patch(self.path('commands', cmd_id), patch)
		except Exception as e:
			self.record_error(f'command status write failed: {e}')

	def drain_pending_commands(self) -> int:
		"""Apply anything already pending (used at startup and after a stream hiccup)."""
		try:
			pending = self.rtdb.get(self.path('commands')) or {}
		except Exception as e:
			self.record_error(f'reading commands failed: {e}')
			return 0
		n = 0
		for cmd_id, cmd in sorted(pending.items()):
			if isinstance(cmd, dict) and cmd.get('status') == 'pending':
				self.handle_command(cmd_id, cmd)
				n += 1
		return n

	def command_listener(self) -> None:
		"""Blocking SSE loop; runs in its own thread."""
		backoff = 2
		while not self.stop_event.is_set():
			try:
				self.drain_pending_commands()
				for event, data in self.rtdb.stream(self.path('commands'), self.stop_event):
					if event == 'auth_revoked':
						break
					if event not in ('put', 'patch') or not data:
						continue
					path = (data.get('path') or '/').strip('/')
					payload = data.get('data')
					if path == '':
						for cmd_id, cmd in (payload or {}).items():
							self.handle_command(cmd_id, cmd)
					elif '/' not in path:
						if event == 'put' and isinstance(payload, dict):
							self.handle_command(path, payload)
						elif event == 'patch' and isinstance(payload, dict) and payload.get('status') == 'pending':
							# partial update to a command; re-read it
							cmd = self.rtdb.get(self.path('commands', path))
							self.handle_command(path, cmd)
				backoff = 2
			except Exception as e:
				if self.stop_event.is_set():
					break
				self.record_error(f'command stream error: {e}')
				self.stop_event.wait(backoff)
				backoff = min(backoff * 2, 60)

	# ----- main loop -------------------------------------------------------
	def tick(self) -> None:
		if not self.cloud_settings().get('monitor_enabled', True):
			return
		self.publish_state()
		self.publish_presence()
		self.mirror_settings()
		self.forward_notifications()

	def run(self) -> None:
		self.auth.refresh()
		listener = threading.Thread(target=self.command_listener, name='bridge-commands', daemon=True)
		listener.start()
		self.publish_state(force=True)
		self.publish_presence(force=True)
		self.mirror_settings(force=True)
		while not self.stop_event.is_set():
			try:
				self.tick()
			except Exception as e:
				self.record_error(f'tick failed: {e}')
				self.stop_event.wait(5)
			self.stop_event.wait(0.5)
		self.flush_samples()


def _first(d: dict):
	for v in d.values():
		return v
	return None


def _compact_probe_status(ps: dict) -> dict:
	out = {}
	for group, probes in (ps or {}).items():
		out[group] = {}
		for label, info in (probes or {}).items():
			st = (info or {}).get('status') or {}
			out[group][label] = {k: st.get(k) for k in ('connected', 'battery_percentage', 'battery_charging', 'error') if k in st}
	return out


def _jsonable(d):
	import json

	try:
		json.dumps(d)
		return d
	except TypeError:
		return json.loads(json.dumps(d, default=str))
