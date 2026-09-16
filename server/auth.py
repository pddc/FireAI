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


def authenticate(token: str | None) -> Principal | None:
	if auth_disabled():
		return Principal(uid='dev', role='admin', via='disabled')
	if not token:
		return None
	p = verify_token(token)
	if p is None and verify_firebase_id_token is not None:
		p = verify_firebase_id_token(token)
	return p
