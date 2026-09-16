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


def test_recipe_create_read_update(settings, control):
	name = library.create_recipe('Brisket')
	assert name.endswith('.pfrecipe') and library.list_recipes()[0]['title'] == 'Brisket'
	doc = library.read_recipe(name)
	assert doc['recipe']['steps'][0]['mode'] == 'Startup'
	doc['recipe']['steps'][1]['hold_temp'] = 250
	library.write_recipe_part(name, 'recipe', doc['recipe'])
	assert library.read_recipe(name)['recipe']['steps'][1]['hold_temp'] == 250
	from core import commands as reg

	out = reg.execute('recipe.start', {'filename': name}, origin='t', direct_write=True)
	assert out.result == 'OK'
	c = common.read_control()
	assert c['mode'] == 'Recipe' and c['recipe']['filename'].endswith(name)
	assert reg.execute('recipe.continue', {}, origin='t', direct_write=True).result == 'OK'
	assert reg.execute('recipe.start', {'filename': 'missing.pfrecipe'}, origin='t').result == 'ERROR'
	library.delete_recipe(name)
	assert library.list_recipes() == []


def _png(w=640, h=480, color=(200, 50, 20)):
	from PIL import Image

	buf = io.BytesIO()
	Image.new('RGB', (w, h), color).save(buf, 'PNG')
	return buf.getvalue()


class TestCookPhotosAndNotes:
	FN = '2026-09-16--1200-Cook.pifire'

	def test_add_photo_makes_thumbnail_and_cover(self, cookdir):
		asset = library.add_cook_photo(self.FN, _png(2400, 1800), as_thumbnail=True)
		doc = library.read_cook(self.FN)
		assert [a['id'] for a in doc['assets']] == ['a1', asset['id']]
		assert doc['metadata']['thumbnail'] == asset['filename']
		full, ctype = library.read_cook_asset(self.FN, asset['id'])
		thumb, _ = library.read_cook_asset(self.FN, asset['id'], thumb=True)
		from PIL import Image

		assert Image.open(io.BytesIO(full)).size == (1200, 900) and ctype == 'image/jpeg'
		assert Image.open(io.BytesIO(thumb)).size == (256, 256)

	def test_photo_on_comment_and_removal_cleans_references(self, cookdir):
		comments = library.add_cook_comment(self.FN, 'with photo')
		cid = comments[0]['id']
		asset = library.add_cook_photo(self.FN, _png(), comment_id=cid, as_thumbnail=True)
		assert asset['id'] in library.read_cook(self.FN)['comments'][0]['assets']
		library.delete_cook_photo(self.FN, asset['id'])
		doc = library.read_cook(self.FN)
		assert [a['id'] for a in doc['assets']] == ['a1']
		assert doc['comments'][0]['assets'] == [] and doc['metadata']['thumbnail'] == ''
		with zipfile.ZipFile(cookdir / self.FN) as zf:
			assert not any(asset['id'] in n for n in zf.namelist())
		# the original asset is untouched
		assert library.read_cook_asset(self.FN, 'a1')[0] == b'JPEGDATA'

	def test_not_an_image_rejected(self, cookdir):
		with pytest.raises(ValueError):
			library.add_cook_photo(self.FN, b'hello')
		assert len(library.read_cook(self.FN)['assets']) == 1

	def test_thumbnail_select_and_clear(self, cookdir):
		assert library.set_cook_thumbnail(self.FN, 'a1')['thumbnail'] == 'a1.jpg'
		assert library.set_cook_thumbnail(self.FN, None)['thumbnail'] == ''
		with pytest.raises(FileNotFoundError):
			library.set_cook_thumbnail(self.FN, 'nope')

	def test_edit_and_delete_comment(self, cookdir):
		cid = library.add_cook_comment(self.FN, 'first')[0]['id']
		out = library.update_cook_comment(self.FN, cid, 'edited')
		assert out[0]['text'] == 'edited' and out[0]['edited']
		assert library.delete_cook_comment(self.FN, cid) == []
		with pytest.raises(FileNotFoundError):
			library.delete_cook_comment(self.FN, cid)

	def test_export_import_roundtrip(self, cookdir):
		data, name = library.export_cook(self.FN)
		new = library.import_cook(data)
		assert new != name and new.endswith('.pifire') and 'Brisket' in new
		assert library.read_cook(new)['metadata']['title'] == 'Brisket'
		assert len(library.list_cooks()) == 3
		with pytest.raises(ValueError):
			library.import_cook(b'not a zip')
		buf = io.BytesIO()
		with zipfile.ZipFile(buf, 'w') as zf:
			zf.writestr('metadata.json', '{}')
		with pytest.raises(ValueError, match='raw_data.json'):
			library.import_cook(buf.getvalue())


