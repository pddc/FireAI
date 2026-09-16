"""Cook files, pellet database, recipes and logs: the "library" behind the app.

Thin, tested wrappers over the legacy file formats so the API and the bridge
can serve them without Flask. Cook files are ``.pifire`` zip archives in
``history/``; the pellet DB is ``pelletdb.json``; recipes are ``.pfrecipe``
zips in ``recipes/``.
"""
from __future__ import annotations

import datetime
import io
import json
import os
import re
import zipfile
from pathlib import Path

from common import common
from file_mgmt.common import read_json_file_data, update_json_file_data

IMAGE_TYPES = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp'}
MAX_IMAGE = (1200, 900)
THUMB = (256, 256)


# --------------------------------------------------------------------------
# Images inside .pifire / .pfrecipe archives (shared by cooks and recipes)
# --------------------------------------------------------------------------


def _read_part(path: Path, part: str, default):
	data, status = read_json_file_data(str(path), part, unpackassets=False)
	return data if status == 'OK' else default


def _write_part(path: Path, part: str, data) -> None:
	status = update_json_file_data(data, str(path), part)
	if status != 'OK':
		raise ValueError(status)


def _prepare_image(data: bytes) -> tuple[bytes, bytes, str]:
	"""Normalise an uploaded photo: apply EXIF rotation, cap the size, make a square thumbnail. Returns (full, thumb, ext)."""
	from PIL import Image, ImageOps

	try:
		im = Image.open(io.BytesIO(data))
		im.load()
	except Exception as e:  # noqa: BLE001
		raise ValueError(f'not an image: {e}')
	im = ImageOps.exif_transpose(im)
	ext = 'png' if im.format == 'PNG' and im.mode in ('RGBA', 'LA', 'P') else 'jpg'
	if ext == 'jpg':
		im = im.convert('RGB')
	full = im.copy()
	full.thumbnail(MAX_IMAGE)
	thumb = ImageOps.fit(im, THUMB)
	out, tout = io.BytesIO(), io.BytesIO()
	if ext == 'jpg':
		full.save(out, 'JPEG', quality=85, optimize=True)
		thumb.save(tout, 'JPEG', quality=80)
	else:
		full.save(out, 'PNG', optimize=True)
		thumb.save(tout, 'PNG')
	return out.getvalue(), tout.getvalue(), ext


def add_image_asset(path: Path, data: bytes) -> dict:
	"""Store a photo (plus thumbnail) in the archive and register it in assets.json."""
	full, thumb, ext = _prepare_image(data)
	asset_id = common.generate_uuid()
	asset = {'id': asset_id, 'filename': f'{asset_id}.{ext}', 'type': ext}
	assets = _read_part(path, 'assets', [])
	assets.append(asset)
	_write_part(path, 'assets', assets)
	with zipfile.ZipFile(path, 'a', zipfile.ZIP_DEFLATED) as zf:
		zf.writestr(f"assets/{asset['filename']}", full)
		zf.writestr(f"assets/thumbs/{asset['filename']}", thumb)
	return asset


def remove_image_asset(path: Path, asset_id: str, *, recipe: bool = False) -> None:
	"""Delete a photo from the archive and every reference to it (thumbnail, comments, recipe rows)."""
	assets = _read_part(path, 'assets', [])
	asset = next((a for a in assets if a.get('id') == asset_id), None)
	if not asset:
		raise FileNotFoundError(asset_id)
	filename = asset['filename']
	members = {f'assets/{filename}', f'assets/thumbs/{filename}', 'assets.json'}
	tmp = path.with_suffix(path.suffix + '.tmp')
	with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
		for item in zin.infolist():
			if item.filename not in members:
				zout.writestr(item, zin.read(item.filename))
		zout.writestr('assets.json', json.dumps([a for a in assets if a['id'] != asset_id], indent=2))
	os.replace(tmp, path)
	refs = (filename, asset_id)
	meta = _read_part(path, 'metadata', {})
	if meta.get('thumbnail') in refs or meta.get('image') in refs:
		meta['thumbnail'] = ''
		if recipe:
			meta['image'] = ''
		_write_part(path, 'metadata', meta)
	comments = _read_part(path, 'comments', [])
	if any(set(c.get('assets', [])) & set(refs) for c in comments):
		for c in comments:
			c['assets'] = [a for a in c.get('assets', []) if a not in refs]
		_write_part(path, 'comments', comments)
	if recipe:
		rec = _read_part(path, 'recipe', {})
		rows = [r for section in ('ingredients', 'instructions') for r in rec.get(section, [])]
		if any(set(r.get('assets', [])) & set(refs) for r in rows):
			for r in rows:
				r['assets'] = [a for a in r.get('assets', []) if a not in refs]
			_write_part(path, 'recipe', rec)


