"""Settings document helpers shared by the API and the bridge.

* ``redact``      - copy of settings safe to hand to any client: every secret
                    becomes the sentinel ``"***"`` (or ``""`` when unset).
* ``apply_patch`` - deep-merge a partial document into settings.json, ignoring
                    sentinel values so a client can round-trip a redacted
                    document without wiping secrets. Returns the changed paths.

Secret detection is by key name so a new notification service or probe
module gets protection without registering anything. Keys matching
``SECRET_KEY_RE`` anywhere in the tree are secrets. A few well-known keys
that merely *look* secret are allow-listed in ``NOT_SECRET``.
"""
from __future__ import annotations

import copy
import re
from collections.abc import Mapping
from typing import Any

from common import common

REDACTED = '***'
SECRET_KEY_RE = re.compile(r'(pass(word|wd)?|token|secret|api_?key|app_?key|user_?key|auth_key|p12|private_key|jwt)', re.IGNORECASE)
NOT_SECRET = {'jwt_alg', 'token_ttl', 'auth_required', 'password_set'}


def is_secret_key(key: str) -> bool:
	return key not in NOT_SECRET and bool(SECRET_KEY_RE.search(key))


def redact(settings: Mapping) -> dict:
	def walk(node):
		if isinstance(node, Mapping):
			out = {}
			for k, v in node.items():
				if isinstance(k, str) and is_secret_key(k) and not isinstance(v, Mapping | list):
					out[k] = REDACTED if v not in (None, '', 0, False) else ''
				else:
					out[k] = walk(v)
			return out
		if isinstance(node, list):
			return [walk(v) for v in node]
		return node

	return walk(settings)


def _flatten_changes(base: Mapping, patch: Mapping, prefix: str = '') -> list[str]:
	changed = []
	for k, v in patch.items():
		path = f'{prefix}{k}'
		if isinstance(v, Mapping) and isinstance(base.get(k), Mapping):
			changed.extend(_flatten_changes(base[k], v, path + '.'))
		elif base.get(k, object()) != v:
			changed.append(path)
	return changed


def strip_sentinels(patch: Mapping) -> dict:
	"""Drop any leaf equal to the redaction sentinel so it never overwrites a real secret."""
	out = {}
	for k, v in patch.items():
		if isinstance(v, Mapping):
			inner = strip_sentinels(v)
			if inner or not v:
				out[k] = inner
		elif v == REDACTED:
			continue
		else:
			out[k] = v
	return out


PROTECTED_PATHS = ('versions', 'server_info', 'server.auth')


def apply_patch(patch: Mapping, *, allow_protected: bool = False) -> list[str]:
	"""Deep-merge ``patch`` into settings.json. Returns dotted paths that changed."""
	patch = strip_sentinels(patch)
	if not allow_protected:
		for p in PROTECTED_PATHS:
			head, _, tail = p.partition('.')
			if head in patch and (not tail or (isinstance(patch[head], Mapping) and tail in patch[head])):
				raise ValueError(f'settings path {p!r} is read-only')
	settings = common.read_settings()
	changed = _flatten_changes(settings, patch)
	if changed:
		merged = common.deep_update(copy.deepcopy(settings), patch)
		common.write_settings(merged)
	return changed


def get_path(settings: Mapping, dotted: str, default: Any = None) -> Any:
	node: Any = settings
	for part in dotted.split('.'):
		if not isinstance(node, Mapping) or part not in node:
			return default
		node = node[part]
	return node
