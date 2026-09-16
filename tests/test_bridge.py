"""Cloud bridge: auth exchange, RTDB/Firestore REST, pairing, sync loop and command safety.

A tiny in-memory fake of the Firebase REST surfaces is wired through
httpx.MockTransport, so nothing touches the network.
"""
import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from bridge import firebase_rest as fr
from bridge.credentials import Credentials
from bridge.pairing import Pairing
from bridge.sync import COMMAND_MAX_AGE_S, Bridge
from common import common
from core import events


class FakeFirebase:
	"""Records RTDB/Firestore writes and serves canned auth/pairing responses."""

	def __init__(self):
		self.rtdb: dict[str, object] = {}
		self.fs: dict[str, dict] = {}
		self.requests: list[tuple[str, str]] = []
		self.pairing_state = 'pending'
		self.token_calls = 0
		self.push_counter = 0

	def transport(self) -> httpx.MockTransport:
		return httpx.MockTransport(self.handle)

	def handle(self, req: httpx.Request) -> httpx.Response:
		url = urlparse(str(req.url))
		self.requests.append((req.method, url.path))
		body = req.content.decode() if req.content else ''
		# --- auth
		if url.path.endswith('accounts:signInWithCustomToken'):
			self.token_calls += 1
			return httpx.Response(200, json={'idToken': _jwt({'user_id': 'grill_g1'}), 'refreshToken': 'rt-1', 'expiresIn': '3600'})
		if url.path.endswith('/v1/token'):
			self.token_calls += 1
			return httpx.Response(200, json={'id_token': _jwt({'user_id': 'grill_g1'}), 'refresh_token': 'rt-2', 'expires_in': '3600'})
		# --- pairing functions
		if url.path.endswith('/requestPairing'):
			return httpx.Response(200, json={'ok': True, 'expiresAt': (time.time() + 600) * 1000})
		if url.path.endswith('/claimPairing'):
			if self.pairing_state == 'pending':
				return httpx.Response(202, json={'status': 'pending'})
			return httpx.Response(200, json={'grillId': 'g1', 'customToken': 'ct', 'projectId': 'p', 'apiKey': 'k', 'databaseURL': 'https://db.example'})
		# --- RTDB
		if url.netloc == 'db.example':
			path = url.path[:-5].strip('/')  # drop .json
			assert parse_qs(url.query).get('auth'), 'RTDB call without auth token'
			if req.method == 'GET':
				return httpx.Response(200, json=self._rtdb_get(path))
			data = json.loads(body) if body else None
			if req.method == 'PUT':
				self.rtdb[path] = data
			elif req.method == 'PATCH':
				cur = self.rtdb.get(path)
				if not isinstance(cur, dict):
					cur = {}
				cur.update(data)
				self.rtdb[path] = cur
			elif req.method == 'POST':
				self.push_counter += 1
				key = f'-push{self.push_counter}'
				self.rtdb[f'{path}/{key}'] = data
				return httpx.Response(200, json={'name': key})
			elif req.method == 'DELETE':
				self.rtdb.pop(path, None)
			return httpx.Response(200, json=data)
		# --- Firestore
		if url.netloc == 'firestore.googleapis.com':
			assert req.headers.get('Authorization', '').startswith('Bearer ')
			path = url.path.split('/documents/', 1)[1]
			if req.method == 'PATCH':
				fields = json.loads(body)['fields']
				decoded = {k: fr.from_value(v) for k, v in fields.items()}
				mask = parse_qs(url.query).get('updateMask.fieldPaths')
				if mask:
					self.fs.setdefault(path, {}).update({k: v for k, v in decoded.items() if k in mask})
				else:
					self.fs[path] = decoded
				return httpx.Response(200, json={'name': path, 'fields': fields})
			if req.method == 'GET':
				if path not in self.fs:
					return httpx.Response(404, json={})
				return httpx.Response(200, json={'fields': {k: fr.to_value(v) for k, v in self.fs[path].items()}})
			if req.method == 'DELETE':
				self.fs.pop(path, None)
				return httpx.Response(200, json={})
		return httpx.Response(404, text=f'unhandled {req.method} {url.path}')

	def _rtdb_get(self, path):
		if path in self.rtdb:
			return self.rtdb[path]
		# assemble children
		prefix = path + '/'
		out = {}
		for k, v in self.rtdb.items():
			if k.startswith(prefix):
				rest = k[len(prefix):]
				if '/' not in rest:
					out[rest] = v
		return out or None


def _jwt(payload: dict) -> str:
	import base64

	def enc(d):
		return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')

	return f'{enc({"alg": "none"})}.{enc(payload)}.sig'


@pytest.fixture
def fb():
	return FakeFirebase()


@pytest.fixture
def creds():
	return Credentials(grill_id='g1', project_id='p', api_key='k', database_url='https://db.example', refresh_token='rt-0')


