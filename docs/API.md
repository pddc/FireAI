# API

FireAI has two HTTP APIs on the grill (`http://<pi>/`):

- **`/api/v1`** — what the FireAI app uses. Typed commands, one state document, a WebSocket. Interactive
  reference at `http://<pi>/docs` (OpenAPI).
- **`/api/get|set|cmd|sys`, `/api/settings|control|current|hopper`** — the [PiFire API](https://docs.pifire.io/advanced)
  exactly as documented, so Home Assistant, Node-RED, dashboards and the PiFire Android app keep working.

Both need a credential. Nothing is reachable without one — a freshly installed grill answers
`403 setup_required` until the admin password is set in the app.

## Authentication

| Credential | How to get it | How to send it |
|---|---|---|
| Session token (JWT, 30 days) | `POST /api/v1/auth/login {"password": "..."}` → `{token}` | `Authorization: Bearer <token>` or `?token=` |
| API key (`fireai_…`) | **Settings → System → API keys** (or `POST /api/v1/auth/api-keys`) | `X-API-Key: <key>`, `Authorization: Bearer <key>`, `?api_key=<key>`, or HTTP Basic with any user name and the key as password |

API keys have a role: **viewer** (reads), **operator** (reads + cook control), **admin** (everything, including
settings and restart/reboot). Only a hash is stored on the grill; the key is shown once when created. Revoke
it from the same page. `FIREAI_AUTH_DISABLED=1` (development only) makes every request an admin.

## PiFire-compatible API

The verbs are handled by the same `process_command` engine PiFire uses, with the same argument grammar and the
same `{"result": "OK"|"ERROR", "message": "...", "data": {...}}` envelope (HTTP 201, like PiFire).

```
GET /api/get/current            temperatures {P, F, AUX, PSP, NT, TS}
GET /api/get/temp/{label}       one probe
GET /api/get/mode               {"mode": "Hold"}
GET /api/get/hopper             pellet level (re-reads the sensor, ~3 s)
GET /api/get/timer              timer state
GET /api/get/notify             notification objects (targets, ETA, actions)
GET /api/get/status             mode, outputs, p_mode, s_plus, durations, lid state…

GET /api/set/mode/{startup|smoke|shutdown|stop|reignite|monitor|manual}
GET /api/set/mode/hold/{temp}   GET /api/set/mode/prime/{grams}[/{next mode}]
GET /api/set/psp/{temp}         GET /api/set/pmode/{0-9}        GET /api/set/splus/{true|false}
GET /api/set/notify/{label|Timer|Hopper}/{req|shutdown|keep_warm|reignite}/{true|false}
GET /api/set/notify/{label}/target/{temp}
GET /api/set/limit_high/{label}/{req|target}/{value}   GET /api/set/limit_low/...
GET /api/set/timer/start[/{seconds}] | pause | stop | shutdown/{bool} | keep_warm/{bool}
GET /api/set/manual/{power|igniter|fan|auger}/{true|false}   GET /api/set/manual/pwm/{0-100}
GET /api/set/pwm/{bool}   GET /api/set/duty_cycle/{0-100}   GET /api/set/tuning_mode/{bool}   GET /api/set/units/{F|C}
GET /api/set/lid_open/{true|false}

GET /api/cmd/restart | reboot | shutdown          (admin)
GET /api/sys/{command}                            platform system commands, waits for the control process

GET  /api/settings   {"settings": …}   (secrets redacted, local auth block omitted)
GET  /api/control    {"control": …}
GET  /api/current    {"current", "notify_data", "status"}   — the dashboard poll PiFire's UI uses
GET  /api/hopper     {"hopper_level", "hopper_pellets"}
POST /api/settings   partial settings document, deep-merged      (admin)
POST /api/control    partial control document, e.g. {"updated": true, "mode": "Startup"}   (admin)
```

Differences from PiFire: authentication is required; `POST /api/settings` cannot touch `versions`,
`server_info` or `server.auth`; there is no socket.io endpoint (the Android app's live view polls
`/api/current`, which works). `GET` and `POST` are both accepted for the verbs, as in PiFire.

### Home Assistant example

```yaml
rest:
  - resource: http://pifire.local/api/get/current
    headers:
      X-API-Key: !secret fireai_key
    sensor:
      - name: Grill temperature
        value_template: "{{ value_json.data.P.Grill }}"
        unit_of_measurement: "°F"
rest_command:
  fireai_hold_225:
    url: http://pifire.local/api/set/mode/hold/225
    headers: { X-API-Key: !secret fireai_key }
```

## FireAI API (`/api/v1`)

| Area | Endpoints |
|---|---|
| Auth | `GET auth/status`, `POST auth/setup`, `POST auth/login`, `POST auth/password`, `GET auth/me`, `GET/POST/DELETE auth/api-keys` |
| State | `GET state` (the dashboard document), `WS /ws/state?token=` (pushed on change), `GET history?limit=`, `GET events`, `GET metrics`, `GET metrics.csv` |
| Commands | `GET commands` (registry with JSON schemas), `POST commands/{name}` with `{"args": {...}}` — `mode.startup`, `mode.hold {setpoint}`, `setpoint`, `pmode`, `smoke_plus`, `timer.start`, `notify.set`, `manual.output`, `recipe.start`, `settings.patch`, `system.restart_control` … |
| Settings | `GET settings` (redacted), `GET settings/schema` (form definition), edits go through the `settings.patch` command |
| Probes | `GET/PUT probes/config`, `POST probes/devices/template`, `PUT/DELETE probes/profiles`, `GET probes/devices`, `POST bluetooth/scan`, `GET bluetooth/diagnostics` |
| Library | `cooks` (list, get, patch, comments, photos, thumbnail, download, import, delete), `recipes` (same + parts), `pellets` (profiles, lists, load, log), `logs` |
| System | `system/info`, `system/backup`, `system/restore`, `system/update/*`, `system/whats-new`, `hardware` (catalogue + apply), `hardware/wizard/dismiss`, `tuner/*` |

Command results are `{"result": "OK"|"ERROR", "message": "...", "data": {...}}`; validation errors are HTTP 422
with the Pydantic detail. In cloud mode the app sends the same command names through the `sendCommand` Cloud
Function (see [CLOUD.md](CLOUD.md)); the grill's bridge applies them with the same registry.
