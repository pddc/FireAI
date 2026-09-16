"""Minimal Firebase REST clients for the bridge.

The bridge is an ordinary Firebase *user* (a custom-token identity with
``bridge`` + ``grill`` claims), never a service account, so it uses the same
REST surfaces a browser would:

* Identity Toolkit  - custom token -> ID token, refresh
* Realtime Database - JSON REST + SSE streaming
* Firestore         - REST v1 documents API (with a small value encoder)

All network calls go through an ``httpx.Client`` that tests replace with a
``MockTransport``.
"""
from __future__ import annotations

import json
import threading
import time
from collections.abc import Callable, Iterator
from typing import Any

import httpx

IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1'
SECURE_TOKEN = 'https://securetoken.googleapis.com/v1'
FIRESTORE = 'https://firestore.googleapis.com/v1'


class AuthError(Exception):
	pass


class AuthSession:
	"""Holds an ID token and refreshes it before expiry."""

	def __init__(self, api_key: str, client: httpx.Client, *, refresh_token: str | None = None, clock: Callable[[], float] = time.time):
		self.api_key = api_key
		self.client = client
		self.refresh_token = refresh_token
		self.id_token: str | None = None
		self.uid: str | None = None
		self.expires_at = 0.0
		self._clock = clock
		self._lock = threading.Lock()

	def sign_in_with_custom_token(self, custom_token: str) -> dict:
		r = self.client.post(f'{IDENTITY_TOOLKIT}/accounts:signInWithCustomToken', params={'key': self.api_key},
							 json={'token': custom_token, 'returnSecureToken': True}, timeout=20)
		if r.status_code != 200:
			raise AuthError(f'custom token sign-in failed: {r.status_code} {r.text[:200]}')
		data = r.json()
		self._apply(data['idToken'], data['refreshToken'], int(data.get('expiresIn', 3600)))
		return data

	def refresh(self) -> None:
		if not self.refresh_token:
			raise AuthError('no refresh token')
		r = self.client.post(f'{SECURE_TOKEN}/token', params={'key': self.api_key},
							 data={'grant_type': 'refresh_token', 'refresh_token': self.refresh_token}, timeout=20)
		if r.status_code != 200:
			raise AuthError(f'token refresh failed: {r.status_code} {r.text[:200]}')
		data = r.json()
		self._apply(data['id_token'], data.get('refresh_token', self.refresh_token), int(data.get('expires_in', 3600)))

	def _apply(self, id_token: str, refresh_token: str, expires_in: int) -> None:
		with self._lock:
			self.id_token = id_token
			self.refresh_token = refresh_token
			self.expires_at = self._clock() + expires_in
			try:
				payload = json.loads(_b64url_decode(id_token.split('.')[1]))
				self.uid = payload.get('user_id') or payload.get('sub')
			except Exception:
				self.uid = None

	def token(self) -> str:
		"""Valid ID token, refreshing when less than 5 minutes remain."""
		if self.id_token is None or self._clock() > self.expires_at - 300:
			self.refresh()
		assert self.id_token
		return self.id_token


def _b64url_decode(s: str) -> bytes:
	import base64

	s += '=' * (-len(s) % 4)
	return base64.urlsafe_b64decode(s)


# --------------------------------------------------------------------------
# Realtime Database
# --------------------------------------------------------------------------


