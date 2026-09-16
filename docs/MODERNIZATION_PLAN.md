# Modernization Plan

Status: **approved direction** (2026-09-16)
Origin: hard fork of [nebhead/PiFire](https://github.com/nebhead/PiFire) v1.10.x (MIT). No upstream merge-ability required; this project becomes its own entity.

## Decisions taken

| # | Decision | Choice |
|---|---|---|
| 1 | Upstream relationship | Hard fork. Free to restructure any module. |
| 2 | Frontend stack | Vite + React 19 + TypeScript + Tailwind + shadcn/ui, PWA via `vite-plugin-pwa` |
| 3 | Cloud scope v1 | Monitoring **and** control commands from the cloud |
| 4 | Local-only mode | Must always work with no Firebase account / no internet |
| 5 | Reference hardware | PCB v4.x modular board, multiple wired probes, **ThermoMaven G1** (BLE, new driver required) |

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
- Command doc: `{ type, args, uid, issuedAt, expiresAt (≤30 s), nonce, status }`.
- Bridge rejects expired/replayed/unknown-schema commands and writes `status: rejected` with a reason; accepted ones get `acked` then `done|failed`.
- Firestore/RTDB rules enforce `uid ∈ grills/{grillId}.members` before a command is visible to the bridge.
- Local setting `cloud.control_enabled` (default **off**; enabled during pairing with explicit consent). `cloud.monitor_enabled` default on after pairing.
- Bridge and controller are separate supervisor programs. Bridge failure never affects the cook.
- Bridge heartbeat every 15 s to `/grills/{id}/presence` with `onDisconnect()` so the app can render "offline" honestly.

### Repo layout (target)

```
/
├── control.py, controller/, grillplat/, probes/, display/, distance/, notify/   # hardware + control (kept, tested, lightly cleaned)
├── core/                    # split of common/common.py: settings, control_state, history, pellets, commands, redis_client
├── server/                  # FastAPI: REST + WebSocket, auth, OpenAPI
├── bridge/                  # cloud_bridge.py + offline queue
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

## 4. Phases

Effort is calendar weeks, one developer part-time with AI assistance.

### Phase 0 — Foundation (1–2 wks)
Deliverable: the stack runs on a dev machine with simulated hardware; CI is green.
- [ ] Rename repo/package (placeholder: keep `PiFire` name in code until Phase 5; brand decision pending).
- [ ] `docker-compose.dev.yml`: Redis + `control.py` with `grillplat/prototype.py` + `probes/prototype.py`.
- [ ] `pytest` baseline: PID controllers, `deep_update`, settings upgrade/downgrade, `process_command` happy paths, cook-file round-trip, recipe unit conversion.
- [ ] GitHub Actions: ruff + pytest (+ web build/test from Phase 3).
- [ ] Quick fixes: remove `uuid` dep, dedupe `SocketIO`, remove hardcoded paths, disable legacy updater.
- [ ] **ThermoMaven G1 driver** (`probes/cloud_thermomaven.py`): port the login/sign/cert/MQTT client from `thermomaven-ha`; run paho-mqtt in a background thread that feeds a `temp_queue` per probe (same shape as `bt_ibbq.py`); map `probes[]` to PiFire probe ports (up to 4 per G1); expose battery/RSSI as probe status; reconnect with backoff and mark probes disconnected on auth/MQTT failure. Register in `wizard/wizard_manifest.json` + `probes/probes.json`; credentials + region entered in the wizard, stored write-only. Add `cryptography` to requirements.

### Phase 1 — Core split + local API (2–3 wks)
Deliverable: authenticated FastAPI with OpenAPI spec and push-based state; legacy Flask still serves the old UI.
- [ ] Split `common/common.py` → `core/*` behaviour-preserving (tests guard). Replace `from common import *`.
- [ ] Redis lock around control write queue; single `apply_command()` entry point with a typed command registry replacing the `process_command` if/elif tree.
- [ ] `server/`: FastAPI + uvicorn. Pydantic models for `Settings`, `Control`, `Current`, `Command`, `PelletDB`, `Recipe`, `Cook`.
- [ ] Auth: local admin password (argon2) → JWT; Firebase ID-token verification (for cloud-mode users hitting the Pi directly on LAN). Roles: owner/member/viewer.
- [ ] `WS /ws/state` pushing on change (≤1 Hz); settings cached in-process, invalidated on write.
- [ ] All mutations POST/PUT/DELETE; secrets write-only.
- [ ] Generate `web/src/api/schema.d.ts` from OpenAPI in CI.

### Phase 2 — Cloud bridge + Firebase backend (2–3 wks)
Deliverable: grill state visible and controllable from Firebase with the emulator suite and rules tests passing.
- [ ] `bridge/cloud_bridge.py`: Redis keyspace subscribe → RTDB state (change-only, ≤1 Hz); commands listener with TTL/nonce/ownership checks → local API → ack; presence heartbeat; offline queue with replay; supervisor program.
- [ ] Firebase project: Auth (Google + email), RTDB, Firestore, Storage, Functions (TS), App Check, Hosting. Budget alerts.
- [ ] Rules + rules unit tests (emulator).
- [ ] Functions: `pairGrill`, `unpairGrill`, `onCommandCreate` (schema + membership validation), `archiveCook` (pull downsampled series + `.pifire` + photos via bridge), `onNotifyEvent` → FCM, `cleanupStaleCommands` (scheduled).
- [ ] Settings mirror (stripped) + two-way sync with conflict rule: Pi wins.
- [ ] Wizard pairing screen (temporary, in legacy UI) so cloud can be tested before Phase 3.

### Phase 3 — New web UI (4–6 wks)
Deliverable: feature parity with the Flask UI, served locally by nginx and from Firebase Hosting.
- [ ] Design tokens + component library (dark-first, light theme). Mockups for Dashboard and mobile flows approved before screens are built.
- [ ] Data layer: TanStack Query over local API; Firebase SDK adapters; single `GrillSource` interface selected at runtime.
- [ ] Screens, in order: Dashboard → History/live graph (uPlot) → Cook library → Recipes → Pellets → Settings (sectioned, per-section save, schema-driven validation) → Probe config + Tuner → Manual → Events/Logs → Admin → Wizard (local-only).
- [ ] Multi-grill switcher (data model already supports it).
- [ ] Playwright smoke tests against the simulator stack.

### Phase 4 — Mobile "native-feel" PWA (2–3 wks)
Deliverable: installable app on Android and iOS with push notifications.
- [ ] App shell: bottom tabs (Dashboard · Graph · Cooks · More), safe-area insets, `100dvh`, standalone display, gesture-safe scrolling, skeletons, haptics.
- [ ] Manifest with maskable icons + splash; `beforeinstallprompt` (Android); iOS A2HS guidance.
- [ ] FCM web push (Android/desktop; iOS 16.4+ installed PWA). Notification rules editable in-app.
- [ ] Offline: shell cached by service worker, last state in IndexedDB, controls disabled with explicit "grill offline" state.
- [ ] Performance budget: ≤200 KB initial JS, LCP <1.5 s mid-range Android.
- [ ] (Optional, later) Capacitor wrap for store distribution.

### Phase 5 — Cutover, packaging, cleanup (1–2 wks)
- [ ] nginx: `/` → SPA, `/api` + `/ws` → FastAPI. Remove Flask, Jinja templates, jQuery/Bootstrap assets, legacy socket.io.
- [ ] `deploy/install.sh` for supervisor programs `control`, `server`, `bridge`; web prebuilt in CI and shipped as a release tarball (no Node on the Pi).
- [ ] New updater: GitHub Releases tarball + checksum, applied by the server with rollback.
- [ ] Docs: pairing, security model, local-only setup, hardware (PCB v4.x, ThermoMaven G1).
- [ ] Final rename/branding.

---

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
| Regressing safety logic during `common/` split | Tests first; `control.py` work-cycle untouched; simulator in CI. |
| Firebase cost | RTDB for hot data, change-only writes, 10 s downsampling for archives, budget alerts. Expected ≈ $0/mo for a household. |
| Stale cloud command executes | TTL + nonce + ack; UI renders ack state. |
| ThermoMaven unofficial API breaks (app key rotated, endpoint change) | Driver isolated behind the probe-device interface; fails to "disconnected", never blocks the control loop; wired probes cover the cook. Track `thermomaven-ha` for protocol updates. |
| iOS PWA limits | Documented; Capacitor is the escape hatch. |

## 7. Timeline

~12–19 weeks to full cutover. Usable new dashboard + cloud monitoring lands around week 6–8 (end of Phase 2 / early Phase 3).

## 8. Open items

- Project name / branding (needed by Phase 5, nice to have earlier for the Firebase project ID).
- Confirm exact PCB v4.x sub-modules in use (relay/fan board, probe ADC module) for the simulator config and wizard tests.
