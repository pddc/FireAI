"""Typed command registry: the single entry point for driving the controller.

Every way of changing the grill's behaviour (local API, cloud bridge, future
displays) goes through ``execute(name, args)``. Each command declares a
Pydantic argument model, so the API documents itself and the cloud can
validate a command before it ever reaches the Pi.

Commands are applied by queuing a control-structure patch in Redis, exactly
as the legacy ``process_command`` did; the control process merges the queue
on its next loop iteration. Nothing here talks to hardware.
"""
from __future__ import annotations

import inspect
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from common import common

# --------------------------------------------------------------------------
# Result / errors
# --------------------------------------------------------------------------


class CommandError(Exception):
	"""Raised for a well-formed command that cannot be applied in the current state."""

	def __init__(self, message: str, code: str = 'rejected'):
		super().__init__(message)
		self.code = code


class CommandResult(BaseModel):
	result: Literal['OK', 'ERROR'] = 'OK'
	message: str = 'Command was accepted.'
	data: dict[str, Any] = Field(default_factory=dict)


class NoArgs(BaseModel):
	model_config = ConfigDict(extra='forbid')


@dataclass(frozen=True)
class Command:
	name: str
	args_model: type[BaseModel]
	handler: Callable[..., dict | None]
	description: str
	# Commands the cloud may issue. Anything marked False is local-only
	# (reboot, wizard, etc.) regardless of the cloud opt-in.
	cloud_allowed: bool = True
	# Reserved for future role checks; today every authenticated user is an operator.
	role: Literal['viewer', 'operator', 'admin'] = 'operator'

	def schema(self) -> dict:
		return self.args_model.model_json_schema()


_REGISTRY: dict[str, Command] = {}


def register(name: str, args_model: type[BaseModel] = NoArgs, *, description: str = '', cloud_allowed: bool = True,
			 role: Literal['viewer', 'operator', 'admin'] = 'operator'):
	def deco(fn):
		_REGISTRY[name] = Command(name, args_model, fn, description or (inspect.getdoc(fn) or ''), cloud_allowed, role)
		return fn

	return deco


def registry() -> dict[str, Command]:
	return dict(_REGISTRY)


def describe() -> list[dict]:
	return [
		{'name': c.name, 'description': c.description, 'cloud_allowed': c.cloud_allowed, 'role': c.role, 'args': c.schema()}
		for c in sorted(_REGISTRY.values(), key=lambda c: c.name)
	]


def execute(name: str, args: dict | None = None, *, origin: str = 'api', direct_write: bool = False) -> CommandResult:
	cmd = _REGISTRY.get(name)
	if cmd is None:
		return CommandResult(result='ERROR', message=f'Unknown command: {name}')
	try:
		parsed = cmd.args_model.model_validate(args or {})
	except ValidationError as e:
		return CommandResult(result='ERROR', message=f'Invalid arguments for {name}: {e.errors()[0]["msg"]}',
							 data={'errors': e.errors(include_url=False)})
	try:
		data = cmd.handler(parsed, Ctx(origin=origin, direct_write=direct_write)) or {}
	except CommandError as e:
		return CommandResult(result='ERROR', message=str(e), data={'code': e.code})
	except ValueError as e:
		return CommandResult(result='ERROR', message=str(e), data={'code': 'invalid'})
	return CommandResult(result='OK', message=f'{name} accepted.', data=data)


@dataclass
class Ctx:
	origin: str = 'api'
	direct_write: bool = False

	def patch_control(self, patch: dict) -> None:
		"""Queue a partial control update (or write it directly in tests)."""
		if self.direct_write:
			control = common.read_control()
			common.deep_update(control, patch)
			common.write_control(control, direct_write=True, origin=self.origin)
		else:
			common.write_control(patch, direct_write=False, origin=self.origin)

	def settings(self) -> dict:
		return common.read_settings()


# --------------------------------------------------------------------------
# Argument models
# --------------------------------------------------------------------------


class HoldArgs(BaseModel):
	model_config = ConfigDict(extra='forbid')
	setpoint: float = Field(gt=0, description='Target pit temperature in the configured units')


