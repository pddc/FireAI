"""FastAPI dependencies shared by all routers."""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from server import auth

_bearer = HTTPBearer(auto_error=False)


def _basic_password(request: Request) -> str | None:
	"""HTTP Basic with the API key as the password (any user name), for clients that only speak basic auth."""
	header = request.headers.get('Authorization', '')
	if not header.lower().startswith('basic '):
		return None
	try:
		import base64

		decoded = base64.b64decode(header[6:].strip()).decode('utf-8', errors='replace')
	except Exception:  # noqa: BLE001
		return None
	return decoded.partition(':')[2] or None


def current_principal(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> auth.Principal:
	if not auth.auth_disabled() and not auth.password_is_set():
		raise HTTPException(status.HTTP_403_FORBIDDEN, detail={'code': 'setup_required', 'message': 'Set the admin password first.'})
	# Bearer header normally; ?token= for resources loaded by <img>/<a> where headers cannot be set;
	# X-API-Key / ?api_key= for integrations using an API key (Settings → System).
	token = (creds.credentials if creds else None) or request.headers.get('X-API-Key') 		or request.query_params.get('token') or request.query_params.get('api_key') or _basic_password(request)
	principal = auth.authenticate(token)
	if principal is None:
		raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={'code': 'unauthorized', 'message': 'Sign in required.'})
	return principal


def require_admin(p: auth.Principal = Depends(current_principal)) -> auth.Principal:
	if p.role != 'admin':
		raise HTTPException(status.HTTP_403_FORBIDDEN, detail={'code': 'forbidden', 'message': 'Admin only.'})
	return p
