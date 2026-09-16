"""Redis stream of notification events produced by the control process.

The control process calls ``publish_notification`` whenever it fires a user
notification (probe target reached, timer expired, error...). Consumers (the
cloud bridge, later the local API's push channel) read the stream with
``read_notifications`` and keep their own cursor, so multiple consumers can
tail it independently. The stream is capped so it never grows unbounded.
"""
from __future__ import annotations

import json
import time

from core.redis_client import get_redis

STREAM_KEY = 'notify:events'
MAX_LEN = 500


def publish_notification(event: str, title: str, body: str, *, label: str = '', target=0, channel: str = '') -> str:
	"""Append one notification to the stream. Returns the stream entry id."""
	r = get_redis()
	payload = {
		'event': event,
		'title': title,
		'body': body,
		'label': label,
		'target': json.dumps(target),
		'channel': channel,
		'ts': str(int(time.time() * 1000)),
	}
	return r.xadd(STREAM_KEY, payload, maxlen=MAX_LEN, approximate=True)


def read_notifications(last_id: str = '$', count: int = 100, block_ms: int | None = None) -> list[tuple[str, dict]]:
	"""Return entries newer than ``last_id`` as (id, fields). '$' means only new ones.

	Use '0-0' to read from the beginning. With ``block_ms`` the call waits for
	new entries up to that many milliseconds.
	"""
	r = get_redis()
	if block_ms is None:
		res = r.xread({STREAM_KEY: last_id}, count=count)
	else:
		res = r.xread({STREAM_KEY: last_id}, count=count, block=block_ms)
	out: list[tuple[str, dict]] = []
	for _stream, entries in res or []:
		for entry_id, fields in entries:
			fields = dict(fields)
			try:
				fields['target'] = json.loads(fields.get('target', '0'))
			except (TypeError, ValueError):
				pass
			try:
				fields['ts'] = int(fields.get('ts', 0))
			except (TypeError, ValueError):
				pass
			out.append((entry_id, fields))
	return out


def latest_id() -> str:
	"""Id of the newest entry, or '0-0' when the stream is empty."""
	r = get_redis()
	entries = r.xrevrange(STREAM_KEY, count=1)
	return entries[0][0] if entries else '0-0'