class PrimeArgs(BaseModel):
	model_config = ConfigDict(extra='forbid')
	amount: int = Field(ge=1, le=100, description='Grams of pellets to prime')
	next_mode: Literal['Stop', 'Startup', 'Monitor'] = 'Stop'


class SetpointArgs(BaseModel):
	model_config = ConfigDict(extra='forbid')
	setpoint: float = Field(gt=0)


class BoolArgs(BaseModel):
	model_config = ConfigDict(extra='forbid')
	enabled: bool


class PModeArgs(BaseModel):
	model_config = ConfigDict(extra='forbid')
	pmode: int = Field(ge=0, le=9)


class UnitsArgs(BaseModel):
	model_config = ConfigDict(extra='forbid')
	units: Literal['C', 'F']


class TimerStartArgs(BaseModel):
	model_config = ConfigDict(extra='forbid')
	seconds: int = Field(ge=1, le=24 * 3600)
	shutdown: bool = False
	keep_warm: bool = False


class NotifyArgs(BaseModel):
	model_config = ConfigDict(extra='forbid')
	label: str = Field(description='Probe label, "Timer" or "Hopper"')
	kind: Literal['probe', 'probe_limit_high', 'probe_limit_low', 'timer', 'hopper'] = 'probe'
	req: bool | None = None
	target: float | None = Field(default=None, gt=0)
	shutdown: bool | None = None
	keep_warm: bool | None = None
	reignite: bool | None = None


class ManualArgs(BaseModel):
	model_config = ConfigDict(extra='forbid')
	output: Literal['power', 'igniter', 'fan', 'auger']
	on: bool


class ManualPwmArgs(BaseModel):
	model_config = ConfigDict(extra='forbid')
	duty_cycle: int = Field(ge=0, le=100)


class DutyCycleArgs(BaseModel):
	model_config = ConfigDict(extra='forbid')
	duty_cycle: int = Field(ge=0, le=100)


class RecipeStartArgs(BaseModel):
	model_config = ConfigDict(extra='forbid')
	filename: str = Field(pattern=r'^[A-Za-z0-9._ -]+\.pfrecipe$')
	start_step: int = Field(default=0, ge=0, le=50)


class SettingsPatchArgs(BaseModel):
	model_config = ConfigDict(extra='forbid')
	patch: dict[str, Any] = Field(description='Partial settings document, deep-merged')


# --------------------------------------------------------------------------
# Mode commands
# --------------------------------------------------------------------------


def _mode(name: str, mode: str, description: str):
	@register(name, description=description)
	def _handler(args, ctx: Ctx):
		ctx.patch_control({'mode': mode, 'updated': True})

	return _handler


_mode('mode.startup', 'Startup', 'Run the startup (ignition) sequence, then the configured next mode.')
_mode('mode.smoke', 'Smoke', 'Smoke mode: fixed auger duty cycle.')
_mode('mode.shutdown', 'Shutdown', 'Burn off remaining pellets with the fan on, then stop.')
_mode('mode.stop', 'Stop', 'Stop everything.')
_mode('mode.monitor', 'Monitor', 'Read probes without controlling any outputs.')
_mode('mode.manual', 'Manual', 'Manual output control.')
_mode('mode.reignite', 'Reignite', 'Re-run ignition and return to the previous mode.')


@register('mode.hold', HoldArgs, description='Hold the pit at a setpoint using the selected controller.')
def _hold(args: HoldArgs, ctx: Ctx):
	units = ctx.settings()['globals']['units']
	sp = int(args.setpoint) if units == 'F' else float(args.setpoint)
	ctx.patch_control({'mode': 'Hold', 'primary_setpoint': sp, 'updated': True})
	return {'setpoint': sp}


@register('mode.prime', PrimeArgs, description='Feed a fixed amount of pellets into the firepot, then continue to next_mode.')
def _prime(args: PrimeArgs, ctx: Ctx):
	ctx.patch_control({'mode': 'Prime', 'prime_amount': args.amount, 'next_mode': args.next_mode, 'updated': True})


# --------------------------------------------------------------------------
# Setpoints and toggles
# --------------------------------------------------------------------------


@register('setpoint', SetpointArgs, description='Change the hold setpoint (switches to Hold mode).')
def _setpoint(args: SetpointArgs, ctx: Ctx):
	return _hold(HoldArgs(setpoint=args.setpoint), ctx)