def read_image_asset(path: Path, asset_id: str, *, thumb: bool = False) -> tuple[bytes, str]:
	assets = _read_part(path, 'assets', None)
	if assets is None:
		raise FileNotFoundError(asset_id)
	asset = next((a for a in assets if a.get('id') == asset_id), None)
	if not asset:
		raise FileNotFoundError(asset_id)
	member = f"assets/{'thumbs/' if thumb else ''}{asset['filename']}"
	with zipfile.ZipFile(path) as zf:
		data = zf.read(member)
	return data, IMAGE_TYPES.get(asset.get('type', 'jpg').lower(), 'application/octet-stream')


def _import_archive(data: bytes, folder: Path, suffix: str, required: tuple[str, ...]) -> str:
	"""Validate an uploaded archive and store it under a unique name; returns the filename."""
	try:
		with zipfile.ZipFile(io.BytesIO(data)) as zf:
			names = set(zf.namelist())
			missing = [r for r in required if r not in names]
			if missing:
				raise ValueError(f'archive is missing {", ".join(missing)}')
			meta = json.loads(zf.read('metadata.json'))
	except zipfile.BadZipFile:
		raise ValueError('not a valid archive')
	folder.mkdir(exist_ok=True)
	base = re.sub(r'[^A-Za-z0-9._ -]+', '', str(meta.get('title') or 'import')).strip() or 'import'
	stamp = datetime.datetime.now().strftime('%Y-%m-%d--%H%M%S')
	name = f'{stamp}-{base[:40]}{suffix}'
	n = 1
	while (folder / name).exists():
		n += 1
		name = f'{stamp}-{base[:40]}-{n}{suffix}'
	(folder / name).write_bytes(data)
	return name

HISTORY_DIR = Path('history')
RECIPES_DIR = Path('recipes')
LOGS_DIR = Path('logs')
SAFE_NAME = re.compile(r'^[A-Za-z0-9._ -]+$')


def _safe(name: str, suffix: str) -> str:
	if not SAFE_NAME.match(name) or '..' in name or not name.endswith(suffix):
		raise ValueError(f'invalid file name {name!r}')
	return name


# --------------------------------------------------------------------------
# Cook files
# --------------------------------------------------------------------------


def list_cooks() -> list[dict]:
	"""Metadata for every cook file, newest first."""
	out = []
	if not HISTORY_DIR.exists():
		return out
	for p in sorted(HISTORY_DIR.glob('*.pifire'), reverse=True):
		meta, status = read_json_file_data(str(p), 'metadata', unpackassets=False)
		if status != 'OK' or not isinstance(meta, dict):
			out.append({'filename': p.name, 'title': p.stem, 'error': status, 'size': p.stat().st_size})
			continue
		out.append({
			'filename': p.name,
			'title': meta.get('title') or p.stem,
			'starttime': meta.get('starttime'),
			'endtime': meta.get('endtime'),
			'units': meta.get('units'),
			'thumbnail': meta.get('thumbnail', ''),
			'id': meta.get('id'),
			'version': meta.get('version'),
			'size': p.stat().st_size,
		})
	return out


def read_cook(filename: str) -> dict:
	"""Full cook document (metadata, labels, raw history rows, events, comments, assets)."""
	name = _safe(filename, '.pifire')
	path = HISTORY_DIR / name
	if not path.exists():
		raise FileNotFoundError(name)
	doc: dict = {'filename': name}
	for part in ('metadata', 'graph_labels', 'raw_data', 'events', 'comments', 'assets'):
		data, status = read_json_file_data(str(path), part, unpackassets=False)
		doc[part] = data if status == 'OK' else ([] if part in ('raw_data', 'events', 'comments', 'assets') else {})
	return doc


