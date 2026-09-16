#!/usr/bin/env python3
"""FireAI development harness: control process + thermal simulator, no hardware, no Redis server.

Usage (from the repo root, inside the venv):

    python scripts/simulate.py                # control loop on fakeredis, sim time = real time
    python scripts/simulate.py --speed 20     # simulated clock runs 20x faster
    python scripts/simulate.py --with-server  # also start the FastAPI server on :8080 (slice B)
    python scripts/simulate.py --workdir .sim # keep settings/history/logs in a separate folder

The process writes its runtime files (settings.json, pelletdb.json, logs/, history/)
into --workdir (default: ./.sim) so the repo checkout stays clean.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import threading
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SEED_DIRS = ['updater', 'wizard', 'probes', 'controller', 'display', 'notify', 'grillplat', 'distance', 'dashboard']


class ScaledClock:
	"""time.time()/time.sleep() replacement that runs faster than wall-clock."""

	def __init__(self, speed: float):
		self.speed = speed
		self._real_time = time.time
		self._real_sleep = time.sleep
		self._t0_real = self._real_time()
		self._t0_sim = self._t0_real

	def time(self):
		return self._t0_sim + (self._real_time() - self._t0_real) * self.speed

	def sleep(self, seconds):
		self._real_sleep(max(0.0, seconds / self.speed))

	def install(self):
		time.time = self.time
		time.sleep = self.sleep


def prepare_workdir(workdir: Path, reset: bool) -> None:
	if reset and workdir.exists():
		shutil.rmtree(workdir)
	workdir.mkdir(parents=True, exist_ok=True)
	for d in SEED_DIRS:
		dst = workdir / d
		if not dst.exists():
			shutil.copytree(REPO_ROOT / d, dst, ignore=shutil.ignore_patterns('__pycache__'))
	for d in ['logs', 'history', 'backups', 'recipes']:
		(workdir / d).mkdir(exist_ok=True)


def main(argv=None):
	ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
	ap.add_argument('--workdir', default='.sim', help='runtime data folder (default ./.sim)')
	ap.add_argument('--reset', action='store_true', help='wipe the workdir first')
	ap.add_argument('--speed', type=float, default=1.0, help='simulated clock speed multiplier')
	ap.add_argument('--with-server', action='store_true', help='also run the FastAPI server')
	ap.add_argument('--port', type=int, default=8080)
	ap.add_argument('--units', default='F', choices=['F', 'C'])
	args = ap.parse_args(argv)

	os.environ.setdefault('FIREAI_FAKE_REDIS', '1')
	sys.path.insert(0, str(REPO_ROOT))

	workdir = Path(args.workdir).resolve()
	prepare_workdir(workdir, args.reset)
	os.chdir(workdir)

	if args.speed != 1.0:
		ScaledClock(args.speed).install()

	from common.common import read_settings, write_settings
	from tests.sim_harness import _NoopMonitor, simulator_settings

	settings = read_settings(init=True)
	if settings['modules']['grillplat'] != 'simulator':
		write_settings(simulator_settings(settings, units=args.units))

	import control

	control.Process_Monitor = _NoopMonitor  # no supervisorctl here
	stop = threading.Event()
	t = threading.Thread(target=control.main, kwargs={'stop_event': stop}, name='control', daemon=True)
	t.start()
	print(f'[simulate] control loop running on fakeredis in {workdir} (speed x{args.speed})')

	if args.with_server:
		import uvicorn

		from server.app import create_app

		app = create_app()
		print(f'[simulate] API on http://127.0.0.1:{args.port}  (docs at /docs)')
		try:
			uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='info')
		finally:
			stop.set()
	else:
		try:
			while t.is_alive():
				t.join(0.5)
		except KeyboardInterrupt:
			stop.set()
			t.join(5)


if __name__ == '__main__':
	main()