@register('smoke_plus', BoolArgs, description='Enable or disable Smoke Plus fan cycling.')
def _splus(args: BoolArgs, ctx: Ctx):
	ctx.patch_control({'s_plus': args.enabled})


@register('pwm_control', BoolArgs, description='Enable or disable temperature-based PWM fan control (DC fans).')
def _pwm_control(args: BoolArgs, ctx: Ctx):
	ctx.patch_control({'pwm_control': args.enabled})


@register('duty_cycle', DutyCycleArgs, description='Set the DC fan duty cycle used while PWM control is off.')
def _duty_cycle(args: DutyCycleArgs, ctx: Ctx):
	ctx.patch_control({'duty_cycle': args.duty_cycle})


@register('pmode', PModeArgs, description='Set the P-Mode (extra auger off time in smoke/startup).')
def _pmode(args: PModeArgs, ctx: Ctx):
	s = ctx.settings()
	s['cycle_data']['PMode'] = args.pmode
	common.write_settings(s)
	ctx.patch_control({'settings_update': True})


@register('units', UnitsArgs, description='Switch global temperature units. Stops the current cook.')
def _units(args: UnitsArgs, ctx: Ctx):
	s = common.convert_settings_units(args.units, ctx.settings())
	common.write_settings(s)
	ctx.patch_control({'settings_update': True, 'updated': True, 'units_change': True})


@register('lid_open.toggle', description='Manually pause/resume the controller for a lid-open event (Hold mode).')
def _lid(args, ctx: Ctx):
	ctx.patch_control({'lid_open_toggle': True})


@register('tuning_mode', BoolArgs, description='Enable or disable probe tuning data capture.')
def _tuning(args: BoolArgs, ctx: Ctx):
	ctx.patch_control({'tuning_mode': args.enabled})


# --------------------------------------------------------------------------
# Timer
# --------------------------------------------------------------------------


def _timer_index(control) -> int:
	for i, item in enumerate(control['notify_data']):
		if item['type'] == 'timer':
			return i
	raise CommandError('Timer notification entry missing', code='state')


@register('timer.start', TimerStartArgs, description='Start (or restart) the cook timer.')
def _timer_start(args: TimerStartArgs, ctx: Ctx):
	import time

	control = common.read_control()
	i = _timer_index(control)
	now = time.time()
	control['timer'] = {'start': now, 'paused': 0, 'end': now + args.seconds, 'shutdown': args.shutdown}
	control['notify_data'][i].update({'req': True, 'shutdown': args.shutdown, 'keep_warm': args.keep_warm})
	ctx.patch_control({'timer': control['timer'], 'notify_data': control['notify_data']})
	return {'end': control['timer']['end']}


@register('timer.pause', description='Pause the running cook timer.')
def _timer_pause(args, ctx: Ctx):
	import time

	control = common.read_control()
	i = _timer_index(control)
	if control['timer']['start'] == 0:
		raise CommandError('Timer is not running', code='state')
	control['timer']['paused'] = time.time()
	control['notify_data'][i]['req'] = False
	ctx.patch_control({'timer': control['timer'], 'notify_data': control['notify_data']})


@register('timer.resume', description='Resume a paused cook timer.')
def _timer_resume(args, ctx: Ctx):
	import time

	control = common.read_control()
	i = _timer_index(control)
	if not control['timer']['paused']:
		raise CommandError('Timer is not paused', code='state')
	remaining = control['timer']['end'] - control['timer']['paused']
	now = time.time()
	control['timer'].update({'start': now, 'paused': 0, 'end': now + remaining})
	control['notify_data'][i]['req'] = True
	ctx.patch_control({'timer': control['timer'], 'notify_data': control['notify_data']})


@register('timer.stop', description='Stop and clear the cook timer.')
def _timer_stop(args, ctx: Ctx):
	control = common.read_control()
	i = _timer_index(control)
	control['timer'] = {'start': 0, 'paused': 0, 'end': 0, 'shutdown': False}
	control['notify_data'][i].update({'req': False, 'shutdown': False, 'keep_warm': False})
	ctx.patch_control({'timer': control['timer'], 'notify_data': control['notify_data']})


# --------------------------------------------------------------------------
# Notifications
# --------------------------------------------------------------------------