def update_cook_metadata(filename: str, patch: dict) -> dict:
	name = _safe(filename, '.pifire')
	path = HISTORY_DIR / name
	meta, status = read_json_file_data(str(path), 'metadata', unpackassets=False)
	if status != 'OK':
		raise ValueError(status)
	for k in ('title', 'thumbnail'):
		if k in patch:
			meta[k] = str(patch[k])[:200]
	status = update_json_file_data(meta, str(path), 'metadata')
	if status != 'OK':
		raise ValueError(status)
	return meta


def add_cook_comment(filename: str, text: str, *, when: str | None = None) -> list:
	name = _safe(filename, '.pifire')
	path = HISTORY_DIR / name
	comments, status = read_json_file_data(str(path), 'comments', unpackassets=False)
	if status != 'OK':
		raise ValueError(status)
	now = when or datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
	comments.append({'id': common.generate_uuid(), 'text': text[:5000], 'date': now[:10], 'time': now[11:16], 'edited': '', 'assets': []})
	status = update_json_file_data(comments, str(path), 'comments')
	if status != 'OK':
		raise ValueError(status)
	return comments


def delete_cook(filename: str) -> None:
	name = _safe(filename, '.pifire')
	(HISTORY_DIR / name).unlink()


def read_cook_asset(filename: str, asset_id: str, *, thumb: bool = False) -> tuple[bytes, str]:
	"""Return (bytes, content_type) for an image stored inside a cook file."""
	return read_image_asset(HISTORY_DIR / _safe(filename, '.pifire'), asset_id, thumb=thumb)


def add_cook_photo(filename: str, data: bytes, *, comment_id: str | None = None, as_thumbnail: bool = False) -> dict:
	"""Attach a photo to a cook, optionally to one of its notes and/or as the cook's cover image."""
	path = HISTORY_DIR / _safe(filename, '.pifire')
	if not path.exists():
		raise FileNotFoundError(filename)
	asset = add_image_asset(path, data)
	if comment_id:
		comments = _read_part(path, 'comments', [])
		for c in comments:
			if c.get('id') == comment_id:
				c.setdefault('assets', []).append(asset['id'])
		_write_part(path, 'comments', comments)
	if as_thumbnail:
		meta = _read_part(path, 'metadata', {})
		meta['thumbnail'] = asset['filename']
		_write_part(path, 'metadata', meta)
	return asset


def delete_cook_photo(filename: str, asset_id: str) -> None:
	remove_image_asset(HISTORY_DIR / _safe(filename, '.pifire'), asset_id)


def set_cook_thumbnail(filename: str, asset_id: str | None) -> dict:
	path = HISTORY_DIR / _safe(filename, '.pifire')
	meta = _read_part(path, 'metadata', None)
	if meta is None:
		raise FileNotFoundError(filename)
	if asset_id:
		asset = next((a for a in _read_part(path, 'assets', []) if a['id'] == asset_id), None)
		if not asset:
			raise FileNotFoundError(asset_id)
		meta['thumbnail'] = asset['filename']
	else:
		meta['thumbnail'] = ''
	_write_part(path, 'metadata', meta)
	return meta


def update_cook_comment(filename: str, comment_id: str, text: str) -> list:
	path = HISTORY_DIR / _safe(filename, '.pifire')
	comments = _read_part(path, 'comments', None)
	if comments is None:
		raise FileNotFoundError(filename)
	for c in comments:
		if c.get('id') == comment_id:
			c['text'] = text[:5000]
			c['edited'] = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
			break
	else:
		raise FileNotFoundError(comment_id)
	_write_part(path, 'comments', comments)
	return comments


def delete_cook_comment(filename: str, comment_id: str) -> list:
	path = HISTORY_DIR / _safe(filename, '.pifire')
	comments = _read_part(path, 'comments', None)
	if comments is None:
		raise FileNotFoundError(filename)
	keep = [c for c in comments if c.get('id') != comment_id]
	if len(keep) == len(comments):
		raise FileNotFoundError(comment_id)
	_write_part(path, 'comments', keep)
	return keep