@pytest.fixture
def bridge(fb, creds, sim_settings, control, clock):
	common.read_current(zero_out=True)
	common.read_status(init=True)
	b = Bridge(creds, client=httpx.Client(transport=fb.transport()), clock=clock.time, sleep=clock.sleep)
	b.auth.refresh()
	return b


# --------------------------------------------------------------------------
# REST clients
# --------------------------------------------------------------------------


class TestAuthSession:
	def test_custom_token_exchange_and_refresh_before_expiry(self, fb, clock):
		s = fr.AuthSession('k', httpx.Client(transport=fb.transport()), clock=clock.time)
		s.sign_in_with_custom_token('ct')
		assert s.uid == 'grill_g1' and s.refresh_token == 'rt-1'
		assert s.token() and fb.token_calls == 1
		clock.advance(3600 - 200)  # inside the 5-minute refresh window
		s.token()
		assert fb.token_calls == 2 and s.refresh_token == 'rt-2'

	def test_refresh_without_token_raises(self, fb):
		s = fr.AuthSession('k', httpx.Client(transport=fb.transport()))
		with pytest.raises(fr.AuthError):
			s.token()


class TestValueEncoding:
	@pytest.mark.parametrize('value', [None, True, 3, 2.5, 'x', [1, 'a', None], {'a': {'b': [1, {'c': False}]}}])
	def test_roundtrip(self, value):
		assert fr.from_value(fr.to_value(value)) == value


# --------------------------------------------------------------------------
# Pairing
# --------------------------------------------------------------------------


class TestPairing:
	def test_start_then_poll_until_paired(self, fb, tmp_path):
		p = Pairing('https://fn.example', client=httpx.Client(transport=fb.transport()), credentials_path=tmp_path / 'creds.json')
		st = p.start()
		assert st.status == 'pending' and len(st.code) == 6 and st.code.isdigit()
		assert p.poll().status == 'pending'
		fb.pairing_state = 'claimed'
		st = p.poll()
		assert st.status == 'paired' and st.grill_id == 'g1'
		saved = Credentials.load(tmp_path / 'creds.json')
		assert saved and saved.grill_id == 'g1' and saved.refresh_token == 'rt-1' and saved.api_key == 'k'

	def test_expired(self, fb, tmp_path, clock):
		p = Pairing('https://fn.example', client=httpx.Client(transport=fb.transport()), credentials_path=tmp_path / 'c.json')
		p.start()
		clock.advance(700)
		assert p.poll().status == 'expired'

	def test_credentials_roundtrip(self, tmp_path, creds):
		creds.save(tmp_path / 'c.json')
		assert Credentials.load(tmp_path / 'c.json') == creds
		Credentials.delete(tmp_path / 'c.json')
		assert Credentials.load(tmp_path / 'c.json') is None


# --------------------------------------------------------------------------
# Sync
# --------------------------------------------------------------------------


class TestPublish:
	def test_state_is_published_once_per_change(self, bridge, fb, clock):
		assert bridge.publish_state(force=True)
		assert fb.rtdb['grills/g1/state']['mode'] == 'Stop'
		clock.advance(2)
		assert bridge.publish_state() is False  # unchanged
		common.write_control({'mode': 'Smoke'}, origin='t')
		common.execute_control_writes()
		clock.advance(2)
		assert bridge.publish_state() is True
		assert fb.rtdb['grills/g1/state']['mode'] == 'Smoke'

	def test_state_is_rate_limited(self, bridge, fb, clock):
		bridge.publish_state(force=True)
		common.write_control({'mode': 'Smoke'}, origin='t')
		common.execute_control_writes()
		clock.advance(0.2)
		assert bridge.publish_state() is False

	def test_presence_uses_server_timestamp(self, bridge, fb, clock):
		assert bridge.publish_presence(force=True)
		assert fb.rtdb['grills/g1/presence']['lastSeen'] == {'.sv': 'timestamp'}
		assert bridge.publish_presence() is False
		clock.advance(16)
		assert bridge.publish_presence() is True

	def test_settings_mirror_is_redacted_and_change_driven(self, bridge, fb):
		s = common.read_settings()
		s['notify_services']['pushover']['APIKey'] = 'sekrit'
		common.write_settings(s)
		assert bridge.mirror_settings(force=True)
		doc = fb.fs['grills/g1/settings/current']
		assert doc['notify_services']['pushover']['APIKey'] == '***'
		assert 'server' not in doc
		assert doc['cloud']['control_enabled'] is False
		assert bridge.mirror_settings() is False

	def test_notifications_are_forwarded_once(self, bridge, fb):
		events.publish_notification('Timer_Expired', 'Timer Complete', 'check')
		assert bridge.forward_notifications() == 1
		assert bridge.forward_notifications() == 0
		pushed = [v for k, v in fb.rtdb.items() if k.startswith('grills/g1/notifications/')]
		assert pushed[0]['title'] == 'Timer Complete'