@register('notify.set', NotifyArgs, description='Arm/disarm a probe, timer or hopper notification and its actions.')
def _notify(args: NotifyArgs, ctx: Ctx):
	control = common.read_control()
	units = ctx.settings()['globals']['units']
	for entry in control['notify_data']:
		if entry['label'] == args.label and entry['type'] == args.kind:
			break
	else:
		raise CommandError(f'No {args.kind} notification named {args.label!r}', code='not_found')
	for field in ('req', 'shutdown', 'keep_warm', 'reignite'):
		value = getattr(args, field)
		if value is not None:
			if field in entry or field == 'req':
				entry[field] = value
	if args.target is not None:
		if args.kind in ('timer', 'hopper'):
			raise CommandError('Timer and hopper notifications have no target temperature', code='invalid')
		entry['target'] = int(args.target) if units == 'F' else float(args.target)
	ctx.patch_control({'notify_data': control['notify_data']})
	return {'entry': entry}


# --------------------------------------------------------------------------
# Manual outputs
# --------------------------------------------------------------------------


@register('manual.output', ManualArgs, description='Switch an output on/off (Manual mode, or when manual overrides are allowed).')
def _manual(args: ManualArgs, ctx: Ctx):
	control = common.read_control()
	settings = ctx.settings()
	if control['mode'] != 'Manual' and not settings['safety']['allow_manual_changes']:
		raise CommandError('Manual output changes are only allowed in Manual mode (or when enabled in safety settings)', code='state')
	ctx.patch_control({'manual': {'change': args.output, 'output': args.on}})


@register('manual.pwm', ManualPwmArgs, description='Set the DC fan PWM duty cycle manually.')
def _manual_pwm(args: ManualPwmArgs, ctx: Ctx):
	ctx.patch_control({'manual': {'change': 'pwm', 'pwm': args.duty_cycle, 'output': True}})


# --------------------------------------------------------------------------
# Recipes
# --------------------------------------------------------------------------


@register('recipe.start', RecipeStartArgs, description='Run a recipe program from the recipes folder.')
def _recipe_start(args: RecipeStartArgs, ctx: Ctx):
	from pathlib import Path

	path = Path('recipes') / args.filename
	if not path.exists():
		raise CommandError(f'Recipe {args.filename} not found', code='not_found')
	ctx.patch_control({'mode': 'Recipe', 'updated': True, 'recipe': {'filename': path.as_posix(), 'start_step': args.start_step}})


@register('recipe.continue', description='Release a paused recipe step and move to the next one.')
def _recipe_continue(args, ctx: Ctx):
	control = common.read_control()
	if control.get('mode') != 'Recipe':
		raise CommandError('No recipe is running', code='state')
	ctx.patch_control({'recipe': {'step_data': {'pause': False}}})


# --------------------------------------------------------------------------
# Settings + system
# --------------------------------------------------------------------------


@register('settings.patch', SettingsPatchArgs, description='Deep-merge a partial settings document and notify the controller.')
def _settings_patch(args: SettingsPatchArgs, ctx: Ctx):
	from core.settings_schema import apply_patch

	changed = apply_patch(args.patch)
	flags = {'settings_update': True}
	if any(k.startswith('probe_settings') for k in changed):
		flags['probe_profile_update'] = True
	if any(k.startswith('controller') for k in changed):
		flags['controller_update'] = True
	if any(k.startswith('pelletlevel') for k in changed):
		flags['distance_update'] = True
	ctx.patch_control(flags)
	return {'changed': changed}


@register('hopper.check', description='Re-read the pellet hopper level sensor now.')
def _hopper(args, ctx: Ctx):
	ctx.patch_control({'hopper_check': True})


@register('system.restart_control', description='Restart the control process.', cloud_allowed=False, role='admin')
def _restart_control(args, ctx: Ctx):
	common.restart_control()


@register('system.reboot', description='Reboot the Raspberry Pi.', cloud_allowed=False, role='admin')
def _reboot(args, ctx: Ctx):
	common.reboot_system()


@register('system.shutdown', description='Power off the Raspberry Pi.', cloud_allowed=False, role='admin')
def _shutdown(args, ctx: Ctx):
	common.shutdown_system()