def export_cook(filename: str) -> tuple[bytes, str]:
	name = _safe(filename, '.pifire')
	path = HISTORY_DIR / name
	if not path.exists():
		raise FileNotFoundError(name)
	return path.read_bytes(), name


def import_cook(data: bytes) -> str:
	return _import_archive(data, HISTORY_DIR, '.pifire', ('metadata.json', 'raw_data.json'))


def cook_rows(doc: dict) -> list[dict]:
	"""raw_data rows in the same shape as live history rows (T,P,F,PSP,NT,AUX)."""
	return [r for r in doc.get('raw_data', []) if isinstance(r, dict) and 'T' in r]


# --------------------------------------------------------------------------
# Pellets
# --------------------------------------------------------------------------


def _now_str() -> str:
	return str(datetime.datetime.now())[0:19]


def pellets() -> dict:
	return common.read_pellet_db()


def load_pellet_profile(profile_id: str) -> dict:
	db = common.read_pellet_db()
	if profile_id not in db['archive']:
		raise KeyError(profile_id)
	now = _now_str()
	db['current'].update({'pelletid': profile_id, 'est_usage': 0, 'date_loaded': now})
	db.setdefault('log', {})[now] = profile_id
	common.write_pellet_db(db)
	common.write_control({'hopper_check': True}, origin='api')
	return db


def upsert_pellet_profile(profile: dict, *, load: bool = False) -> dict:
	db = common.read_pellet_db()
	pid = profile.get('id') or ''.join(filter(str.isalnum, str(datetime.datetime.now())))
	# Timestamp ids can collide on coarse clocks (Windows ~15 ms); make sure the id is new.
	if not profile.get('id'):
		base = pid
		n = 1
		while pid in db['archive']:
			pid = f'{base}{n:02d}'
			n += 1
	entry = {
		'id': pid, 'brand': str(profile.get('brand', 'Generic'))[:60], 'wood': str(profile.get('wood', 'Blend'))[:60],
		'rating': max(0, min(5, int(profile.get('rating', 4)))), 'comments': str(profile.get('comments', ''))[:2000],
	}
	db['archive'][pid] = entry
	for key, value in (('brands', entry['brand']), ('woods', entry['wood'])):
		if value not in db.setdefault(key, []):
			db[key].append(value)
	common.write_pellet_db(db)
	if load:
		return load_pellet_profile(pid)
	return db


def delete_pellet_profile(profile_id: str) -> dict:
	db = common.read_pellet_db()
	if profile_id == db['current']['pelletid']:
		raise ValueError('Cannot delete the profile that is currently loaded.')
	db['archive'].pop(profile_id, None)
	common.write_pellet_db(db)
	return db


def set_pellet_lists(*, brands: list[str] | None = None, woods: list[str] | None = None) -> dict:
	db = common.read_pellet_db()
	if brands is not None:
		db['brands'] = sorted({str(b)[:60] for b in brands if str(b).strip()})
	if woods is not None:
		db['woods'] = sorted({str(w)[:60] for w in woods if str(w).strip()})
	common.write_pellet_db(db)
	return db


def delete_pellet_log_entry(when: str) -> dict:
	db = common.read_pellet_db()
	db.get('log', {}).pop(when, None)
	common.write_pellet_db(db)
	return db


# --------------------------------------------------------------------------
# Recipes
# --------------------------------------------------------------------------


