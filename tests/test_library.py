"""Cook files, pellets, recipes, logs, backups (core.library) and their endpoints."""
import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from common import common
from core import library


def make_cookfile(path, title='Brisket', rows=5, with_asset=False):
	meta = {'title': title, 'starttime': 1_700_000_000_000, 'endtime': 1_700_003_600_000, 'units': 'F', 'thumbnail': '', 'id': 'cook1', 'version': '1.5.0'}
	raw = [{'T': 1_700_000_000_000 + i * 3000, 'P': {'Grill': 200 + i}, 'F': {'Probe1': 100 + i}, 'PSP': 225, 'NT': {}, 'AUX': {}} for i in range(rows)]
	assets = [{'id': 'a1', 'filename': 'a1.jpg', 'type': 'jpg'}] if with_asset else []
	with zipfile.ZipFile(path, 'w') as zf:
		zf.writestr('metadata.json', json.dumps(meta))
		zf.writestr('graph_labels.json', json.dumps({'primarysp': {'Grill': 'Grill Setpoint'}, 'probes': {'Grill': 'Grill', 'Probe1': 'Probe 1'}}))
		zf.writestr('raw_data.json', json.dumps(raw))
		zf.writestr('graph_data.json', json.dumps({}))
		zf.writestr('events.json', json.dumps([]))
		zf.writestr('comments.json', json.dumps([]))
		zf.writestr('assets.json', json.dumps(assets))
		if with_asset:
			zf.writestr('assets/a1.jpg', b'JPEGDATA')
			zf.writestr('assets/thumbs/a1.jpg', b'THUMB')


@pytest.fixture
def cookdir(workdir):
	d = workdir / 'history'
	make_cookfile(d / '2026-09-16--1200-Cook.pifire', 'Brisket', with_asset=True)
	make_cookfile(d / '2026-09-15--0900-Cook.pifire', 'Ribs')
	return d


class TestCooks:
	def test_list_newest_first(self, cookdir):
		cooks = library.list_cooks()
		assert [c['title'] for c in cooks] == ['Brisket', 'Ribs']
		assert cooks[0]['starttime'] == 1_700_000_000_000

	def test_read_and_rows(self, cookdir):
		doc = library.read_cook('2026-09-16--1200-Cook.pifire')
		rows = library.cook_rows(doc)
		assert len(rows) == 5 and rows[0]['P']['Grill'] == 200
		assert doc['graph_labels']['probes']['Probe1'] == 'Probe 1'

	def test_update_metadata_and_comments(self, cookdir):
		meta = library.update_cook_metadata('2026-09-16--1200-Cook.pifire', {'title': 'Best brisket', 'ignored': 1})
		assert meta['title'] == 'Best brisket'
		comments = library.add_cook_comment('2026-09-16--1200-Cook.pifire', 'Great bark', when='2026-09-16 14:30:00')
		assert comments[0]['text'] == 'Great bark' and comments[0]['time'] == '14:30'
		doc = library.read_cook('2026-09-16--1200-Cook.pifire')
		assert doc['metadata']['title'] == 'Best brisket' and len(doc['comments']) == 1

	def test_asset_and_delete(self, cookdir):
		data, ctype = library.read_cook_asset('2026-09-16--1200-Cook.pifire', 'a1')
		assert data == b'JPEGDATA' and ctype == 'image/jpeg'
		thumb, _ = library.read_cook_asset('2026-09-16--1200-Cook.pifire', 'a1', thumb=True)
		assert thumb == b'THUMB'
		library.delete_cook('2026-09-15--0900-Cook.pifire')
		assert len(library.list_cooks()) == 1

	def test_path_traversal_rejected(self, cookdir):
		with pytest.raises(ValueError):
			library.read_cook('../settings.json')
		with pytest.raises(ValueError):
			library.read_cook('x.pifire/../../etc')