class RtdbClient:
	def __init__(self, database_url: str, token_provider: Callable[[], str], client: httpx.Client):
		self.base = database_url.rstrip('/')
		self.token_provider = token_provider
		self.client = client

	def _url(self, path: str) -> str:
		return f'{self.base}/{path.strip("/")}.json'

	def _params(self, **extra) -> dict:
		return {'auth': self.token_provider(), **extra}

	def get(self, path: str) -> Any:
		r = self.client.get(self._url(path), params=self._params(), timeout=20)
		r.raise_for_status()
		return r.json()

	def put(self, path: str, data: Any) -> None:
		r = self.client.put(self._url(path), params=self._params(), content=json.dumps(data), timeout=20)
		r.raise_for_status()

	def patch(self, path: str, data: dict) -> None:
		r = self.client.patch(self._url(path), params=self._params(), content=json.dumps(data), timeout=20)
		r.raise_for_status()

	def push(self, path: str, data: Any) -> str:
		r = self.client.post(self._url(path), params=self._params(), content=json.dumps(data), timeout=20)
		r.raise_for_status()
		return r.json()['name']

	def delete(self, path: str) -> None:
		r = self.client.delete(self._url(path), params=self._params(), timeout=20)
		r.raise_for_status()

	def stream(self, path: str, stop: threading.Event) -> Iterator[tuple[str, Any]]:
		"""Yield (event, data) from an SSE stream: 'put'/'patch' with {path, data}, 'keep-alive', 'auth_revoked'."""
		headers = {'Accept': 'text/event-stream'}
		with self.client.stream('GET', self._url(path), params=self._params(), headers=headers, timeout=httpx.Timeout(60, read=90)) as r:
			r.raise_for_status()
			event = None
			for line in r.iter_lines():
				if stop.is_set():
					return
				if line.startswith('event:'):
					event = line[6:].strip()
				elif line.startswith('data:'):
					raw = line[5:].strip()
					data = json.loads(raw) if raw and raw != 'null' else None
					yield (event or 'message', data)
					event = None
				elif line == '':
					event = None


SERVER_TIMESTAMP = {'.sv': 'timestamp'}


# --------------------------------------------------------------------------
# Firestore (REST v1)
# --------------------------------------------------------------------------


def to_value(v: Any) -> dict:
	"""Encode a JSON-ish Python value as a Firestore Value."""
	if v is None:
		return {'nullValue': None}
	if isinstance(v, bool):
		return {'booleanValue': v}
	if isinstance(v, int):
		return {'integerValue': str(v)}
	if isinstance(v, float):
		return {'doubleValue': v}
	if isinstance(v, str):
		return {'stringValue': v}
	if isinstance(v, list | tuple):
		return {'arrayValue': {'values': [to_value(x) for x in v]}}
	if isinstance(v, dict):
		return {'mapValue': {'fields': {str(k): to_value(x) for k, x in v.items()}}}
	return {'stringValue': str(v)}


def from_value(v: dict) -> Any:
	if 'nullValue' in v:
		return None
	if 'booleanValue' in v:
		return v['booleanValue']
	if 'integerValue' in v:
		return int(v['integerValue'])
	if 'doubleValue' in v:
		return v['doubleValue']
	if 'stringValue' in v:
		return v['stringValue']
	if 'timestampValue' in v:
		return v['timestampValue']
	if 'arrayValue' in v:
		return [from_value(x) for x in v['arrayValue'].get('values', [])]
	if 'mapValue' in v:
		return {k: from_value(x) for k, x in v['mapValue'].get('fields', {}).items()}
	return None


class FirestoreClient:
	def __init__(self, project_id: str, token_provider: Callable[[], str], client: httpx.Client):
		self.project_id = project_id
		self.token_provider = token_provider
		self.client = client
		self.root = f'{FIRESTORE}/projects/{project_id}/databases/(default)/documents'

	def _headers(self) -> dict:
		return {'Authorization': f'Bearer {self.token_provider()}'}

	def set(self, path: str, data: dict, *, merge: bool = False) -> dict:
		"""Create or replace a document (``merge`` updates only the given top-level fields)."""
		params = {}
		if merge:
			params = [('updateMask.fieldPaths', k) for k in data]
		r = self.client.patch(f'{self.root}/{path.strip("/")}', params=params, headers=self._headers(),
							  json={'fields': {k: to_value(v) for k, v in data.items()}}, timeout=30)
		r.raise_for_status()
		return r.json()

	def get(self, path: str) -> dict | None:
		r = self.client.get(f'{self.root}/{path.strip("/")}', headers=self._headers(), timeout=20)
		if r.status_code == 404:
			return None
		r.raise_for_status()
		return {k: from_value(v) for k, v in r.json().get('fields', {}).items()}

	def delete(self, path: str) -> None:
		r = self.client.delete(f'{self.root}/{path.strip("/")}', headers=self._headers(), timeout=20)
		if r.status_code != 404:
			r.raise_for_status()
