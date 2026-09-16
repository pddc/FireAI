#!/usr/bin/env python3
"""FireAI cloud bridge process.

Waits until the grill is paired (bridge/credentials.json exists and
settings.cloud.enabled is true), then runs the sync loop. Re-checks every
few seconds so pairing/unpairing through the API takes effect without a
restart. Never touches hardware; the control process owns the cook.
"""
from __future__ import annotations

import logging
import os
import signal
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bridge.credentials import DEFAULT_PATH, Credentials  # noqa: E402
from bridge.sync import Bridge  # noqa: E402
from common import common  # noqa: E402

log = logging.getLogger('bridge')


def main() -> None:
	logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] bridge: %(message)s')
	bridge: Bridge | None = None

	def _stop(*_):
		if bridge:
			bridge.stop_event.set()
		raise SystemExit(0)

	signal.signal(signal.SIGTERM, _stop)
	signal.signal(signal.SIGINT, _stop)

	while True:
		creds = Credentials.load(DEFAULT_PATH)
		settings = common.read_settings()
		enabled = settings.get('cloud', {}).get('enabled', True)
		if creds is None or not enabled:
			log.info('not paired or cloud disabled; waiting')
			time.sleep(10)
			continue
		log.info(f'starting sync for grill {creds.grill_id}')
		bridge = Bridge(creds)
		try:
			bridge.run()
		except SystemExit:
			raise
		except Exception as e:
			log.exception(f'bridge crashed: {e}')
			time.sleep(15)
		finally:
			bridge = None
		# If credentials were removed (unpair), loop back to waiting.


if __name__ == '__main__':
	main()