def list_recipes() -> list[dict]:
	out = []
	if not RECIPES_DIR.exists():
		return out
	for p in sorted(RECIPES_DIR.glob('*.pfrecipe')):
		meta, status = read_json_file_data(str(p), 'metadata', unpackassets=False)
		if status != 'OK' or not isinstance(meta, dict):
			out.append({'filename': p.name, 'title': p.stem, 'error': status})
			continue
		comments = _read_part(p, 'comments', []) or []
		rated = [c.get('rating') for c in comments if isinstance(c, dict) and c.get('rating')]
		out.append({
			'filename': p.name, 'title': meta.get('title') or p.stem, 'author': meta.get('author', ''),
			'comment_rating': round(sum(rated) / len(rated), 1) if rated else None, 'comments': len(comments),
			'description': meta.get('description', ''), 'rating': meta.get('rating', 0), 'prep_time': meta.get('prep_time', 0),
			'cook_time': meta.get('cook_time', 0), 'difficulty': meta.get('difficulty', ''), 'thumbnail': meta.get('thumbnail', ''),
			'id': meta.get('id'), 'units': meta.get('units'),
		})
	return out


def read_recipe(filename: str) -> dict:
	name = _safe(filename, '.pfrecipe')
	path = RECIPES_DIR / name
	if not path.exists():
		raise FileNotFoundError(name)
	doc: dict = {'filename': name}
	for part in ('metadata', 'recipe', 'comments', 'assets'):
		data, status = read_json_file_data(str(path), part, unpackassets=False)
		doc[part] = data if status == 'OK' else ({} if part in ('metadata', 'recipe') else [])
	return doc


def write_recipe_part(filename: str, part: str, data) -> None:
	if part not in ('metadata', 'recipe', 'comments'):
		raise ValueError(part)
	name = _safe(filename, '.pfrecipe')
	status = update_json_file_data(data, str(RECIPES_DIR / name), part)
	if status != 'OK':
		raise ValueError(status)


def create_recipe(title: str = '') -> str:
	"""Create a new empty recipe file (metadata + default steps) and return its filename."""
	from file_mgmt.recipes import _default_recipe_metadata, _default_recipe_steps

	RECIPES_DIR.mkdir(exist_ok=True)
	stamp = datetime.datetime.now().strftime('%Y-%m-%d--%H%M%S')
	name = f'{stamp}-Recipe.pfrecipe'
	meta = _default_recipe_metadata()
	meta['title'] = title[:80]
	recipe = {'ingredients': [], 'instructions': [], 'steps': _default_recipe_steps()}
	with zipfile.ZipFile(RECIPES_DIR / name, 'w', zipfile.ZIP_DEFLATED) as zf:
		zf.writestr('metadata.json', json.dumps(meta, indent=2, sort_keys=True))
		zf.writestr('recipe.json', json.dumps(recipe, indent=2, sort_keys=True))
		zf.writestr('comments.json', json.dumps([]))
		zf.writestr('assets.json', json.dumps([]))
	return name


def delete_recipe(filename: str) -> None:
	(RECIPES_DIR / _safe(filename, '.pfrecipe')).unlink()


def read_recipe_asset(filename: str, asset_id: str, *, thumb: bool = False) -> tuple[bytes, str]:
	return read_image_asset(RECIPES_DIR / _safe(filename, '.pfrecipe'), asset_id, thumb=thumb)


def add_recipe_photo(filename: str, data: bytes, *, target: str | None = None, index: int | None = None, as_cover: bool = False) -> dict:
	"""Attach a photo to a recipe: the cover image, or an ingredient / instruction row (target + index)."""
	path = RECIPES_DIR / _safe(filename, '.pfrecipe')
	if not path.exists():
		raise FileNotFoundError(filename)
	asset = add_image_asset(path, data)
	if as_cover:
		meta = _read_part(path, 'metadata', {})
		meta['image'] = asset['filename']
		meta['thumbnail'] = asset['filename']
		_write_part(path, 'metadata', meta)
	if target == 'comments' and index is not None:
		comments = _read_part(path, 'comments', [])
		if 0 <= index < len(comments):
			comments[index].setdefault('assets', []).append(asset['id'])
			_write_part(path, 'comments', comments)
	elif target in ('ingredients', 'instructions') and index is not None:
		rec = _read_part(path, 'recipe', {})
		rows = rec.get(target, [])
		if 0 <= index < len(rows):
			rows[index].setdefault('assets', []).append(asset['id'])
			_write_part(path, 'recipe', rec)
	return asset


