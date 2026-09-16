"""Release updater: version compare, GitHub check, download+verify, extract, apply."""
import hashlib
import io
import json
import tarfile

import httpx
import pytest

from core import updater


def make_tarball(version='9.9.9', with_installer=True) -> bytes:
	buf = io.BytesIO()
	with tarfile.open(fileobj=buf, mode='w:gz') as tf:
		def add(name, data):
			info = tarfile.TarInfo(f'fireai-{version}/{name}')
			info.size = len(data)
			tf.addfile(info, io.BytesIO(data))
		add('pyproject.toml', b'[project]\nname = "fireai"\n')
		add('updater/updater_manifest.json', json.dumps({'metadata': {'versions': {'server': version}}}).encode())
		if with_installer:
			add('deploy/install.sh', b'#!/bin/bash\necho ok\n')
		# a traversal attempt that must be ignored
		info = tarfile.TarInfo(f'fireai-{version}/../evil.txt')
		info.size = 4
		tf.addfile(info, io.BytesIO(b'evil'))
	return buf.getvalue()


class FakeGitHub:
	def __init__(self, latest='9.9.9', tarball=None, bad_sha=False):
		self.tarball = tarball or make_tarball(latest)
		self.latest = latest
		self.bad_sha = bad_sha

	def handler(self, req: httpx.Request):
		url = str(req.url)
		if url.endswith('/releases/latest'):
			return httpx.Response(200, json={
				'tag_name': f'v{self.latest}', 'name': f'FireAI {self.latest}', 'body': 'notes', 'published_at': '2026-09-16T00:00:00Z',
				'assets': [
					{'name': f'fireai-{self.latest}.tar.gz', 'browser_download_url': 'https://dl.example/fireai.tar.gz', 'size': len(self.tarball)},
					{'name': f'fireai-{self.latest}.tar.gz.sha256', 'browser_download_url': 'https://dl.example/fireai.tar.gz.sha256', 'size': 80},
				],
			})
		if url.endswith('fireai.tar.gz'):
			return httpx.Response(200, content=self.tarball, headers={'content-length': str(len(self.tarball))})
		if url.endswith('.sha256'):
			digest = 'deadbeef' * 8 if self.bad_sha else hashlib.sha256(self.tarball).hexdigest()
			return httpx.Response(200, text=f'{digest}  fireai.tar.gz\n')
		return httpx.Response(404)

	def client(self):
		return httpx.Client(transport=httpx.MockTransport(self.handler))


def test_semver_tuple():
	assert updater.semver_tuple('v1.10.2') == (1, 10, 2)
	assert updater.semver_tuple('2.0.0a0') == (2, 0, 0)
	assert updater.semver_tuple('1.9.0') < updater.semver_tuple('1.10.0')


def test_check_reports_update(settings):
	gh = FakeGitHub()
	info = updater.check('me/fireai', client=gh.client())
	assert info['update_available'] and info['latest'] == '9.9.9' and info['release']['tarball_url']


def test_check_no_update_when_current(settings):
	gh = FakeGitHub(latest=settings['versions']['server'])
	assert updater.check('me/fireai', client=gh.client())['update_available'] is False


def test_download_verify_extract(settings, tmp_path, redis_client):
	gh = FakeGitHub()
	dest = updater.download_and_verify('https://dl.example/fireai.tar.gz', 'https://dl.example/fireai.tar.gz.sha256', tmp_path / 'dl' / 'f.tar.gz', client=gh.client())
	assert dest.exists()
	rel = updater.extract(dest, '9.9.9', tmp_path)
	assert (rel / 'deploy' / 'install.sh').exists() and (rel / 'pyproject.toml').exists()
	assert not (tmp_path / 'evil.txt').exists() and not (tmp_path / 'releases' / 'evil.txt').exists()


def test_checksum_mismatch_rejected(settings, tmp_path, redis_client):
	gh = FakeGitHub(bad_sha=True)
	with pytest.raises(ValueError, match='checksum'):
		updater.download_and_verify('https://dl.example/fireai.tar.gz', 'https://dl.example/fireai.tar.gz.sha256', tmp_path / 'f.tar.gz', client=gh.client())
	assert not (tmp_path / 'f.tar.gz').exists()


def test_run_update_end_to_end_with_fake_installer(settings, tmp_path, redis_client):
	gh = FakeGitHub()
	calls = []

	def runner(cmd, **kw):
		calls.append(cmd)
		class P:
			returncode = 0
			stdout = 'ok'
			stderr = ''
		return P()

	updater.run_update('me/fireai', root=tmp_path, client=gh.client(), runner=runner)
	st = updater.status()
	assert st['status'] == 'done' and '9.9.9' in st['message'], st
	assert calls and calls[0][3].endswith('install.sh') and '--upgrade' in calls[0]


def test_run_update_reports_installer_failure(settings, tmp_path, redis_client):
	gh = FakeGitHub()

	def runner(cmd, **kw):
		class P:
			returncode = 1
			stdout = ''
			stderr = 'pip exploded'
		return P()

	updater.run_update('me/fireai', root=tmp_path, client=gh.client(), runner=runner)
	st = updater.status()
	assert st['status'] == 'error' and 'pip exploded' in st['error']