class TestPellets:
	def test_add_load_delete(self, settings, control):
		db = library.upsert_pellet_profile({'brand': 'Lumber Jack', 'wood': 'Hickory', 'rating': 5, 'comments': 'nice'}, load=True)
		pid = db['current']['pelletid']
		assert db['archive'][pid]['brand'] == 'Lumber Jack' and 'Lumber Jack' in db['brands']
		assert db['current']['est_usage'] == 0 and pid in db['log'].values()
		with pytest.raises(ValueError):
			library.delete_pellet_profile(pid)
		other = next(k for k in db['archive'] if k != pid)
		library.load_pellet_profile(other)
		db = library.delete_pellet_profile(pid)
		assert pid not in db['archive']

	def test_lists_and_log(self, settings, control):
		db = library.set_pellet_lists(brands=['B', 'A', 'A', ' '], woods=None)
		assert db['brands'] == ['A', 'B']
		when = next(iter(db['log']))
		db = library.delete_pellet_log_entry(when)
		assert when not in db['log']

	def test_load_unknown(self, settings, control):
		with pytest.raises(KeyError):
			library.load_pellet_profile('nope')


class TestLogsAndBackup:
	def test_tail_log(self, workdir):
		(workdir / 'logs' / 'events.log').write_text('\n'.join(f'line {i}' for i in range(500)))
		assert library.tail_log('events.log', 3) == ['line 497', 'line 498', 'line 499']
		assert any(entry['name'] == 'events.log' for entry in library.list_logs())
		with pytest.raises(ValueError):
			library.tail_log('../settings.json')

	def test_backup_roundtrip_keeps_local_auth(self, settings, control):
		from server import auth

		auth.set_password('correct horse')
		s = common.read_settings()
		s['globals']['grill_name'] = 'Before'
		common.write_settings(s)
		data, name = library.export_backup()
		assert name.startswith('fireai-backup-')
		with zipfile.ZipFile(io.BytesIO(data)) as zf:
			assert set(zf.namelist()) == {'settings.json', 'pelletdb.json'}
		s = common.read_settings()
		s['globals']['grill_name'] = 'After'
		common.write_settings(s)
		auth.set_password('new password 1', replace=True)
		out = library.import_backup(data)
		assert set(out['restored']) == {'settings', 'pelletdb'}
		restored = common.read_settings()
		assert restored['globals']['grill_name'] == 'Before'
		assert auth.verify_password('new password 1')  # auth block is device-local, not restored

	def test_import_bare_settings_json(self, settings, control):
		s = common.read_settings()
		s['globals']['grill_name'] = 'Bare'
		out = library.import_backup(json.dumps(s).encode())
		assert out['restored'] == ['settings']
		assert common.read_settings()['globals']['grill_name'] == 'Bare'

	def test_import_garbage(self, settings, control):
		with pytest.raises(ValueError):
			library.import_backup(b'{"nope": 1}')


def test_endpoints(cookdir, settings, control):
	from server.app import create_app

	with TestClient(create_app()) as c:
		tok = c.post('/api/v1/auth/setup', json={'password': 'correct horse'}).json()['token']
		h = {'Authorization': f'Bearer {tok}'}
		assert len(c.get('/api/v1/cooks', headers=h).json()['cooks']) == 2
		fn = '2026-09-16--1200-Cook.pifire'
		assert c.get(f'/api/v1/cooks/{fn}', headers=h).json()['metadata']['title'] == 'Brisket'
		assert c.patch(f'/api/v1/cooks/{fn}', json={'title': 'Renamed'}, headers=h).json()['title'] == 'Renamed'
		assert c.post(f'/api/v1/cooks/{fn}/comments', json={'text': 'yum'}, headers=h).status_code == 200
		r = c.get(f'/api/v1/cooks/{fn}/assets/a1', headers=h)
		assert r.status_code == 200 and r.content == b'JPEGDATA'
		assert c.get('/api/v1/cooks/missing.pifire', headers=h).status_code == 404
		assert c.delete(f'/api/v1/cooks/{fn}', headers=h).status_code == 200
		# pellets
		r = c.put('/api/v1/pellets/profiles', json={'brand': 'X', 'wood': 'Oak', 'rating': 3, 'load': True}, headers=h)
		assert r.status_code == 200 and r.json()['archive']
		assert c.get('/api/v1/pellets', headers=h).status_code == 200
		# logs / system
		assert c.get('/api/v1/logs', headers=h).status_code == 200
		assert c.get('/api/v1/system/info', headers=h).json()['version']['server']
		b = c.get('/api/v1/system/backup', headers=h)
		assert b.status_code == 200 and b.headers['content-type'] == 'application/zip'
		r = c.post('/api/v1/system/restore', files={'file': ('b.zip', b.content, 'application/zip')}, headers=h)
		assert r.status_code == 200 and 'settings' in r.json()['restored']
		# recipes (empty)
		assert c.get('/api/v1/recipes', headers=h).json()['recipes'] == []
