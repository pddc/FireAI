"""Declarative UI schema for settings.

The web app renders settings pages from this description instead of
hand-built forms, so every setting that exists in settings.json is editable
in both local and cloud mode. Static sections are hand-written here with
labels and help; controller and display option groups are generated from
their existing metadata files (controllers.json, wizard_manifest.json).

Field widgets: toggle | number | temp | text | password | select | slider |
list | color. ``temp`` is a number whose unit follows settings.globals.units.
``visible_if`` hides a field unless another path has one of the given values.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from core.settings_schema import get_path


@dataclass
class Field:
	path: str
	label: str
	widget: str = 'text'
	help: str = ''
	min: float | None = None
	max: float | None = None
	step: float | None = None
	unit: str = ''
	options: list[dict] | None = None
	visible_if: dict[str, list] | None = None
	advanced: bool = False
	restart: str | None = None  # 'control' | 'server' | 'reboot' when a change needs a restart


@dataclass
class Group:
	title: str
	fields: list[Field]
	help: str = ''


@dataclass
class Section:
	id: str
	title: str
	icon: str
	description: str
	groups: list[Group] = field(default_factory=list)
	local_only: bool = False


def _opts(*pairs):
	return [{'value': v, 'label': lbl} for v, lbl in pairs]


# --------------------------------------------------------------------------
# Static sections
# --------------------------------------------------------------------------

GENERAL = Section('general', 'General', 'wrench', 'Name, units and dashboard preferences.', [
	Group('Grill', [
		Field('globals.grill_name', 'Grill name', 'text', 'Shown in the app header and notifications.'),
		Field('globals.units', 'Temperature units', 'select', 'Switching units stops the current cook and converts all temperature settings.',
			  options=_opts(('F', 'Fahrenheit'), ('C', 'Celsius'))),
		Field('globals.augerrate', 'Auger feed rate', 'number', 'Grams of pellets per second while the auger runs. Used for pellet usage estimates and priming.', min=0.01, max=5, step=0.01, unit='g/s'),
	]),
	Group('Behaviour', [
		Field('globals.boot_to_monitor', 'Boot into Monitor mode', 'toggle', 'Start reading probes as soon as the controller boots.'),
		Field('globals.prime_ignition', 'Igniter on while priming', 'toggle', 'Turn the igniter on during Prime when Startup follows.'),
		Field('globals.ext_data', 'Record extended data', 'toggle', 'Store cycle ratios alongside temperatures in history (larger cook files).', advanced=True),
		Field('globals.debug_mode', 'Debug logging', 'toggle', 'Verbose logs for troubleshooting. Restart the control process to apply.', advanced=True, restart='control'),
	]),
	Group('Dashboard', [
		Field('globals.eta_calculation', 'Estimate time to target', 'toggle', 'Show an ETA on probe cards that have a target temperature.'),
		Field('dashboard.dashboards.Default.config.max_primary_temp_F', 'Pit gauge maximum (°F)', 'number', min=200, max=1000, step=10, visible_if={'globals.units': ['F']}),
		Field('dashboard.dashboards.Default.config.max_food_temp_F', 'Food gauge maximum (°F)', 'number', min=100, max=600, step=10, visible_if={'globals.units': ['F']}),
		Field('dashboard.dashboards.Default.config.max_primary_temp_C', 'Pit gauge maximum (°C)', 'number', min=100, max=600, step=5, visible_if={'globals.units': ['C']}),
		Field('dashboard.dashboards.Default.config.max_food_temp_C', 'Food gauge maximum (°C)', 'number', min=50, max=300, step=5, visible_if={'globals.units': ['C']}),
		Field('history_page.minutes', 'Graph window', 'number', 'Minutes of history shown by default on the graph.', min=1, max=480, step=1, unit='min'),
		Field('history_page.datapoints', 'Graph data points', 'number', 'Maximum points drawn per series.', min=10, max=2000, step=10, advanced=True),
		Field('history_page.clearhistoryonstart', 'Clear history on startup', 'toggle', 'Start every cook with an empty graph.'),
	]),
])

CONTROL = Section('control', 'Control', 'gauge', 'How the controller starts, smokes, holds and shuts down.', [
	Group('Startup', [
		Field('startup.duration', 'Startup duration', 'number', 'Seconds the igniter runs before switching to the next mode.', min=60, max=900, step=10, unit='s'),
		Field('startup.startup_exit_temp', 'Exit startup at temperature', 'temp', 'Leave Startup early once the pit reaches this temperature. 0 disables.', min=0, max=400),
		Field('startup.prime_on_startup', 'Prime before startup', 'number', 'Grams of pellets to feed before ignition. 0 disables.', min=0, max=100, step=5, unit='g'),
		Field('startup.start_to_mode.after_startup_mode', 'After startup, go to', 'select', options=_opts(('Smoke', 'Smoke'), ('Hold', 'Hold'))),
		Field('startup.start_to_mode.primary_setpoint', 'Hold setpoint after startup', 'temp', 'Used when the mode after startup is Hold.', min=100, max=600, visible_if={'startup.start_to_mode.after_startup_mode': ['Hold']}),
		Field('startup.pwm_duty_cycle', 'Fan duty cycle during startup', 'slider', 'DC fans only.', min=20, max=100, step=5, unit='%', visible_if={'platform.dc_fan': [True]}),
	]),
	Group('Smart Start', [
		Field('startup.smartstart.enabled', 'Smart Start', 'toggle', 'Pick a startup profile from the starting pit temperature.'),
		Field('startup.smartstart.exit_temp', 'Smart Start exit temperature', 'temp', min=0, max=400, visible_if={'startup.smartstart.enabled': [True]}),
		Field('startup.smartstart.temp_range_list', 'Temperature thresholds', 'list', 'Upper bound of each profile, lowest first.', visible_if={'startup.smartstart.enabled': [True]}, advanced=True),
	], help='Cold starts need longer ignition than warm ones; Smart Start chooses a profile by starting temperature.'),
	Group('Smoke mode', [
		Field('cycle_data.SmokeOnCycleTime', 'Auger on time', 'number', 'Seconds the auger runs per smoke cycle.', min=5, max=60, step=1, unit='s'),
		Field('cycle_data.SmokeOffCycleTime', 'Auger off time', 'number', 'Base seconds the auger rests per cycle (P-Mode adds 10 s per level).', min=10, max=180, step=1, unit='s'),
		Field('cycle_data.PMode', 'P-Mode', 'slider', 'Extra 10 s of auger off time per level. Higher = less fuel, more smoke, lower temperatures.', min=0, max=9, step=1),
	]),
	Group('Hold mode', [
		Field('controller.selected', 'Controller', 'select', 'Algorithm used to hold the setpoint.', options=[]),  # filled dynamically
		Field('cycle_data.HoldCycleTime', 'Hold cycle time', 'number', 'Seconds per auger cycle in Hold mode.', min=10, max=120, step=1, unit='s'),
		Field('cycle_data.u_min', 'Minimum auger ratio', 'number', 'Lowest fraction of the cycle the auger may run.', min=0.05, max=0.5, step=0.01),
		Field('cycle_data.u_max', 'Maximum auger ratio', 'number', 'Highest fraction of the cycle the auger may run.', min=0.5, max=1.0, step=0.01),
		Field('cycle_data.FanPidEnabled', 'Fan-assisted PID', 'toggle', 'Cycle the fan for extra control when the auger is at minimum (AC fans, or DC fans without PWM control).', advanced=True),
	]),
	Group('Lid open detection', [
		Field('cycle_data.LidOpenDetectEnabled', 'Detect lid open', 'toggle', 'Pause the controller when the pit temperature drops suddenly in Hold mode.'),
		Field('cycle_data.LidOpenThreshold', 'Drop threshold', 'slider', 'Percent below setpoint that counts as the lid opening.', min=5, max=50, step=1, unit='%', visible_if={'cycle_data.LidOpenDetectEnabled': [True]}),
		Field('cycle_data.LidOpenPauseTime', 'Pause duration', 'number', 'Seconds to pause before resuming control.', min=10, max=600, step=5, unit='s', visible_if={'cycle_data.LidOpenDetectEnabled': [True]}),
	]),
	Group('Smoke Plus', [
		Field('smoke_plus.enabled', 'Smoke Plus on by default', 'toggle', 'Cycle the fan to create more smoke while within the temperature band.'),
		Field('smoke_plus.min_temp', 'Minimum temperature', 'temp', min=0, max=400),
		Field('smoke_plus.max_temp', 'Maximum temperature', 'temp', min=0, max=500),
		Field('smoke_plus.on_time', 'Fan on time', 'number', min=1, max=60, step=1, unit='s'),
		Field('smoke_plus.off_time', 'Fan off time', 'number', min=1, max=60, step=1, unit='s'),
		Field('smoke_plus.duty_cycle', 'Fan duty cycle', 'slider', 'DC fans only.', min=20, max=100, step=5, unit='%', visible_if={'platform.dc_fan': [True]}),
		Field('smoke_plus.fan_ramp', 'Ramp fan speed', 'toggle', 'DC fans only.', visible_if={'platform.dc_fan': [True]}),
	]),
	Group('Keep warm', [
		Field('keep_warm.temp', 'Keep-warm temperature', 'temp', 'Setpoint used when a notification action is Keep warm.', min=100, max=250),
		Field('keep_warm.s_plus', 'Smoke Plus while keeping warm', 'toggle'),
	]),
	Group('Shutdown', [
		Field('shutdown.shutdown_duration', 'Shutdown duration', 'number', 'Seconds the fan runs to burn off pellets.', min=60, max=900, step=10, unit='s'),
		Field('shutdown.auto_power_off', 'Power off the Pi after shutdown', 'toggle', 'Shuts down the Raspberry Pi itself when the burn-off finishes.', advanced=True),
	]),
	Group('DC fan (PWM)', [
		Field('pwm.pwm_control', 'Temperature-based fan speed', 'toggle', 'Vary fan speed with distance from setpoint in Hold mode.'),
		Field('pwm.update_time', 'Update interval', 'number', min=1, max=60, step=1, unit='s'),
		Field('pwm.frequency', 'PWM frequency', 'number', min=100, max=40000, step=100, unit='Hz', advanced=True, restart='control'),
		Field('pwm.min_duty_cycle', 'Minimum duty cycle', 'slider', min=10, max=100, step=5, unit='%'),
		Field('pwm.max_duty_cycle', 'Maximum duty cycle', 'slider', min=10, max=100, step=5, unit='%'),
		Field('pwm.temp_range_list', 'Temperature bands', 'list', 'Degrees below setpoint for each speed profile, smallest first.', advanced=True),
	], help='Only shown when the platform has a DC fan.'),
])

SAFETY = Section('safety', 'Safety', 'shield', 'Limits that stop the cook before something goes wrong.', [
	Group('Temperature limits', [
		Field('safety.maxtemp', 'Maximum pit temperature', 'temp', 'The controller goes to Error above this in any mode.', min=200, max=700),
		Field('safety.minstartuptemp', 'Minimum startup temperature', 'temp', 'Lowest temperature the pit must reach during startup.', min=40, max=200),
		Field('safety.maxstartuptemp', 'Maximum startup temperature', 'temp', 'Cap for the computed startup safety temperature.', min=60, max=300),
		Field('safety.startup_check', 'Startup safety check', 'toggle', 'Verify the pit reached the startup temperature before Smoke/Hold.', advanced=True),
	]),
	Group('Flame-out', [
		Field('safety.reigniteretries', 'Re-ignite attempts', 'number', 'How many times to retry ignition if the fire goes out. 0 stops immediately.', min=0, max=5, step=1),
	]),
	Group('Manual overrides', [
		Field('safety.allow_manual_changes', 'Allow output overrides outside Manual mode', 'toggle', 'Lets you toggle fan/auger/igniter from the dashboard during a cook.'),
		Field('safety.manual_override_time', 'Override duration', 'number', 'Seconds an override lasts before control resumes.', min=5, max=600, step=5, unit='s', visible_if={'safety.allow_manual_changes': [True]}),
	]),
])

PELLETS = Section('pellets', 'Pellet level', 'package', 'Hopper level sensor and low-pellet warnings.', [
	Group('Warnings', [
		Field('pelletlevel.warning_enabled', 'Low pellet warning', 'toggle'),
		Field('pelletlevel.warning_level', 'Warn below', 'slider', min=5, max=50, step=5, unit='%', visible_if={'pelletlevel.warning_enabled': [True]}),
		Field('pelletlevel.warning_time', 'Repeat every', 'number', 'Minutes between repeated warnings.', min=5, max=240, step=5, unit='min', visible_if={'pelletlevel.warning_enabled': [True]}),
	]),
	Group('Sensor calibration', [
		Field('pelletlevel.empty', 'Distance when empty', 'number', 'Sensor reading (cm) with the hopper empty.', min=1, max=200, step=1, unit='cm'),
		Field('pelletlevel.full', 'Distance when full', 'number', 'Sensor reading (cm) with the hopper full.', min=0, max=200, step=1, unit='cm'),
	]),
])

NOTIFICATIONS = Section('notifications', 'Notifications', 'bell', 'Where alerts are sent. FireAI cloud push works automatically once paired.', [
	Group('Apprise', [
		Field('notify_services.apprise.enabled', 'Enable Apprise', 'toggle', 'Send to any of the 90+ services Apprise supports.'),
		Field('notify_services.apprise.locations', 'Service URLs', 'list', 'One Apprise URL per line, e.g. tgram://bottoken/ChatID', visible_if={'notify_services.apprise.enabled': [True]}),
	]),
	Group('Pushover', [
		Field('notify_services.pushover.enabled', 'Enable Pushover', 'toggle'),
		Field('notify_services.pushover.APIKey', 'API token', 'password', visible_if={'notify_services.pushover.enabled': [True]}),
		Field('notify_services.pushover.UserKeys', 'User keys', 'text', 'Comma-separated.', visible_if={'notify_services.pushover.enabled': [True]}),
		Field('notify_services.pushover.PublicURL', 'Public URL', 'text', 'Link included in notifications.', visible_if={'notify_services.pushover.enabled': [True]}),
	]),
	Group('Pushbullet', [
		Field('notify_services.pushbullet.enabled', 'Enable Pushbullet', 'toggle'),
		Field('notify_services.pushbullet.APIKey', 'Access token', 'password', visible_if={'notify_services.pushbullet.enabled': [True]}),
		Field('notify_services.pushbullet.PublicURL', 'Public URL', 'text', visible_if={'notify_services.pushbullet.enabled': [True]}),
	]),
	Group('IFTTT', [
		Field('notify_services.ifttt.enabled', 'Enable IFTTT', 'toggle'),
		Field('notify_services.ifttt.APIKey', 'Webhook key', 'password', visible_if={'notify_services.ifttt.enabled': [True]}),
	]),
	Group('OneSignal', [
		Field('notify_services.onesignal.enabled', 'Enable OneSignal', 'toggle', 'Used by the legacy Android app.', advanced=True),
		Field('notify_services.onesignal.app_id', 'App ID', 'text', visible_if={'notify_services.onesignal.enabled': [True]}, advanced=True),
	]),
	Group('MQTT / Home Assistant', [
		Field('notify_services.mqtt.enabled', 'Enable MQTT', 'toggle', 'Publish state and PID data; Home Assistant discovery supported.'),
		Field('notify_services.mqtt.broker', 'Broker host', 'text', visible_if={'notify_services.mqtt.enabled': [True]}),
		Field('notify_services.mqtt.port', 'Port', 'text', visible_if={'notify_services.mqtt.enabled': [True]}),
		Field('notify_services.mqtt.username', 'Username', 'text', visible_if={'notify_services.mqtt.enabled': [True]}),
		Field('notify_services.mqtt.password', 'Password', 'password', visible_if={'notify_services.mqtt.enabled': [True]}),
		Field('notify_services.mqtt.id', 'Client ID / device name', 'text', visible_if={'notify_services.mqtt.enabled': [True]}),
		Field('notify_services.mqtt.homeassistant_autodiscovery_topic', 'Home Assistant discovery topic', 'text', visible_if={'notify_services.mqtt.enabled': [True]}, advanced=True),
		Field('notify_services.mqtt.update_sec', 'Publish interval', 'text', 'Seconds between updates.', visible_if={'notify_services.mqtt.enabled': [True]}),
	]),
	Group('InfluxDB', [
		Field('notify_services.influxdb.enabled', 'Enable InfluxDB', 'toggle', 'Write temperatures to InfluxDB 2.x for long-term graphs.'),
		Field('notify_services.influxdb.url', 'URL', 'text', visible_if={'notify_services.influxdb.enabled': [True]}),
		Field('notify_services.influxdb.token', 'Token', 'password', visible_if={'notify_services.influxdb.enabled': [True]}),
		Field('notify_services.influxdb.org', 'Organisation', 'text', visible_if={'notify_services.influxdb.enabled': [True]}),
		Field('notify_services.influxdb.bucket', 'Bucket', 'text', visible_if={'notify_services.influxdb.enabled': [True]}),
	]),
	Group('WLED lighting', [
		Field('notify_services.wled.enabled', 'Enable WLED', 'toggle', 'Drive a WLED LED strip with cook status.'),
		Field('notify_services.wled.device_address', 'Device address', 'text', visible_if={'notify_services.wled.enabled': [True]}),
		Field('notify_services.wled.use_profiles', 'Use WLED presets', 'toggle', visible_if={'notify_services.wled.enabled': [True]}),
		Field('notify_services.wled.notify_duration', 'Notification duration', 'number', min=5, max=600, step=5, unit='s', visible_if={'notify_services.wled.enabled': [True]}),
		Field('notify_services.wled.suggested_config.led_count', 'LED count', 'number', min=1, max=1000, step=1, visible_if={'notify_services.wled.enabled': [True]}, advanced=True),
		Field('notify_services.wled.suggested_config.night_mode', 'Night mode', 'toggle', 'Dim amber instead of full colours.', visible_if={'notify_services.wled.enabled': [True]}, advanced=True),
	]),
])

CLOUD = Section('cloud', 'Cloud', 'cloud', 'Pairing, remote control and monitoring.', [
	Group('Cloud bridge', [
		Field('cloud.enabled', 'Run the cloud bridge', 'toggle', 'Turn off to keep the grill fully local even while paired.'),
		Field('cloud.monitor_enabled', 'Live monitoring', 'toggle', 'Mirror temperatures, status and cook history to the cloud.'),
		Field('cloud.control_enabled', 'Remote control', 'toggle', 'Allow members to change modes and setpoints from the app.'),
		Field('cloud.sample_interval_s', 'Archive sample interval', 'number', 'Seconds between archived history samples.', min=5, max=60, step=5, unit='s', advanced=True),
		Field('cloud.functions_url', 'Cloud Functions URL', 'text', 'Only for self-hosted FireAI cloud projects.', advanced=True),
	]),
], local_only=True)

SYSTEM = Section('system', 'System', 'cpu', 'Hardware platform and process settings.', [
	Group('Platform', [
		Field('platform.dc_fan', 'DC fan with PWM', 'toggle', 'The board drives a DC fan instead of an AC relay.', restart='control'),
		Field('platform.standalone', 'Standalone (no selector switch)', 'toggle', 'Turn off if the original controller selector switch is wired in.', restart='control'),
		Field('platform.triggerlevel', 'Relay trigger level', 'select', options=_opts(('LOW', 'Active low'), ('HIGH', 'Active high')), restart='control'),
		Field('platform.buttonslevel', 'Button level', 'select', options=_opts(('HIGH', 'Active high'), ('LOW', 'Active low')), restart='control'),
	], help='Pin assignments and module selection are changed in the configuration wizard.'),
], local_only=True)

STATIC_SECTIONS = [GENERAL, CONTROL, SAFETY, PELLETS, NOTIFICATIONS, CLOUD, SYSTEM]


# --------------------------------------------------------------------------
# Dynamic parts
# --------------------------------------------------------------------------

def _controller_meta() -> dict:
	try:
		return json.loads(Path('controller/controllers.json').read_text())['metadata']
	except (OSError, ValueError, KeyError):
		return {}


def _display_meta() -> dict:
	try:
		return json.loads(Path('wizard/wizard_manifest.json').read_text())['modules']['display']
	except (OSError, ValueError, KeyError):
		return {}


def _option_field(prefix: str, opt: dict, visible_if=None) -> Field:
	t = opt.get('option_type', 'string')
	widget = {'float': 'number', 'int': 'number', 'bool': 'toggle', 'list': 'select', 'string': 'text'}.get(t, 'text')
	options = None
	if t == 'list':
		labels = opt.get('option_list_labels') or opt.get('list_labels') or []
		values = opt.get('option_list_values') or opt.get('list_values') or opt.get('option_list') or []
		options = [{'value': v, 'label': (labels[i] if i < len(labels) else str(v))} for i, v in enumerate(values)]
	return Field(
		path=f'{prefix}.{opt["option_name"]}', label=opt.get('option_friendly_name', opt['option_name']), widget=widget,
		help=opt.get('option_description', ''), min=opt.get('option_min'), max=opt.get('option_max'), step=opt.get('option_step'),
		options=options, visible_if=visible_if, advanced=bool(opt.get('hidden', False)),
	)


def controller_groups(settings: dict) -> list[Group]:
	meta = _controller_meta()
	groups = []
	for name, m in meta.items():
		fields = [_option_field(f'controller.config.{name}', o, visible_if={'controller.selected': [name]}) for o in m.get('config', []) if not o.get('hidden')]
		if fields:
			groups.append(Group(f'{m.get("friendly_name", name)} settings', fields, help=m.get('description', '')))
	return groups


def controller_options() -> list[dict]:
	return [{'value': k, 'label': v.get('friendly_name', k)} for k, v in _controller_meta().items()]


def display_group(settings: dict) -> Group | None:
	selected = settings.get('modules', {}).get('display', 'none')
	meta = _display_meta().get(selected)
	if not meta or not meta.get('config'):
		return None
	fields = [_option_field(f'display.config.{selected}', o, visible_if=None) for o in meta['config'] if not o.get('hidden')]
	for f in fields:
		f.restart = 'control'
	return Group(f'Display: {meta.get("friendly_name", selected)}', fields, help='Changes take effect after restarting the control process.')


def build_schema(settings: dict, *, local: bool = True) -> dict:
	"""Full schema with dynamic groups resolved for the given settings."""
	sections: list[Section] = []
	for s in STATIC_SECTIONS:
		if s.local_only and not local:
			continue
		sec = Section(s.id, s.title, s.icon, s.description, [Group(g.title, list(g.fields), g.help) for g in s.groups], s.local_only)
		if sec.id == 'control':
			for g in sec.groups:
				for f in g.fields:
					if f.path == 'controller.selected':
						f.options = controller_options()
			sec.groups.extend(controller_groups(settings))
			if not settings.get('platform', {}).get('dc_fan'):
				sec.groups = [g for g in sec.groups if g.title != 'DC fan (PWM)']
		if sec.id == 'system':
			dg = display_group(settings)
			if dg:
				sec.groups.append(dg)
		sections.append(sec)
	return {
		'sections': [asdict(s) for s in sections],
		'units': settings.get('globals', {}).get('units', 'F'),
	}


def all_paths(schema: dict) -> set[str]:
	return {f['path'] for s in schema['sections'] for g in s['groups'] for f in g['fields']}


def coerce_patch(schema: dict, patch: dict, current: dict) -> dict:
	"""Coerce string form values to the type of the current setting (numbers, bools)."""
	out: dict[str, Any] = {}
	for path, value in _flatten(patch).items():
		cur = get_path(current, path)
		if isinstance(cur, bool):
			value = value if isinstance(value, bool) else str(value).lower() in ('1', 'true', 'on', 'yes')
		elif isinstance(cur, int) and not isinstance(value, bool) and isinstance(value, str | float):
			try:
				value = int(float(value))
			except ValueError:
				pass
		elif isinstance(cur, float) and isinstance(value, str | int):
			try:
				value = float(value)
			except ValueError:
				pass
		_set_path(out, path, value)
	return out


def _flatten(d: dict, prefix: str = '') -> dict[str, Any]:
	out = {}
	for k, v in d.items():
		p = f'{prefix}{k}'
		if isinstance(v, dict) and v and not _looks_like_leaf_dict(v):
			out.update(_flatten(v, p + '.'))
		else:
			out[p] = v
	return out


def _looks_like_leaf_dict(v: dict) -> bool:
	# probe_map / profiles etc. are opaque blobs to the form renderer
	return False


def _set_path(d: dict, dotted: str, value) -> None:
	parts = dotted.split('.')
	node = d
	for p in parts[:-1]:
		node = node.setdefault(p, {})
	node[parts[-1]] = value