def add_recipe_comment(filename: str, text: str, rating: int | None = None, username: str = '') -> list:
	"""Append a comment (docs.pifire.io recipe format: text, rating 0-5, date/time, assets)."""
	path = RECIPES_DIR / _safe(filename, '.pfrecipe')
	comments = _read_part(path, 'comments', None)
	if comments is None:
		raise FileNotFoundError(filename)
	now = datetime.datetime.now()
	comments.append({'id': common.generate_uuid(), 'username': username[:60], 'text': text[:5000], 'rating': max(0, min(5, int(rating or 0))),
					 'date': now.strftime('%Y-%m-%d'), 'time': now.strftime('%H:%M'), 'edited': '', 'assets': []})
	_write_part(path, 'comments', comments)
	return comments


def delete_recipe_comment(filename: str, comment_id: str) -> list:
	path = RECIPES_DIR / _safe(filename, '.pfrecipe')
	comments = _read_part(path, 'comments', None)
	if comments is None:
		raise FileNotFoundError(filename)
	keep = [c for c in comments if c.get('id') != comment_id]
	if len(keep) == len(comments):
		raise FileNotFoundError(comment_id)
	_write_part(path, 'comments', keep)
	return keep


def delete_recipe_photo(filename: str, asset_id: str) -> None:
	remove_image_asset(RECIPES_DIR / _safe(filename, '.pfrecipe'), asset_id, recipe=True)


def export_recipe(filename: str) -> tuple[bytes, str]:
	name = _safe(filename, '.pfrecipe')
	path = RECIPES_DIR / name
	if not path.exists():
		raise FileNotFoundError(name)
	return path.read_bytes(), name


def import_recipe(data: bytes) -> str:
	return _import_archive(data, RECIPES_DIR, '.pfrecipe', ('metadata.json', 'recipe.json'))


# --------------------------------------------------------------------------
# Metrics
# --------------------------------------------------------------------------

METRIC_COLUMNS = ('mode', 'starttime', 'endtime', 'duration_s', 'augerontime', 'auger_pct', 'est_usage_g', 'fanontime', 'smokeplus',
				  'primary_setpoint', 'p_mode', 'auger_cycle_time', 'smart_start_profile', 'startup_temp', 'pellet_level_start',
				  'pellet_level_end', 'pellet_brand_type')


def cook_metrics() -> list[dict]:
	"""The control loop's per-mode metrics for the current (or last) cook, with derived duration, auger duty and pellet usage."""
	settings = common.read_settings()
	rate = float(settings['globals'].get('augerrate', 0.3))
	out = []
	for m in common.read_metrics(all=True):
		start, end = m.get('starttime', 0) or 0, m.get('endtime', 0) or 0
		duration = (end - start) / 1000 if start and end else None
		auger = float(m.get('augerontime', 0) or 0)
		row = {k: m.get(k) for k in METRIC_COLUMNS if k in m}
		row.update({
			'mode': m.get('mode', ''), 'starttime': start, 'endtime': end or None, 'duration_s': duration,
			'augerontime': round(auger, 1), 'auger_pct': round(100 * auger / duration, 1) if duration else None,
			'est_usage_g': round(auger * rate), 'fanontime': round(float(m.get('fanontime', 0) or 0), 1),
		})
		out.append(row)
	return out


def metrics_csv(rows: list[dict]) -> str:
	import csv

	buf = io.StringIO()
	w = csv.DictWriter(buf, fieldnames=list(METRIC_COLUMNS), extrasaction='ignore', lineterminator=chr(10))
	w.writeheader()
	for r in rows:
		r = dict(r)
		for k in ('starttime', 'endtime'):
			if r.get(k):
				r[k] = datetime.datetime.fromtimestamp(r[k] / 1000).strftime('%Y-%m-%d %H:%M:%S')
		w.writerow(r)
	return buf.getvalue()


# --------------------------------------------------------------------------
# Logs
# --------------------------------------------------------------------------


def list_logs() -> list[dict]:
	if not LOGS_DIR.exists():
		return []
	return [{'name': p.name, 'size': p.stat().st_size, 'modified': p.stat().st_mtime} for p in sorted(LOGS_DIR.glob('*.log'))]


