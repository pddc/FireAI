"""Release-based updater.

Checks GitHub Releases for a newer version, downloads the tarball, verifies
its SHA-256 against the published checksum, unpacks it into
``$FIREAI_ROOT/releases/<version>``, runs ``deploy/install.sh --upgrade
--from-dir`` to install dependencies and swap the ``current`` symlink, and
restarts the services. If the install step fails the previous release stays
current. Progress is written to Redis so the UI can poll it.

Everything network/filesystem-facing is injectable for tests.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tarfile
import threading
import time
from pathlib import Path

import httpx

from common import common
from core.redis_client import get_redis

STATUS_KEY = 'updater:status'
DEFAULT_REPO = os.environ.get('FIREAI_REPO', '').replace('https://github.com/', '') or 'CHANGE-ME/fireai'
ROOT = Path(os.environ.get('FIREAI_ROOT', '/opt/fireai'))


def current_version() -> str:
	return common.read_settings()['versions']['server']


def semver_tuple(v: str) -> tuple[int, ...]:
	parts = re.findall(r'\d+', v)
	return tuple(int(p) for p in parts[:3]) + (0,) * (3 - min(3, len(parts)))


def check(repo: str = DEFAULT_REPO, *, client: httpx.Client | None = None, include_prerelease: bool = False) -> dict:
	"""Return {current, latest, update_available, release: {tag, name, notes, tarball_url, sha_url, published_at}}."""
	client = client or httpx.Client(timeout=20, headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'fireai-updater'})
	url = f'https://api.github.com/repos/{repo}/releases' + ('' if include_prerelease else '/latest')
	r = client.get(url)
	r.raise_for_status()
	data = r.json()
	release = data[0] if isinstance(data, list) else data
	tag = release.get('tag_name', '')
	latest = tag.lstrip('v')
	assets = release.get('assets', [])
	tarball = next((a for a in assets if a['name'].endswith('.tar.gz')), None)
	sha = next((a for a in assets if a['name'].endswith('.tar.gz.sha256')), None)
	cur = current_version()
	return {
		'current': cur,
		'latest': latest,
		'update_available': bool(latest) and semver_tuple(latest) > semver_tuple(cur) and tarball is not None,
		'release': {
			'tag': tag, 'name': release.get('name', tag), 'notes': release.get('body', ''), 'published_at': release.get('published_at'),
			'tarball_url': tarball['browser_download_url'] if tarball else None, 'sha_url': sha['browser_download_url'] if sha else None,
			'size': tarball['size'] if tarball else None,
		},
	}


def _set_status(percent: int, status: str, message: str = '', error: str | None = None) -> None:
	get_redis().set(STATUS_KEY, json.dumps({'percent': percent, 'status': status, 'message': message, 'error': error, 'ts': time.time()}))


def status() -> dict:
	raw = get_redis().get(STATUS_KEY)
	return json.loads(raw) if raw else {'percent': 0, 'status': 'idle', 'message': '', 'error': None, 'ts': 0}


def download_and_verify(tarball_url: str, sha_url: str | None, dest: Path, *, client: httpx.Client | None = None) -> Path:
	client = client or httpx.Client(timeout=120, follow_redirects=True)
	dest.parent.mkdir(parents=True, exist_ok=True)
	h = hashlib.sha256()
	with client.stream('GET', tarball_url) as r, open(dest, 'wb') as f:
		r.raise_for_status()
		total = int(r.headers.get('content-length', 0)) or None
		done = 0
		for chunk in r.iter_bytes(1 << 16):
			f.write(chunk)
			h.update(chunk)
			done += len(chunk)
			if total:
				_set_status(10 + int(40 * done / total), 'downloading', f'{done // 1024} / {total // 1024} KB')
	if sha_url:
		expected = client.get(sha_url).text.split()[0].strip().lower()
		if h.hexdigest() != expected:
			dest.unlink(missing_ok=True)
			raise ValueError('checksum mismatch: the download does not match the published SHA-256')
	return dest


def extract(tarball: Path, version: str, root: Path = ROOT) -> Path:
	rel = root / 'releases' / version
	if rel.exists():
		import shutil

		shutil.rmtree(rel)
	rel.mkdir(parents=True)
	with tarfile.open(tarball) as tf:
		members = tf.getmembers()
		# strip the single top-level folder, refuse path traversal
		for m in members:
			parts = Path(m.name).parts
			if len(parts) < 2 or '..' in parts or m.name.startswith('/'):
				continue
			m.name = str(Path(*parts[1:]))
			tf.extract(m, rel, filter='data') if hasattr(tarfile, 'data_filter') else tf.extract(m, rel)
	return rel


def apply(release_dir: Path, root: Path = ROOT, *, runner=subprocess.run) -> None:
	"""Run the installer in upgrade mode; it installs deps, swaps `current` and restarts services."""
	script = release_dir / 'deploy' / 'install.sh'
	if not script.exists():
		raise FileNotFoundError('release has no deploy/install.sh')
	env = {**os.environ, 'FIREAI_ROOT': str(root)}
	proc = runner(['sudo', '-E', 'bash', str(script), '--upgrade', f'--from-dir={release_dir}'], capture_output=True, text=True, env=env, timeout=3600)
	if proc.returncode != 0:
		raise RuntimeError(f'installer failed ({proc.returncode}): {(proc.stderr or proc.stdout)[-2000:]}')


_lock = threading.Lock()


def run_update(repo: str = DEFAULT_REPO, *, root: Path = ROOT, client: httpx.Client | None = None, runner=subprocess.run) -> None:
	"""Full update in the calling thread. Use start_update() from the API."""
	if not _lock.acquire(blocking=False):
		return
	try:
		_set_status(2, 'checking', 'Checking for updates')
		info = check(repo, client=client)
		if not info['update_available']:
			_set_status(100, 'done', 'Already up to date')
			return
		rel = info['release']
		_set_status(10, 'downloading', f'Downloading {rel["tag"]}')
		tarball = download_and_verify(rel['tarball_url'], rel['sha_url'], root / 'downloads' / f'fireai-{info["latest"]}.tar.gz', client=client)
		_set_status(55, 'extracting', 'Unpacking release')
		rel_dir = extract(tarball, info['latest'], root)
		_set_status(65, 'installing', 'Installing dependencies and switching release (this can take several minutes)')
		apply(rel_dir, root, runner=runner)
		_set_status(100, 'done', f'Updated to {info["latest"]}. Services are restarting.')
	except Exception as e:
		_set_status(100, 'error', 'Update failed; the previous version is still installed.', error=str(e)[:1000])
	finally:
		_lock.release()


def start_update(repo: str = DEFAULT_REPO) -> bool:
	if _lock.locked():
		return False
	threading.Thread(target=run_update, args=(repo,), name='fireai-updater', daemon=True).start()
	return True
