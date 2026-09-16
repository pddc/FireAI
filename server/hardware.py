"""Hardware configuration (wizard) and probe tuner endpoints."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from common import common
from core import bluetooth, hardware, tuner
from core import state as core_state
from server import auth
from server.deps import current_principal, require_admin

router = APIRouter(prefix='/api/v1', tags=['hardware'])


class HardwareSelection(BaseModel):
	grillplatform: dict[str, Any] | None = None
	display: dict[str, Any] | None = None
	distance: dict[str, Any] | None = None
	units: str | None = Field(default=None, pattern='^[CF]$')
	board_probe_map: str | None = None


@router.get('/hardware')
def get_hardware(_: auth.Principal = Depends(current_principal)):
	return hardware.catalogue()


@router.put('/hardware')
def put_hardware(body: HardwareSelection, _: auth.Principal = Depends(require_admin)):
	try:
		result = hardware.apply(body.model_dump(exclude_none=True))
	except (ValueError, KeyError) as e:
		raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={'code': 'invalid', 'message': str(e)})
	core_state.invalidate_settings_cache()
	common.write_control({'settings_update': True}, origin='api')
	return result


@router.post('/hardware/wizard/dismiss')
def dismiss_wizard(_: auth.Principal = Depends(require_admin)):
	"""Skip the first-run wizard (PiFire's wizard 'cancel')."""
	s = common.read_settings()
	s['globals']['first_time_setup'] = False
	common.write_settings(s)
	core_state.invalidate_settings_cache()
	return {'ok': True}


# ----- tuner -------------------------------------------------------------


class ManualFit(BaseModel):
	t1: float
	t2: float
	t3: float
	r1: float = Field(gt=0)
	r2: float = Field(gt=0)
	r3: float = Field(gt=0)


class AutotuneSample(BaseModel):
	probe: str
	reference: str


@router.post('/tuner/fit')
def tuner_fit(body: ManualFit, _: auth.Principal = Depends(current_principal)):
	units = common.read_settings()['globals']['units']
	try:
		a, b, c = tuner.shh_coefficients(body.t1, body.t2, body.t3, body.r1, body.r2, body.r3, units)
	except (ValueError, ZeroDivisionError) as e:
		raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={'code': 'invalid', 'message': f'Could not fit: {e}'})
	return {'a': a, 'b': b, 'c': c, 'curve': tuner.fit_curve(a, b, c, units)}


@router.get('/tuner/tr')
def tuner_tr(_: auth.Principal = Depends(current_principal)):
	return {'tr': common.read_tr() or {}, 'current': common.read_current() or {}, 'tuning_mode': common.read_control().get('tuning_mode', False)}


@router.post('/tuner/auto/start')
def tuner_auto_start(_: auth.Principal = Depends(current_principal)):
	tuner.start_autotune()
	return {'ok': True}


@router.post('/tuner/auto/stop')
def tuner_auto_stop(_: auth.Principal = Depends(current_principal)):
	tuner.stop_autotune()
	return {'ok': True}


@router.post('/tuner/auto/sample')
def tuner_auto_sample(body: AutotuneSample, _: auth.Principal = Depends(current_principal)):
	units = common.read_settings()['globals']['units']
	reading = tuner.record_sample(body.probe, body.reference)
	return {**reading, **tuner.autotune_status(units)}


# ----- bluetooth ---------------------------------------------------------


@router.post('/bluetooth/scan')
async def bluetooth_scan(_: auth.Principal = Depends(current_principal)):
	"""Scan for BLE thermometers via the control process (takes ~6 s)."""
	return await run_in_threadpool(bluetooth.scan)


@router.get('/bluetooth/diagnostics')
async def bluetooth_diagnostics(format: str = 'json', _: auth.Principal = Depends(current_principal)):
	sections = await run_in_threadpool(bluetooth.diagnostics)
	if format == 'text':
		return Response(content=bluetooth.diagnostics_text(sections), media_type='text/plain',
						headers={'Content-Disposition': 'attachment; filename="fireai-bluetooth-diagnostics.txt"'})
	return {'sections': sections}