def tail_log(name: str, lines: int = 200) -> list[str]:
	name = _safe(name, '.log')
	path = LOGS_DIR / name
	if not path.exists():
		raise FileNotFoundError(name)
	with open(path, 'rb') as f:
		f.seek(0, os.SEEK_END)
		size = f.tell()
		chunk = min(size, max(4096, lines * 200))
		f.seek(size - chunk)
		text = f.read().decode('utf-8', errors='replace')
	return text.splitlines()[-lines:]


# --------------------------------------------------------------------------
# System info (PiFire's Admin → System Info / GPIO summary)
# --------------------------------------------------------------------------


def network_info() -> dict:
	"""Hostname, IPv4 addresses per interface and WiFi link quality (Linux /proc/net/wireless; None elsewhere)."""
	import socket

	out: dict = {'hostname': socket.gethostname(), 'interfaces': [], 'wifi': None}
	try:
		import psutil

		stats = psutil.net_if_stats()
		for name, addrs in psutil.net_if_addrs().items():
			if name.startswith(('lo', 'docker', 'veth', 'br-')):
				continue
			ips = [a.address for a in addrs if a.family == socket.AF_INET]
			if ips:
				out['interfaces'].append({'name': name, 'ip': ips[0], 'up': stats.get(name).isup if name in stats else None})
	except Exception:  # noqa: BLE001 - psutil missing or odd platform: leave the list empty
		pass
	try:
		with open('/proc/net/wireless', encoding='utf-8') as f:
			for line in f.read().splitlines()[2:]:
				parts = line.replace(':', ' ').split()
				if len(parts) >= 4:
					quality, level = float(parts[2]), float(parts[3])
					out['wifi'] = {'interface': parts[0], 'quality_percent': round(quality / 70 * 100) if quality <= 70 else None, 'signal_dbm': int(level)}
					break
	except OSError:
		pass
	return out


def gpio_summary(settings: dict) -> list[dict]:
	"""Every configured pin: outputs (relays, fan), inputs (buttons, encoder) and device pins (displays, sensors)."""
	platform = settings.get('platform', {})
	rows = []
	for group in ('outputs', 'inputs', 'devices'):
		for name, pin in (platform.get(group) or {}).items():
			if isinstance(pin, dict):
				for sub, p in pin.items():
					rows.append({'group': group, 'name': f'{name}.{sub}', 'pin': p})
			else:
				rows.append({'group': group, 'name': name, 'pin': pin})
	return rows


# --------------------------------------------------------------------------
# Maintenance (PiFire's Admin → data management)
# --------------------------------------------------------------------------

MAINTENANCE_ACTIONS = ('history', 'events', 'pellet_log', 'pellet_db', 'logs')


def clear_data(what: str) -> None:
	"""Delete one kind of runtime data. Settings and cook files are never touched here."""
	if what == 'history':
		common.write_log('Clearing history.')
		common.read_history(0, flushhistory=True)
	elif what == 'events':
		p = LOGS_DIR / 'events.log'
		if p.exists():
			p.write_text('')
		common.write_log('Events log cleared.')
	elif what == 'pellet_log':
		common.write_log('Clearing pellet log.')
		db = common.read_pellet_db()
		db['log'] = {}
		common.write_pellet_db(db)
	elif what == 'pellet_db':
		common.write_log('Resetting pellet database to defaults.')
		common.write_pellet_db(common.default_pellets())
	elif what == 'logs':
		for p in LOGS_DIR.glob('*.log*'):
			if p.name == 'events.log':
				p.write_text('')
			else:
				try:
					p.unlink()
				except OSError:
					p.write_text('')
		common.write_log('Log files deleted.')
	else:
		raise ValueError(f'unknown data set {what!r}')


def export_logs() -> tuple[bytes, str]:
	"""Zip of every log file, for support requests."""
	buf = io.BytesIO()
	with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
		for p in sorted(LOGS_DIR.glob('*.log*')) if LOGS_DIR.exists() else []:
			zf.write(p, arcname=p.name)
	stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
	return buf.getvalue(), f'fireai-logs-{stamp}.zip'


