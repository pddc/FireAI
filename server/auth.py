"""Local authentication for the FireAI API.

* One admin password (argon2 hash) stored under ``settings['server']['auth']``.
  It is set once through ``/api/v1/auth/setup``; until then every other
  endpoint answers 403 ``setup_required`` so a freshly-imaged Pi is never
  controllable from the network by accident.
* Sessions are short-lived JWTs (HS256) signed with a per-install secret that
  is generated on first use and also stored in settings (redacted by the API).
* Firebase ID tokens are accepted too when the grill is paired (slice C):
  ``verify_firebase_id_token`` is a hook the bridge fills in.

Set ``FIREAI_AUTH_DISABLED=1`` to skip all of this in local development.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from common import common

TOKEN_TTL_S = 30 * 24 * 3600
_hasher = PasswordHasher()


@dataclass
class Principal:
	uid: str
	role: str = 'admin'  # local password holders are admins
	via: str = 'local'


def auth_disabled() -> bool:
	return os.environ.get('FIREAI_AUTH_DISABLED', '') in ('1', 'true', 'yes')


def _auth_block(settings: dict) -> dict:
	return settings.setdefault('server', {}).setdefault('auth', {})


def password_is_set(settings: dict | None = None) -> bool:
	settings = settings or common.read_settings()
	return bool(_auth_block(settings).get('password_hash'))


def _jwt_secret(settings: dict) -> str:
	block = _auth_block(settings)
	if not block.get('jwt_secret'):
		block['jwt_secret'] = secrets.token_urlsafe(48)
		common.write_settings(settings)
	return block['jwt_secret']


def set_password(password: str, *, replace: bool = False) -> None:
	if len(password) < 8:
		raise ValueError('password must be at least 8 characters')
	settings = common.read_settings()
	block = _auth_block(settings)
	if block.get('password_hash') and not replace:
		raise PermissionError('password already set')
	block['password_hash'] = _hasher.hash(password)
	block['password_set_at'] = int(time.time())
	_jwt_secret(settings)
	common.write_settings(settings)


def verify_password(password: str) -> bool:
	settings = common.read_settings()
	stored = _auth_block(settings).get('password_hash')
	if not stored:
		return False
	try:
		return _hasher.verify(stored, password)
	except VerifyMismatchError:
		return False


def issue_token(uid: str = 'local-admin', role: str = 'admin', ttl_s: int = TOKEN_TTL_S) -> str:
	settings = common.read_settings()
	now = int(time.time())
	return jwt.encode({'sub': uid, 'role': role, 'iat': now, 'exp': now + ttl_s, 'iss': 'fireai-local'},
					  _jwt_secret(settings), algorithm='HS256')


def verify_token(token: str) -> Principal | None:
	settings = common.read_settings()
	secret = _auth_block(settings).get('jwt_secret')
	if not secret:
		return None
	try:
		claims = jwt.decode(token, secret, algorithms=['HS256'], issuer='fireai-local')
	except jwt.PyJWTError:
		return None
	return Principal(uid=claims['sub'], role=claims.get('role', 'admin'), via='local')


# Hook for slice C: the bridge installs a verifier that accepts Firebase ID
# tokens for members of this grill. Signature: (token) -> Principal | None.
verify_firebase_id_token = None  # type: ignore[assignment]


# --------------------------------------------------------------------------
# API keys: long-lived credentials for integrations (Home Assistant, Node-RED,
# the PiFire Android app) that cannot run the password login flow. Only the
# SHA-256 of a key is stored; the key itself is shown once at creation.
# --------------------------------------------------------------------------

API_KEY_PREFIX = 'fireai_'


def _key_hash(key: str) -> str:
	return hashlib.sha256(key.encode()).hexdigest()


def list_api_keys(settings: dict | None = None) -> list[dict]:
	settings = settings or common.read_settings()
	return [{k: v for k, v in entry.items() if k != 'hash'} for entry in _auth_block(settings).get('api_keys', [])]


def create_api_key(name: str, role: str = 'operator') -> tuple[str, dict]:
	"""Returns (plain key, public record). The plain key is never stored."""
	if role not in ('admin', 'operator', 'viewer'):
		raise ValueError('role must be admin, operator or viewer')
	settings = common.read_settings()
	key = API_KEY_PREFIX + secrets.token_urlsafe(30)
	entry = {'id': secrets.token_hex(4), 'name': (name or 'API key')[:60], 'role': role,
			 'created': time.strftime('%Y-%m-%d %H:%M'), 'last_used': None, 'hash': _key_hash(key)}
	_auth_block(settings).setdefault('api_keys', []).append(entry)
	common.write_settings(settings)
	return key, {k: v for k, v in entry.items() if k != 'hash'}


def delete_api_key(key_id: str) -> bool:
	settings = common.read_settings()
	keys = _auth_block(settings).get('api_keys', [])
	keep = [k for k in keys if k.get('id') != key_id]
	if len(keep) == len(keys):
		return False
	_auth_block(settings)['api_keys'] = keep
	common.write_settings(settings)
	return True


def verify_api_key(key: str) -> Principal | None:
	if not key or not key.startswith(API_KEY_PREFIX):
		return None
	digest = _key_hash(key)
	settings = common.read_settings()
	for entry in _auth_block(settings).get('api_keys', []):
		if hmac.compare_digest(entry.get('hash', ''), digest):
			today = time.strftime('%Y-%m-%d')
			if entry.get('last_used') != today:
				entry['last_used'] = today
				common.write_settings(settings)
			return Principal(uid=f"key:{entry['id']}", role=entry.get('role', 'operator'), via='api_key')
	return None


def authenticate(token: str | None) -> Principal | None:
	if auth_disabled():
		return Principal(uid='dev', role='admin', via='disabled')
	if not token:
		return None
	p = verify_api_key(token) if token.startswith(API_KEY_PREFIX) else verify_token(token)
	if p is None and verify_firebase_id_token is not None:
		p = verify_firebase_id_token(token)
	return p