def test_recipe_photos_and_export(settings, control):
	name = library.create_recipe('Ribs')
	doc = library.read_recipe(name)
	doc['recipe']['ingredients'] = [{'name': 'Ribs', 'quantity': '2 racks', 'assets': []}]
	library.write_recipe_part(name, 'recipe', doc['recipe'])
	cover = library.add_recipe_photo(name, _png(), as_cover=True)
	step = library.add_recipe_photo(name, _png(), target='ingredients', index=0)
	doc = library.read_recipe(name)
	assert doc['metadata']['image'] == cover['filename'] and doc['metadata']['thumbnail'] == cover['filename']
	assert doc['recipe']['ingredients'][0]['assets'] == [step['id']]
	assert library.read_recipe_asset(name, step['id'], thumb=True)[1] == 'image/jpeg'
	library.delete_recipe_photo(name, cover['id'])
	doc = library.read_recipe(name)
	assert doc['metadata']['image'] == '' and [a['id'] for a in doc['assets']] == [step['id']]
	data, _ = library.export_recipe(name)
	new = library.import_recipe(data)
	assert library.read_recipe(new)['recipe']['ingredients'][0]['assets'] == [step['id']]
	assert library.read_recipe_asset(new, step['id'])[0]
	library.delete_recipe(name)
	library.delete_recipe(new)


def test_photo_endpoints(cookdir, settings, control):
	from server.app import create_app

	fn = '2026-09-16--1200-Cook.pifire'
	with TestClient(create_app()) as c:
		tok = c.post('/api/v1/auth/setup', json={'password': 'correct horse'}).json()['token']
		h = {'Authorization': f'Bearer {tok}'}
		r = c.post(f'/api/v1/cooks/{fn}/assets?thumbnail=true', files={'file': ('p.png', _png(), 'image/png')}, headers=h)
		assert r.status_code == 201
		aid = r.json()['id']
		assert c.get(f'/api/v1/cooks/{fn}', headers=h).json()['metadata']['thumbnail'] == r.json()['filename']
		assert c.get(f'/api/v1/cooks/{fn}/assets/{aid}?thumb=true', headers=h).headers['content-type'] == 'image/jpeg'
		assert c.put(f'/api/v1/cooks/{fn}/thumbnail', json={'asset_id': None}, headers=h).json()['thumbnail'] == ''
		cid = c.post(f'/api/v1/cooks/{fn}/comments', json={'text': 'yum'}, headers=h).json()['comments'][0]['id']
		assert c.put(f'/api/v1/cooks/{fn}/comments/{cid}', json={'text': 'yum!'}, headers=h).json()['comments'][0]['text'] == 'yum!'
		assert c.delete(f'/api/v1/cooks/{fn}/comments/{cid}', headers=h).json()['comments'] == []
		assert c.delete(f'/api/v1/cooks/{fn}/assets/{aid}', headers=h).status_code == 200
		assert c.post(f'/api/v1/cooks/{fn}/assets', files={'file': ('p.txt', b'nope', 'text/plain')}, headers=h).status_code == 400
		d = c.get(f'/api/v1/cooks/{fn}/download', headers=h)
		assert d.status_code == 200 and d.headers['content-disposition'].endswith(f'"{fn}"')
		r = c.post('/api/v1/cooks/import', files={'file': (fn, d.content, 'application/zip')}, headers=h)
		assert r.status_code == 201 and r.json()['filename'].endswith('.pifire')
		# recipes
		rn = c.post('/api/v1/recipes', json={'title': 'Chicken'}, headers=h).json()['filename']
		r = c.post(f'/api/v1/recipes/{rn}/assets?cover=true', files={'file': ('p.png', _png(), 'image/png')}, headers=h)
		assert r.status_code == 201
		assert c.get(f'/api/v1/recipes/{rn}/assets/{r.json()["id"]}', headers=h).status_code == 200
		d = c.get(f'/api/v1/recipes/{rn}/download', headers=h)
		assert c.post('/api/v1/recipes/import', files={'file': (rn, d.content, 'application/zip')}, headers=h).status_code == 201
		assert len(c.get('/api/v1/recipes', headers=h).json()['recipes']) == 2


def test_metrics_rows_and_csv(settings, control):
	common.write_metrics(flush=True)
	m = common.default_metrics()
	m.update({'mode': 'Startup', 'starttime': 1_700_000_000_000, 'endtime': 1_700_000_240_000, 'augerontime': 60, 'fanontime': 240, 'p_mode': 2})
	common.write_metrics(m, new_metric=True)
	m['starttime'] = 1_700_000_000_000  # new_metric stamps starttime with "now" (in place); rewrite the record with the fixed time
	common.write_metrics(m)
	m2 = common.default_metrics()
	m2.update({'mode': 'Hold', 'starttime': 1_700_000_240_000, 'endtime': 0, 'augerontime': 10})
	common.write_metrics(m2, new_metric=True)
	m2['starttime'] = 1_700_000_240_000
	common.write_metrics(m2)
	rows = library.cook_metrics()
	assert [r['mode'] for r in rows] == ['Startup', 'Hold']
	assert rows[0]['duration_s'] == 240 and rows[0]['auger_pct'] == 25.0
	assert rows[0]['est_usage_g'] == round(60 * settings['globals']['augerrate'])
	assert rows[1]['endtime'] is None and rows[1]['auger_pct'] is None
	csv_text = library.metrics_csv(rows)
	assert csv_text.splitlines()[0].startswith('mode,starttime,endtime,duration_s')
	assert csv_text.splitlines()[1].startswith('Startup,2023-')
	from server.app import create_app

	with TestClient(create_app()) as c:
		tok = c.post('/api/v1/auth/setup', json={'password': 'correct horse'}).json()['token']
		h = {'Authorization': f'Bearer {tok}'}
		assert len(c.get('/api/v1/metrics', headers=h).json()['metrics']) == 2
		r = c.get('/api/v1/metrics.csv', headers=h)
		assert r.status_code == 200 and r.headers['content-type'].startswith('text/csv')
