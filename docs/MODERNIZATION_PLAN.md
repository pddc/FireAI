# Modernization Plan

Status: **approved direction** (2026-09-16), revised after code review the same day (see §9)
Origin: hard fork of [nebhead/PiFire](https://github.com/nebhead/PiFire) v1.10.x (MIT). No upstream merge-ability required; this project becomes its own entity.

## Decisions taken

| # | Decision | Choice |
|---|---|---|
| 1 | Upstream relationship | Hard fork. Free to restructure any module. |
| 2 | Frontend stack | Vite + React 19 + TypeScript + Tailwind + shadcn/ui, PWA via `vite-plugin-pwa` |
| 3 | Cloud scope v1 | Monitoring **and** control commands from the cloud |
| 4 | Local-only mode | Must always work with no Firebase account / no internet |
| 5 | Reference hardware | PCB v4.x modular board, multiple wired probes, **ThermoMaven G1** (WiFi→cloud device, new driver required) |

## Guiding principles

1. **The controller is local; the cloud is a mirror.** `control.py` never depends on the network. Safety logic (over-temp, flame-out, re-ignite, manual-override timeouts) stays in the control process untouched.
2. **One UI, two transports.** The same SPA build runs from Firebase Hosting (talks to Firebase) and from nginx on the Pi (talks to the local API). A runtime flag selects the data source.
3. **Every cloud command is authenticated, scoped, time-limited, and acknowledged.**
4. **Tests before refactors.** The existing code has zero tests; nothing in `common/` or `control.py` is touched until a simulator harness and pytest baseline exist.
5. **Secrets are write-only.** Notification tokens etc. never leave the Pi via any API.

---

## 1. Current-state findings

### Security (blocking for cloud exposure)
- No authentication on any route, including `/admin` reboot/shutdown and `/api/settings` (returns notification tokens in plaintext).
- Mutating API accepts `GET` (`/api/set/mode/startup` works from an `<img>` tag). CSRF-able.
- `SocketIO(cors_allowed_origins="*")`.
- Hardcoded `/usr/local/bin/pifire/...` paths in `blueprints/api/routes.py`.

### Architecture / performance
- `/api/current` polled every 500 ms per client; each call re-reads `settings.json` from the SD card.
- `common/common.py` is 3,183 lines; `process_command()` ~660 lines of nested `if/elif`; imported via `from common import *`.
- `execute_control_writes()` is a non-atomic read→`deep_update`→write while the control loop also does direct writes; updates can be lost.
- Gunicorn `-k eventlet -w 1`; eventlet is in maintenance mode.
- `SocketIO` instantiated twice in `app.py`.
- `display/base_{240x240,240x320,320x480}.py` are ~1,400-line near-copies.
- `uuid==1.30` in `requirements.txt` (bogus 2006 package; stdlib wins, remove).
- Updater is `git pull` from upstream; breaks on fork.

### Product / UX
- Settings is one 2,358-line template with full-page form POSTs.
- Live history capped at 28,800 Redis rows (~8 h at 1 s). Long-term history requires self-hosted InfluxDB.
- Mobile is responsive Bootstrap 4, not app-like: no bottom nav, no offline, no push, `user-scalable=no`.
- Single grill, no accounts, no sharing.

### Hardware gaps for the reference build
- ThermoMaven G1 (model `WT10`) has no driver. It is **not** a BLE-to-Pi device: the base station talks WiFi → ThermoMaven cloud (AWS IoT Core MQTT). Protocol is documented by the reverse-engineered [djiesr/thermomaven-ha](https://github.com/djiesr/thermomaven-ha) (MIT):
  - REST `https://api.iot.thermomaven.com` — `POST /app/account/login` (email + MD5 password), requests signed `MD5(app_key|sorted x-* headers|body)` with an app key extracted from the Android app; `POST /app/mqtt/cert/apply` returns a P12 client cert + `clientId` + `subTopics`.
  - MQTT over TLS 8883 to `a2ubmaqm3a642j-ats.iot.{us-west-2|eu-central-1}.amazonaws.com`, subscribe `app/user/{userId}/sub`; `WT:*:status:report` messages carry `probes[].curTemperature` (tenths °F), `batteryValue`, RSSI, targets; `WT:probe:control` publishes set targets.
  - Deps: `paho-mqtt` (already in requirements), `cryptography`/`pyOpenSSL` for P12 → PEM.
  - Consequences: G1 data requires internet and an unofficial app key that could be rotated; wired probes stay the local fallback. ThermoMaven credentials become another write-only secret on the Pi.

---

## 2. Target architecture

```
┌──────────────────── Raspberry Pi ────────────────────┐        ┌──────────── Firebase ────────────┐
│  control.py ──► Redis ◄── bridge/cloud_bridge.py ─────┼──────► │  Realtime DB   (live state, 1 Hz) │
│  (safety-critical,       │  ▲   validates TTL/nonce,  │ ◄──────┼─ commands/{grillId}/{cmdId}       │
│   unchanged loop)        ▼  │   applies, acks        │        │  Firestore  (cooks, recipes,      │
│  server/ FastAPI ────────┘  │                        │        │              pellets, settings)   │
│  (JWT + Firebase ID tokens) │                        │        │  Storage    (cook photos, .pifire)│
│  nginx ─► web/ SPA (local mode)                      │        │  Functions  (pairing, FCM, archive)│
└───────────────────────────────────────────────────────┘        │  Auth · App Check · Hosting (SPA) │
                                                                 └───────────────────────────────────┘
                                                                              ▲ phone / tablet / desktop PWA
```

**Why RTDB for live state, Firestore for documents:** 1 Hz telemetry into Firestore is ~86k writes/day/grill (free tier: 20k). RTDB bills on bandwidth; a ~300-byte state at 1 Hz is negligible and gives sub-100 ms fan-out. Documents (cooks, recipes, pellets, settings) go to Firestore.

### Cloud command safety contract
- Commands are created only by the `sendCommand` callable Function, which checks `uid ∈ grills/{grillId}.members`, validates the schema and writes `{ type, args, uid, createdAt: <server timestamp>, nonce, status }` to RTDB. Clients never set timestamps or expiry; rules deny direct client writes to `commands/`.
- Bridge rejects commands older than 30 s by its own NTP clock, replayed nonces, or unknown schemas, and writes `status: rejected` with a reason; accepted ones get `acked` then `done|failed`. Commands are never queued while offline.
- Local setting `cloud.control_enabled` (default **off**; enabled during pairing with explicit consent). `cloud.monitor_enabled` default on after pairing.
- Bridge and controller are separate supervisor programs. Bridge failure never affects the cook.
- Bridge heartbeat every 15 s to `/grills/{id}/presence` with `onDisconnect()` so the app can render "offline" honestly.

### Repo layout (target)

```
/
├── control.py, controller/, grillplat/, probes/, display/, distance/, notify/   # hardware + control (kept, tested, lightly cleaned)
├── core/                    # new infrastructure (redis_client, models, commands); common/common.py stays as a façade and is strangled over time
├── server/                  # FastAPI: REST + WebSocket, auth, OpenAPI
├── bridge/                  # cloud_bridge.py (REST/SSE as a scoped user; events/samples may queue, commands never)
├── web/                     # Vite/React/TS PWA (single build, local + cloud modes)
├── firebase/                # functions/, rules, emulators config, firebase.json
├── deploy/                  # install.sh, nginx, supervisor, release packaging
├── tests/                   # pytest; simulator fixtures
└── docs/
```

Legacy `blueprints/`, `templates/`, `static/`, `app.py`, `wizard.py`, `updater.py` are removed in Phase 5. The legacy socket.io namespace used by the community Android app is dropped (hard fork; our PWA replaces it).

---

## 3. Firebase data model (v1)

```
RTDB
  /grills/{grillId}/state            { mode, status, temps:{P,F,AUX}, setpoint, notifyTargets, outpins, timer,
                                       lidOpen, hopper, pMode, sPlus, criticalError, ts }
  /grills/{grillId}/presence         { online, lastSeen, bridgeVersion }
  /grills/{grillId}/commands/{cmdId} { type, args, uid, issuedAt, expiresAt, nonce, status, error?, ackedAt?, doneAt? }
  /grills/{grillId}/events           rolling last 200 event lines

Firestore
  users/{uid}                                  { displayName, units, fcmTokens[], grillIds[] }
  grills/{grillId}                             { name, ownerUid, members:{uid:'owner'|'member'|'viewer'}, board, firmware, pairedAt }
  grills/{grillId}/settings/current            mirror of settings.json with secrets stripped
  grills/{grillId}/cooks/{cookId}              { startedAt, endedAt, title, notes, probeLabels, stats }
  grills/{grillId}/cooks/{cookId}/samples/{n}  downsampled (10 s) series, ~1 h per chunk doc
  grills/{grillId}/pellets/archive/{id}, pellets/current
  grills/{grillId}/recipes/{recipeId}
  grills/{grillId}/notifyRules/{ruleId}        per-probe / timer rules (mirror of control.notify_data)

Storage
  grills/{grillId}/cooks/{cookId}/photos/*
  grills/{grillId}/cooks/{cookId}/cook.pifire
```

**Pairing:** Pi wizard shows a 6-digit code + QR. Signed-in user enters it → Cloud Function `pairGrill` creates `grills/{grillId}`, mints a scoped custom token for the bridge, returns it via a one-time claim doc. Bridge stores `bridge/credentials.json` (mode 600).

---

## 4. Phases (revised 2026-09-16 after code review)

Vertical slices, each shippable. Effort is calendar weeks, one developer part-time with AI assistance.
A usable new dashboard lands at the end of slice B (~week 3).

### Slice A — Foundation (1–2 wks)
Deliverable: the whole stack runs on a laptop with simulated hardware; a simulated cook runs in seconds under pytest; CI is green.
- [x] Rename to **FireAI**; `pyproject.toml`; `core/redis_client.py` with `FIREAI_FAKE_REDIS` for in-process fakeredis.
- [x] pytest harness (isolated workdir, fake Redis) + baseline tests: settings, control state, commands, history, PID controllers.
- [ ] Make `control.py` importable: wrap module-level code in `main()`; inject a clock (`time.time`/`time.sleep`) so tests run accelerated. **This is the only structural change to control.py.** Work-cycle logic is not edited.
- [ ] Golden simulated-cook tests: startup→smoke→hold→shutdown, startup failure → reignite, over-temp → error, lid-open pause, prime, manual. These are the regression guard for everything after.
- [ ] `scripts/simulate.py`: runs control + API in one process on fakeredis for local dev; `docker-compose.dev.yml` (Redis) for the multi-process layout.
- [ ] GitHub Actions: ruff + pytest (+ web build/test from slice B). Un-ignore `test_*.py` in `.gitignore`.
- [ ] Quick fixes: remove `uuid` dep, dedupe `SocketIO`, remove hardcoded paths, disable legacy updater.
- [ ] **ThermoMaven G1 driver** (`probes/cloud_thermomaven.py`): port login/sign/cert/MQTT from `thermomaven-ha`; paho-mqtt in a background thread feeding a `temp_queue` per probe (same shape as `bt_ibbq.py`); up to 4 probes per G1; battery/RSSI as probe status; connect with timeouts in the background so a missing internet connection never delays control startup; register in wizard manifest + `probes/probes.json`; credentials write-only.

### Slice B — Local API + new dashboard (2–3 wks)
Deliverable: FireAI dashboard replaces the PiFire dashboard, served by nginx on the Pi, local mode only.
- [ ] `server/` FastAPI + uvicorn. **Strangler pattern:** `common/common.py` stays as a façade; new `core/` modules are written for the server and legacy callers migrate one at a time. No big-bang split.
- [ ] Pydantic models for `Current`, `Control`, `Command`, `Settings` (settings model carries UI metadata: label, help, group, widget, min/max, enum — see slice E).
- [ ] Auth: single local admin password (argon2) set in the wizard on first boot → JWT bearer. API unreachable off-box until set. All mutations POST/PUT/DELETE; secrets write-only.
- [ ] `WS /ws/state` pushing on change (≤1 Hz). Settings cached in-process, invalidated on write.
- [ ] Typed command registry (`core/commands.py`) replacing `process_command`'s if/elif tree, with a compatibility shim so the legacy Flask app keeps working during the transition.
- [ ] `web/`: Vite + React 19 + TS + Tailwind + shadcn/ui; design tokens; `GrillSource` interface with a `LocalSource` (REST + WS). Dashboard screen with full parity to `dash_default`. Playwright smoke test against `scripts/simulate.py`.
- [ ] OpenAPI → `web/src/api/schema.d.ts` in CI.

### Slice C — Cloud monitoring (2–3 wks)
Deliverable: sign in on the hosted app, pair the grill, watch it live from anywhere, get push notifications.
- [ ] Firebase project: Auth (Google + email), RTDB, Firestore, Storage, Functions (TS), App Check, Hosting, budget alerts. Emulator suite + rules unit tests in CI.
- [ ] Pairing: wizard shows 6-digit code + QR → `pairGrill` callable creates `grills/{id}`, mints a **custom token**; bridge exchanges it via Identity Toolkit REST for an ID token + refresh token and stores them (0600). **No `firebase-admin` / service account on the Pi.** The bridge is an ordinary scoped user subject to security rules.
- [ ] `bridge/`: separate supervisor program. Polls `control:current` at 1 Hz → RTDB `state` via REST (change-only). Presence heartbeat with `onDisconnect`. Continuous sample streaming: 10 s downsample, batched to Firestore `cooks/{id}/samples` every 2–5 min (so long cooks are never truncated by the 8 h Redis window). Uploads `.pifire` + photos to Storage at cook end.
- [ ] Notify events: control process publishes to a Redis stream (`notify:events`); bridge forwards to `onNotifyEvent` → FCM. Existing Pushover/Apprise/etc. untouched.
- [ ] `CloudSource` in `web/` (RTDB + Firestore SDK). **Transport rule:** hosted app ↔ cloud only; Pi-served app ↔ local only (browsers block HTTPS→HTTP mixed content, so there is no hybrid).
- [ ] Bridge observability: `grills/{id}/bridge` status doc + last-50 error ring.

### Slice D — Cloud commands (1–2 wks)
Deliverable: full control from the hosted app.
- [ ] `sendCommand` callable: validates membership + schema, writes to RTDB `commands/{id}` with **server timestamp**; clients never set expiry. Bridge listens via SSE, rejects anything older than 30 s by its own NTP clock or with a seen nonce, applies via the local command registry, writes `acked` → `done|failed`. **Commands are never queued while offline.**
- [ ] Local `cloud.control_enabled` opt-in (default off; set during pairing with explicit consent).
- [ ] `settings.patch` command is the only write path for settings from the cloud; bridge applies locally and mirrors back to `settings/current`. Rules deny direct writes to the mirror.
- [ ] UI: pending/acked/done states on every control; disabled with reason when `control_enabled` is off or grill offline.

### Slice E — Schema-driven settings + the long tail (4–6 wks)
Deliverable: everything configurable in PiFire is configurable in FireAI, in both modes.
- [ ] One form renderer driven by the Pydantic JSON schema + UI metadata (groups, widgets, conditional visibility, units). Settings, notification services (Apprise, Pushover, Pushbullet, IFTTT, OneSignal, MQTT, InfluxDB, WLED), PWM/fan, safety, startup/shutdown, smoke plus, pellet level, display config, controller config all come from schema, not hand-built forms.
- [ ] Hand-built screens where schema forms don't fit: History/live graph (uPlot), Cook library + editor (notes, photos), Recipes (viewer, editor, run), Pellets manager, Probe map/profiles editor, Tuner + auto-tune guided flow, Manual mode, Events/Logs, Admin (backup/restore, reboot, update), Wizard (local only; board + per-pin config, module selection).
- [ ] Multi-grill switcher and member roles.
- [ ] Legacy Flask UI removed once each page has parity (tracked per page).

### Slice F — Native-feel PWA (1–2 wks)
- [ ] Bottom tabs, safe-area insets, `100dvh`, standalone display, skeletons, haptics; manifest + maskable icons + splash; install prompts; FCM web push on Android/desktop and iOS 16.4+ installed PWAs; shell + last state cached offline with controls disabled and an explicit "grill offline" state. Budget ≤200 KB initial JS, LCP <1.5 s.
- [ ] (Later, optional) Capacitor wrap for store distribution.

### Slice G — Cutover and packaging (1–2 wks)
- [ ] nginx: `/` → SPA, `/api` + `/ws` → FastAPI. Remove Flask, Jinja, jQuery/Bootstrap assets, legacy socket.io, eventlet/gunicorn.
- [ ] `deploy/install.sh` (supervisor programs `control`, `server`, `bridge`), web prebuilt in CI and shipped in a release tarball (no Node on the Pi). Install path `/opt/fireai`.
- [ ] Release-based updater with checksum + rollback; `upgrade_settings` migrator extended for the FireAI schema.
- [ ] Docs: pairing, security model, local-only setup, hardware (PCB v4.x, ThermoMaven G1).

## 5. Enhancements folded in

- Probe ETA / "done at" on the dashboard (surface existing `_estimate_eta`).
- Multi-grill and shared access (owner/member/viewer).
- Long-term cook history in Firestore (no InfluxDB requirement).
- Public read-only cook share links.
- Guided auto-tune flow.
- Home Assistant / MQTT documented as first-class.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Regressing safety logic | `control.py` gets only a `main()` wrapper + injectable clock; golden simulated-cook tests run in CI; `common/` is strangled, never split big-bang. |
| Untrusted client clocks / replayed commands | Commands only via `sendCommand` callable with server timestamps; bridge enforces TTL against NTP + nonce; never queued offline. |
| Service-account key on a consumer device | Bridge authenticates as a scoped user (custom token → ID token via REST); rules apply to it like any client. |
| Mixed-content between hosted app and LAN Pi | Explicit transport rule: hosted ↔ cloud, Pi-served ↔ local. |
| Parity long tail balloons | Schema-driven settings renderer; hand-built screens limited to the list in slice E. |
| Firebase cost | RTDB for hot data, change-only writes, 10 s downsampling for archives, budget alerts. Expected ≈ $0/mo for a household. |
| Stale cloud command executes | TTL + nonce + ack; UI renders ack state. |
| ThermoMaven unofficial API breaks (app key rotated, endpoint change) | Driver isolated behind the probe-device interface; fails to "disconnected", never blocks the control loop; wired probes cover the cook. Track `thermomaven-ha` for protocol updates. |
| iOS PWA limits | Documented; Capacitor is the escape hatch. |

## 7. Timeline

~14–20 weeks to full cutover. New dashboard usable in local mode at ~week 3 (end of slice B); cloud monitoring ~week 6; cloud control ~week 8; the settings long tail is the bulk of the remainder.

## 8. Open items

- Project name / branding (needed by Phase 5, nice to have earlier for the Firebase project ID).
- Confirm exact PCB v4.x sub-modules in use (relay/fan board, probe ADC module) for the simulator config and wizard tests.
