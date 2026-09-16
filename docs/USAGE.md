# Using FireAI

This mirrors the PiFire usage guide (docs.pifire.io/usage) for the FireAI app. Everything below works
the same on the grill's local app (`http://<pi>/`) and, once paired, in the cloud app — except where a
line says *local only*.

## Dashboard

**Modes** (top card). When stopped: **Start**, **Prime** (pick grams, optionally start up afterwards),
**Monitor** (read probes without controlling), **Manual** (drive the outputs yourself). While cooking:
**Smoke**, **Hold** (opens the setpoint picker), **Shutdown** (burns off pellets, then stops) and
**Stop** (immediate, with confirmation). In *Error* the card offers **Re-ignite** or **Clear**.

Below the mode buttons, while starting up or smoking: **P-Mode** `−`/`+` (each level adds 10 s of
auger-off time). While smoking or holding: **Smoke+** (fan cycling inside the Smoke+ window) and, in
Hold, **Lid open** to pause the controller.

**Status strip** — countdown for startup / shutdown / prime / lid pause, output indicators (fan, auger,
igniter, power) and the hopper level when a sensor is fitted.

**Probe cards** — the pit shows its setpoint while holding; food probes show their target and the ETA
(Settings → General → *Estimate time to target*). Dashes mean the grill is stopped. A card is greyed
with an unplugged icon when its device is disconnected (Bluetooth, ThermoMaven). Tap a card for the
**notification sheet**: target temperature, *notify*, *shutdown when reached*, *keep warm* (switch to
Hold at the keep-warm setpoint), *re-ignite*, plus **high** and **low limit** alerts.

**Timer** — the pill in the header: start/pause/stop, and *shutdown* or *keep warm* when it expires.

**Customize** (bottom of the dashboard) hides cards; gauge ranges are under Settings → General.

## Graph

Live chart of every probe with the setpoint dashed. Range buttons (15 m … all), **Live** pause/resume,
**Annotations** (mode changes from the events log), **Colours** (per-probe line colour, also used on the
cards and cook files) and **CSV** export. Drag to zoom; click a legend entry to hide a series.

## Cooks

Every cook is saved automatically on Stop. Open one for the chart, pit/food peaks, **notes** (edit,
delete, attach photos), **photos** (camera or upload; *use as cover*), **download** the `.pifire` file and
**delete**. The list has **Import** for `.pifire` files from PiFire or another FireAI. *Photo upload,
import/export: local only.*

## Recipes

A recipe is a program the grill follows: steps (Startup → Smoke/Hold with trigger temperatures, timers,
notifications and pauses → Shutdown), plus ingredients, instructions, cover and step photos, author,
times, difficulty, your rating and **comments** with ratings. **Run recipe** starts it; **Continue** releases
a paused step. Recipes import/export as `.pfrecipe`. *Editing: local only.*

## Pellets

Current load (brand, wood, rating, date, comments), hopper level with **Check now**, estimated usage since
the load (auger rate × auger time), brands and woods lists, profiles (create/edit/delete/load) and the
load log.

## Settings

| Section | What is there (all PiFire settings are kept) |
|---|---|
| General | grill name, units, auger rate, boot-to-monitor, igniter while priming, extended data, debug logging, ETA, gauge ranges, graph window/points/clear-on-start |
| Control | startup (duration, exit temperature, go to Smoke/Hold, Smart Start profiles, prime on startup), smoke cycle (auger on time, P-Mode), Smoke+ (window, cycle, ramp), Hold (controller selection and its parameters, lid-open detection and pause, Fan PID, PWM fan), shutdown (duration, auto power off), keep-warm setpoint |
| Safety | min/max startup temperature, re-ignite retries, max operating temperature, manual overrides |
| Pellet level | sensor warnings, full/empty calibration |
| Notifications | Apprise, IFTTT, Pushbullet, Pushover, OneSignal, MQTT / Home Assistant, InfluxDB, WLED |
| Probes *(local)* | probe devices (ADC, RTD, thermocouple, Bluetooth with **Scan**, ThermoMaven cloud, virtual average/highest/lowest/median), probe map (name, type Primary/Food/Aux, port, profile, enabled), Steinhart–Hart profile editor |
| Probe tuner *(local)* | manual three-point fit or auto-tune against a reference probe |
| Hardware *(local)* | board and pins, display, pellet sensor, units, board default probe map; Bluetooth diagnostics |
| Events & logs | the events log; log file viewer |
| Cook metrics | per-mode auger/fan time, pellets, P-Mode, Smart Start, CSV |
| Cloud *(local)* | pair/unpair, remote control on/off, bridge on/off |
| Members *(cloud)* | owners, operators, viewers |
| System *(local)* | version, uptime, CPU/memory/disk, network + QR code, GPIO summary, software update, backup/restore, **API keys**, maintenance (clear data, logs, debug bundle, factory reset), restart/reboot/shutdown |
| App | theme, install to home screen, push notifications |

## First run

Set the admin password, then the setup wizard walks through board → display → pellet sensor → units &
probes. Everything can be changed later under Settings → Hardware / Probes.

## Physical display

Displays with buttons or an encoder keep PiFire's menus: from Off, press any button to choose Startup /
Monitor / Stop; while cooking, choose Shutdown / Smoke+ / Hold (up/down to set) / Stop.
