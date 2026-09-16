"""Cooks, pellets, recipes, logs, backup and system endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, Field

from common import common
from core import library
from core import state as core_state
from server import auth
from server.deps import current_principal, require_admin

router = APIRouter(prefix='/api/v1', tags=['library'])


def _nf(name):
	return HTTPException(status.HTTP_404_NOT_FOUND, detail={'code': 'not_found', 'message': str(name)})


def _bad(msg):
	return HTTPException(status.HTTP_400_BAD_REQUEST, detail={'code': 'invalid', 'message': str(msg)})


# ----- cooks -------------------------------------------------------------


class CookMetaPatch(BaseModel):
	title: str | None = None
	thumbnail: str | None = None


class CommentBody(BaseModel):
	text: str = Field(min_length=1, max_length=5000)


@router.get('/cooks')
def cooks(_: auth.Principal = Depends(current_principal)):
	return {'cooks': library.list_cooks()}


@router.get('/cooks/{filename}')
def cook(filename: str, _: auth.Principal = Depends(current_principal)):
	try:
		return library.read_cook(filename)
	except FileNotFoundError:
		raise _nf(filename)
	except ValueError as e:
		raise _bad(e)


@router.patch('/cooks/{filename}')
def cook_patch(filename: str, body: CookMetaPatch, _: auth.Principal = Depends(current_principal)):
	try:
		return library.update_cook_metadata(filename, body.model_dump(exclude_none=True))
	except (FileNotFoundError, ValueError) as e:
		raise _bad(e)


@router.post('/cooks/{filename}/comments')
def cook_comment(filename: str, body: CommentBody, _: auth.Principal = Depends(current_principal)):
	try:
		return {'comments': library.add_cook_comment(filename, body.text)}
	except (FileNotFoundError, ValueError) as e:
		raise _bad(e)


@router.delete('/cooks/{filename}')
def cook_delete(filename: str, _: auth.Principal = Depends(require_admin)):
	try:
		library.delete_cook(filename)
	except FileNotFoundError:
		raise _nf(filename)
	except ValueError as e:
		raise _bad(e)
	return {'ok': True}


@router.get('/cooks/{filename}/assets/{asset_id}')
def cook_asset(filename: str, asset_id: str, thumb: bool = False, _: auth.Principal = Depends(current_principal)):
	try:
		data, ctype = library.read_cook_asset(filename, asset_id, thumb=thumb)
	except (FileNotFoundError, KeyError, ValueError):
		raise _nf(asset_id)
	return Response(content=data, media_type=ctype, headers={'Cache-Control': 'public, max-age=86400'})


MAX_UPLOAD = 25 * 1024 * 1024


async def _read_upload(file: UploadFile) -> bytes:
	data = await file.read(MAX_UPLOAD + 1)
	if len(data) > MAX_UPLOAD:
		raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, {'code': 'too_large', 'message': 'File is larger than 25 MB'})
	return data


@router.post('/cooks/{filename}/assets', status_code=status.HTTP_201_CREATED)
async def cook_photo(filename: str, file: UploadFile = File(...), comment_id: str | None = Query(default=None), thumbnail: bool = False,
					 _: auth.Principal = Depends(current_principal)):
	data = await _read_upload(file)
	try:
		return library.add_cook_photo(filename, data, comment_id=comment_id, as_thumbnail=thumbnail)
	except FileNotFoundError as e:
		raise _nf(e)
	except ValueError as e:
		raise _bad(e)


@router.delete('/cooks/{filename}/assets/{asset_id}')
def cook_photo_delete(filename: str, asset_id: str, _: auth.Principal = Depends(current_principal)):
	try:
		library.delete_cook_photo(filename, asset_id)
	except FileNotFoundError as e:
		raise _nf(e)
	except ValueError as e:
		raise _bad(e)
	return {'ok': True}


class ThumbnailBody(BaseModel):
	asset_id: str | None = None


@router.put('/cooks/{filename}/thumbnail')
def cook_thumbnail(filename: str, body: ThumbnailBody, _: auth.Principal = Depends(current_principal)):
	try:
		return library.set_cook_thumbnail(filename, body.asset_id)
	except FileNotFoundError as e:
		raise _nf(e)
	except ValueError as e:
		raise _bad(e)


@router.put('/cooks/{filename}/comments/{comment_id}')
def cook_comment_edit(filename: str, comment_id: str, body: CommentBody, _: auth.Principal = Depends(current_principal)):
	try:
		return {'comments': library.update_cook_comment(filename, comment_id, body.text)}
	except FileNotFoundError as e:
		raise _nf(e)
	except ValueError as e:
		raise _bad(e)


@router.delete('/cooks/{filename}/comments/{comment_id}')
def cook_comment_delete(filename: str, comment_id: str, _: auth.Principal = Depends(current_principal)):
	try:
		return {'comments': library.delete_cook_comment(filename, comment_id)}
	except FileNotFoundError as e:
		raise _nf(e)
	except ValueError as e:
		raise _bad(e)


@router.get('/cooks/{filename}/download')
def cook_download(filename: str, _: auth.Principal = Depends(current_principal)):
	try:
		data, name = library.export_cook(filename)
	except (FileNotFoundError, ValueError) as e:
		raise _nf(e)
	return Response(content=data, media_type='application/zip', headers={'Content-Disposition': f'attachment; filename="{name}"'})


@router.post('/cooks/import', status_code=status.HTTP_201_CREATED)
async def cook_import(file: UploadFile = File(...), _: auth.Principal = Depends(current_principal)):
	data = await _read_upload(file)
	try:
		return {'filename': library.import_cook(data)}
	except ValueError as e:
		raise _bad(e)


# ----- pellets -----------------------------------------------------------


class PelletProfileBody(BaseModel):
	id: str | None = None
	brand: str = Field(min_length=1, max_length=60)
	wood: str = Field(min_length=1, max_length=60)
	rating: int = Field(ge=0, le=5, default=4)
	comments: str = Field(default='', max_length=2000)
	load: bool = False


class PelletListsBody(BaseModel):
	brands: list[str] | None = None
	woods: list[str] | None = None


@router.get('/pellets')
def pellets_get(_: auth.Principal = Depends(current_principal)):
	return library.pellets()


@router.post('/pellets/load/{profile_id}')
def pellets_load(profile_id: str, _: auth.Principal = Depends(current_principal)):
	try:
		return library.load_pellet_profile(profile_id)
	except KeyError:
		raise _nf(profile_id)


@router.put('/pellets/profiles')
def pellets_upsert(body: PelletProfileBody, _: auth.Principal = Depends(current_principal)):
	return library.upsert_pellet_profile(body.model_dump(exclude={'load'}), load=body.load)


@router.delete('/pellets/profiles/{profile_id}')
def pellets_delete(profile_id: str, _: auth.Principal = Depends(current_principal)):
	try:
		return library.delete_pellet_profile(profile_id)
	except ValueError as e:
		raise HTTPException(status.HTTP_409_CONFLICT, detail={'code': 'in_use', 'message': str(e)})


@router.put('/pellets/lists')
def pellets_lists(body: PelletListsBody, _: auth.Principal = Depends(current_principal)):
	return library.set_pellet_lists(brands=body.brands, woods=body.woods)


@router.delete('/pellets/log/{when}')
def pellets_log_delete(when: str, _: auth.Principal = Depends(current_principal)):
	return library.delete_pellet_log_entry(when)


# ----- recipes -----------------------------------------------------------


class RecipePartBody(BaseModel):
	part: str
	data: dict | list


@router.get('/recipes')
def recipes(_: auth.Principal = Depends(current_principal)):
	return {'recipes': library.list_recipes()}


class NewRecipeBody(BaseModel):
	title: str = Field(default='', max_length=80)


@router.post('/recipes')
def recipe_create(body: NewRecipeBody, _: auth.Principal = Depends(current_principal)):
	return {'filename': library.create_recipe(body.title)}


@router.get('/recipes/{filename}')
def recipe(filename: str, _: auth.Principal = Depends(current_principal)):
	try:
		return library.read_recipe(filename)
	except FileNotFoundError:
		raise _nf(filename)
	except ValueError as e:
		raise _bad(e)


@router.put('/recipes/{filename}')
def recipe_put(filename: str, body: RecipePartBody, _: auth.Principal = Depends(current_principal)):
	try:
		library.write_recipe_part(filename, body.part, body.data)
	except (FileNotFoundError, ValueError) as e:
		raise _bad(e)
	return {'ok': True}


@router.delete('/recipes/{filename}')
def recipe_delete(filename: str, _: auth.Principal = Depends(require_admin)):
	try:
		library.delete_recipe(filename)
	except FileNotFoundError:
		raise _nf(filename)
	except ValueError as e:
		raise _bad(e)
	return {'ok': True}


@router.get('/recipes/{filename}/assets/{asset_id}')
def recipe_asset(filename: str, asset_id: str, thumb: bool = False, _: auth.Principal = Depends(current_principal)):
	try:
		data, ctype = library.read_recipe_asset(filename, asset_id, thumb=thumb)
	except (FileNotFoundError, KeyError, ValueError):
		raise _nf(asset_id)
	return Response(content=data, media_type=ctype, headers={'Cache-Control': 'public, max-age=86400'})


@router.post('/recipes/{filename}/assets', status_code=status.HTTP_201_CREATED)
async def recipe_photo(filename: str, file: UploadFile = File(...), target: str | None = Query(default=None), index: int | None = Query(default=None),
					   cover: bool = False, _: auth.Principal = Depends(current_principal)):
	data = await _read_upload(file)
	try:
		return library.add_recipe_photo(filename, data, target=target, index=index, as_cover=cover)
	except FileNotFoundError as e:
		raise _nf(e)
	except ValueError as e:
		raise _bad(e)


@router.delete('/recipes/{filename}/assets/{asset_id}')
def recipe_photo_delete(filename: str, asset_id: str, _: auth.Principal = Depends(current_principal)):
	try:
		library.delete_recipe_photo(filename, asset_id)
	except FileNotFoundError as e:
		raise _nf(e)
	except ValueError as e:
		raise _bad(e)
	return {'ok': True}


@router.get('/recipes/{filename}/download')
def recipe_download(filename: str, _: auth.Principal = Depends(current_principal)):
	try:
		data, name = library.export_recipe(filename)
	except (FileNotFoundError, ValueError) as e:
		raise _nf(e)
	return Response(content=data, media_type='application/zip', headers={'Content-Disposition': f'attachment; filename="{name}"'})


@router.post('/recipes/import', status_code=status.HTTP_201_CREATED)
async def recipe_import(file: UploadFile = File(...), _: auth.Principal = Depends(current_principal)):
	data = await _read_upload(file)
	try:
		return {'filename': library.import_recipe(data)}
	except ValueError as e:
		raise _bad(e)


# ----- logs / system -----------------------------------------------------


@router.get('/logs')
def logs(_: auth.Principal = Depends(current_principal)):
	return {'logs': library.list_logs()}


@router.get('/logs/{name}')
def log_tail(name: str, lines: int = Query(default=200, ge=1, le=5000), _: auth.Principal = Depends(current_principal)):
	try:
		return {'name': name, 'lines': library.tail_log(name, lines)}
	except FileNotFoundError:
		raise _nf(name)
	except ValueError as e:
		raise _bad(e)


@router.get('/system/backup')
def backup(_: auth.Principal = Depends(require_admin)):
	data, name = library.export_backup()
	return Response(content=data, media_type='application/zip', headers={'Content-Disposition': f'attachment; filename="{name}"'})


@router.post('/system/restore')
async def restore(file: UploadFile = File(...), _: auth.Principal = Depends(require_admin)):
	data = await file.read()
	if len(data) > 20 * 1024 * 1024:
		raise _bad('Backup too large')
	try:
		result = library.import_backup(data)
	except ValueError as e:
		raise _bad(e)
	core_state.invalidate_settings_cache()
	return result


@router.get('/system/info')
def system_info(_: auth.Principal = Depends(current_principal)):
	s = common.read_settings()
	try:
		import platform

		import psutil

		info = {
			'python': platform.python_version(), 'platform': platform.platform(),
			'cpu_percent': psutil.cpu_percent(interval=None), 'memory_percent': psutil.virtual_memory().percent,
			'disk_percent': psutil.disk_usage('.').percent, 'uptime_s': int(__import__('time').time() - psutil.boot_time()),
		}
	except Exception:
		info = {}
	return {'version': s['versions'], 'modules': s['modules'], 'board': s.get('platform', {}).get('current'), 'system': info}


# ----- updates -----------------------------------------------------------


@router.get('/system/update/check')
def update_check(_: auth.Principal = Depends(current_principal)):
	from core import updater

	try:
		return updater.check()
	except Exception as e:
		raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail={'code': 'update_check_failed', 'message': str(e)})


@router.post('/system/update/apply', status_code=status.HTTP_202_ACCEPTED)
def update_apply(_: auth.Principal = Depends(require_admin)):
	from core import updater

	control = common.read_control()
	if control.get('mode') not in ('Stop', 'Error', None):
		raise _bad('Stop the grill before updating.')
	if not updater.start_update():
		raise HTTPException(status.HTTP_409_CONFLICT, detail={'code': 'busy', 'message': 'An update is already running.'})
	return updater.status()


@router.get('/system/update/status')
def update_status(_: auth.Principal = Depends(current_principal)):
	from core import updater

	return updater.status()
