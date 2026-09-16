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