class TestCookArchival:
	def test_cook_lifecycle_streams_samples(self, bridge, fb, clock):
		bridge.publish_state(force=True)
		common.write_control({'mode': 'Startup', 'startup_timestamp': clock.time()}, origin='t')
		common.execute_control_writes()
		clock.advance(2)
		bridge.publish_state()
		cook_docs = [k for k in fb.fs if k.startswith('grills/g1/cooks/') and '/samples/' not in k]
		assert len(cook_docs) == 1
		cook_id = cook_docs[0].split('/')[-1]
		assert fb.fs[cook_docs[0]]['status'] == 'active'
		# samples every 10 s, flushed every 120 s
		for _ in range(14):
			clock.advance(10)
			common.write_current({'probe_history': {'primary': {'Grill': 200}, 'food': {'Probe1': 100, 'Probe2': 90}, 'aux': {}, 'tr': {}}, 'primary_setpoint': 225, 'notify_targets': {}})
			bridge.publish_state()
		chunks = [k for k in fb.fs if f'/cooks/{cook_id}/samples/' in k]
		assert chunks, 'expected a flushed sample chunk'
		rows = fb.fs[chunks[0]]['rows']
		assert rows[-1]['p'] == 200 and rows[-1]['f'] == [100, 90] and rows[-1]['sp'] == 0
		# stop -> cook finalised
		common.write_control({'mode': 'Stop'}, origin='t')
		common.execute_control_writes()
		clock.advance(2)
		bridge.publish_state()
		assert fb.fs[cook_docs[0]]['status'] == 'done' and fb.fs[cook_docs[0]]['endedAt'] > 0
		assert bridge.cook.cook_id is None


class TestCommands:
	def _cmd(self, clock, **over):
		base = {'name': 'mode.hold', 'args': {'setpoint': 250}, 'uid': 'u1', 'createdAt': int(clock.time() * 1000), 'nonce': 'n1', 'status': 'pending'}
		base.update(over)
		return base

	def _enable(self):
		s = common.read_settings()
		s['cloud']['control_enabled'] = True
		common.write_settings(s)
		from core import state

		state.invalidate_settings_cache()

	def test_rejected_when_cloud_control_disabled(self, bridge, fb, clock):
		assert bridge.handle_command('c1', self._cmd(clock)) == 'rejected'
		assert 'disabled' in fb.rtdb['grills/g1/commands/c1']['error']
		assert common.read_control()['mode'] == 'Stop'

	def test_applied_when_enabled(self, bridge, fb, clock, redis_client):
		self._enable()
		assert bridge.handle_command('c1', self._cmd(clock)) == 'done'
		st = fb.rtdb['grills/g1/commands/c1']
		assert st['status'] == 'done' and st['ackedAt'] and st['doneAt']
		common.execute_control_writes()
		c = common.read_control()
		assert c['mode'] == 'Hold' and c['primary_setpoint'] == 250

	def test_stale_command_rejected(self, bridge, fb, clock):
		self._enable()
		old = self._cmd(clock, createdAt=int((clock.time() - COMMAND_MAX_AGE_S - 5) * 1000))
		assert bridge.handle_command('c1', old) == 'rejected'
		assert 'stale' in fb.rtdb['grills/g1/commands/c1']['error']

	def test_future_command_rejected(self, bridge, fb, clock):
		self._enable()
		future = self._cmd(clock, createdAt=int((clock.time() + 120) * 1000))
		assert bridge.handle_command('c1', future) == 'rejected'

	def test_replayed_nonce_rejected(self, bridge, fb, clock):
		self._enable()
		assert bridge.handle_command('c1', self._cmd(clock)) == 'done'
		assert bridge.handle_command('c2', self._cmd(clock, nonce='n1')) == 'rejected'
		assert 'replay' in fb.rtdb['grills/g1/commands/c2']['error']

	def test_local_only_command_rejected(self, bridge, fb, clock):
		self._enable()
		assert bridge.handle_command('c1', self._cmd(clock, name='system.reboot', args={})) == 'rejected'

	def test_invalid_args_fail(self, bridge, fb, clock):
		self._enable()
		assert bridge.handle_command('c1', self._cmd(clock, args={'setpoint': 'hot'})) == 'failed'
		assert fb.rtdb['grills/g1/commands/c1']['status'] == 'failed'

	def test_non_pending_ignored(self, bridge, clock):
		assert bridge.handle_command('c1', self._cmd(clock, status='done')) == 'ignored'

	def test_drain_pending_at_startup(self, bridge, fb, clock):
		self._enable()
		fb.rtdb['grills/g1/commands/a'] = self._cmd(clock, nonce='a')
		fb.rtdb['grills/g1/commands/b'] = self._cmd(clock, nonce='b', status='done')
		assert bridge.drain_pending_commands() == 1
		assert fb.rtdb['grills/g1/commands/a']['status'] == 'done'


def test_tick_respects_monitor_disabled(bridge, fb):
	s = common.read_settings()
	s['cloud']['monitor_enabled'] = False
	common.write_settings(s)
	from core import state

	state.invalidate_settings_cache()
	bridge.tick()
	assert 'grills/g1/state' not in fb.rtdb
