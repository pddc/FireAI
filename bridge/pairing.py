"""Pi side of the pairing handshake.

    start()  -> code the user types into the app (valid 10 minutes)
    poll()   -> 'pending' | 'paired' | 'expired' | 'error'

On success the bridge credentials are written and the running bridge picks
them up. The Functions base URL comes from settings['cloud']['functions_url']
(default: the FireAI project's public endpoint) so self-hosters can point at
their own project.
"""
from __future__ import annotations

import secrets
import time
from dataclasses import dataclass

import httpx

from bridge.credentials import DEFAULT_PATH, Credentials
from bridge.firebase_rest import AuthSession

DEFAULT_FUNCTIONS_URL = 'https://us-central1-fireai-dev.cloudfunctions.net'


@dataclass
class PairingState:
	code: str
	secret: str
	started_at: float
	expires_at: float
	status: str = 'pending'  # pending | paired | expired | error
	error: str | None = None
	grill_id: str | None = None


class Pairing:
	def __init__(self, functions_url: str = DEFAULT_FUNCTIONS_URL, *, client: httpx.Client | None = None,
				 grill_info: dict | None = None, credentials_path=DEFAULT_PATH):
		self.functions_url = functions_url.rstrip('/')
		self.client = client or httpx.Client(timeout=20)
		self.grill_info = grill_info or {}
		self.credentials_path = credentials_path
		self.state: PairingState | None = None

	def start(self) -> PairingState:
		for _ in range(5):
			code = f'{secrets.randbelow(10**6):06d}'
			secret = secrets.token_urlsafe(48)[:64]
			r = self.client.post(f'{self.functions_url}/requestPairing', json={'code': code, 'secret': secret, 'grillInfo': self.grill_info})
			if r.status_code == 409:
				continue
			if r.status_code != 200:
				self.state = PairingState(code, secret, time.time(), time.time(), status='error', error=f'requestPairing {r.status_code}: {r.text[:200]}')
				return self.state
			expires = r.json().get('expiresAt', (time.time() + 600) * 1000) / 1000
			self.state = PairingState(code, secret, time.time(), expires)
			return self.state
		self.state = PairingState('', '', time.time(), time.time(), status='error', error='could not allocate a pairing code')
		return self.state

	def poll(self) -> PairingState:
		st = self.state
		if st is None:
			raise RuntimeError('pairing not started')
		if st.status != 'pending':
			return st
		if time.time() > st.expires_at:
			st.status = 'expired'
			return st
		r = self.client.post(f'{self.functions_url}/claimPairing', json={'code': st.code, 'secret': st.secret})
		if r.status_code == 202:
			return st
		if r.status_code == 410:
			st.status = 'expired'
			return st
		if r.status_code != 200:
			st.status = 'error'
			st.error = f'claimPairing {r.status_code}: {r.text[:200]}'
			return st
		data = r.json()
		try:
			session = AuthSession(data['apiKey'], self.client)
			session.sign_in_with_custom_token(data['customToken'])
			creds = Credentials(
				grill_id=data['grillId'], project_id=data['projectId'], api_key=data['apiKey'],
				database_url=data['databaseURL'], refresh_token=session.refresh_token or '',
				functions_url=self.functions_url, paired_at=time.time(),
			)
			creds.save(self.credentials_path)
		except Exception as e:
			st.status = 'error'
			st.error = f'token exchange failed: {e}'
			return st
		st.status = 'paired'
		st.grill_id = data['grillId']
		return st