def export_debug_bundle() -> tuple[bytes, str]:
	"""Settings (secrets redacted), control, status, current, versions, errors and the events log in one zip."""
	from core import state as core_state
	from core.settings_schema import redact

	buf = io.BytesIO()
	with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
		zf.writestr('settings.json', json.dumps(redact(common.read_settings()), indent=2))
		zf.writestr('control.json', json.dumps(common.read_control(), indent=2, default=str))
		zf.writestr('status.json', json.dumps(common.read_status(), indent=2, default=str))
		zf.writestr('current.json', json.dumps(common.read_current() or {}, indent=2, default=str))
		zf.writestr('pelletdb.json', json.dumps(common.read_pellet_db(), indent=2))
		try:
			zf.writestr('state.json', json.dumps(core_state.snapshot(), indent=2, default=str))
		except Exception as e:  # noqa: BLE001 - the bundle is for diagnosing exactly this kind of failure
			zf.writestr('state.error.txt', repr(e))
		zf.writestr('errors.json', json.dumps(common.read_errors(), indent=2))
		try:
			zf.writestr('probe_device_info.json', json.dumps(redact({'d': common.read_generic_key('probe_device_info') or []})['d'], indent=2))
		except Exception:  # noqa: BLE001
			pass
		for name in ('events.log', 'control.log', 'server.log'):
			p = LOGS_DIR / name
			if p.exists():
				zf.writestr(name, '\n'.join(tail_log(name, 2000)))
	stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
	return buf.getvalue(), f'fireai-debug-{stamp}.zip'


def factory_reset() -> None:
	"""Back to defaults: settings, pellet database, control state and history. Cook files and recipes stay.

	The next start of the app goes through the first-run wizard; the admin password is kept so the grill
	is not left open on the network."""
	common.write_log('Resetting settings, control and history to factory defaults.')
	auth_block = common.read_settings().get('server', {}).get('auth', {})
	common.read_history(0, flushhistory=True)
	common.read_control(flush=True)
	settings = common.default_settings()
	settings.setdefault('server', {})['auth'] = auth_block
	settings['globals']['first_time_setup'] = True
	common.write_settings(settings)
	common.write_pellet_db(common.default_pellets())
	common.write_control(common.default_control(), origin='app')


# --------------------------------------------------------------------------
# Backups
# --------------------------------------------------------------------------


def export_backup() -> tuple[bytes, str]:
	"""Zip of settings.json + pelletdb.json (secrets included: this is the owner's backup)."""
	buf = io.BytesIO()
	with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
		zf.writestr('settings.json', json.dumps(common.read_settings(), indent=2))
		zf.writestr('pelletdb.json', json.dumps(common.read_pellet_db(), indent=2))
	stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
	return buf.getvalue(), f'fireai-backup-{stamp}.zip'


def import_backup(data: bytes) -> dict:
	"""Restore settings and/or pellet DB from a backup zip or a bare settings.json."""
	restored = []
	try:
		with zipfile.ZipFile(io.BytesIO(data)) as zf:
			names = set(zf.namelist())
			if 'settings.json' in names:
				_restore_settings(json.loads(zf.read('settings.json')))
				restored.append('settings')
			if 'pelletdb.json' in names:
				db = json.loads(zf.read('pelletdb.json'))
				if 'archive' in db and 'current' in db:
					common.write_pellet_db(db)
					restored.append('pelletdb')
	except zipfile.BadZipFile:
		doc = json.loads(data)
		if 'globals' in doc and 'probe_settings' in doc:
			_restore_settings(doc)
			restored.append('settings')
		elif 'archive' in doc and 'current' in doc:
			common.write_pellet_db(doc)
			restored.append('pelletdb')
	if not restored:
		raise ValueError('No settings or pellet database found in the upload.')
	return {'restored': restored}


def _restore_settings(doc: dict) -> None:
	# Keep this device's own auth block and cloud credentials context; everything else comes from the backup.
	current = common.read_settings()
	doc['server'] = current.get('server', {})
	common.write_settings(doc)
	common.read_settings(init=True)  # runs the upgrade/overlay path on the restored file
	common.write_control({'settings_update': True, 'probe_profile_update': True}, origin='api')
