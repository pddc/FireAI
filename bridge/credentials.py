"""Bridge credentials: where the grill's cloud identity lives on disk.

``bridge/credentials.json`` (mode 0600) holds what ``claimPairing`` returned
plus the refresh token obtained from the first custom-token sign-in. It is
outside settings.json on purpose: settings are backed up, exported and
mirrored to the cloud; this file never leaves the Pi.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

DEFAULT_PATH = Path(os.environ.get('FIREAI_BRIDGE_CREDENTIALS', 'bridge/credentials.json'))


@dataclass
class Credentials:
	grill_id: str
	project_id: str
	api_key: str
	database_url: str
	refresh_token: str
	functions_url: str = ''
	paired_at: float = 0.0
	extra: dict = field(default_factory=dict)

	@classmethod
	def load(cls, path: Path = DEFAULT_PATH) -> Credentials | None:
		try:
			data = json.loads(Path(path).read_text())
		except (OSError, ValueError):
			return None
		try:
			return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})
		except TypeError:
			return None

	def save(self, path: Path = DEFAULT_PATH) -> None:
		path = Path(path)
		path.parent.mkdir(parents=True, exist_ok=True)
		tmp = path.with_suffix('.tmp')
		tmp.write_text(json.dumps(asdict(self), indent=2))
		try:
			os.chmod(tmp, 0o600)
		except OSError:
			pass
		os.replace(tmp, path)

	@staticmethod
	def delete(path: Path = DEFAULT_PATH) -> None:
		try:
			Path(path).unlink()
		except OSError:
			pass
