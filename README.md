# FireAI

**A modern, cloud-connected controller for pellet smokers.** FireAI is a hard fork of the excellent
[PiFire](https://github.com/nebhead/PiFire) project: the proven control loop, PID controllers,
probe and display drivers stay; everything around them is new.

- **Dashboard that feels native** — installable PWA (Android, iOS, desktop) with live gauges,
  one-tap modes, notifications, timer and cook history.
- **Cloud, optional** — pair the grill with your FireAI account to watch and control it from
  anywhere and get push notifications. Or don't: every feature works on your LAN with no account.
- **Safety first** — the controller runs entirely on the Pi. The cloud is a mirror; every remote
  command is authenticated, scoped to your grill, expires in 30 s, and is acknowledged.
- **Everything configurable** — every setting PiFire had is editable in the app, on the grill or
  from the cloud, through one schema-driven settings UI.
- **ThermoMaven support** — the G1/G2/G4 and P-series wireless probes join wired probes, Inkbird
  and Meater as probe devices.

> **Warning.** This project controls an igniter, an auger and a fan on a device that makes fire.
> Use at your own risk. Nothing here is certified for unattended use.

## Architecture

```
┌──────────────── Raspberry Pi ────────────────┐        ┌──────── Firebase ────────┐
│ control.py ──► Redis ◄── bridge/  ────────────┼──────► │ Realtime DB (live state) │
│ (safety-critical loop, unchanged from PiFire) │ ◄──────┼─ commands (server-timed) │
│ server/  FastAPI + WebSocket (:8080)          │        │ Firestore (cooks, settings)│
│ nginx  ─► web/dist (the PWA, local mode)      │        │ Functions · Auth · FCM    │
└───────────────────────────────────────────────┘        │ Hosting (the PWA, cloud)  │
                                                         └───────────────────────────┘
```

| Directory | What it is |
|---|---|
| `control.py`, `controller/`, `grillplat/`, `probes/`, `display/`, `distance/`, `notify/` | Hardware and control (PiFire lineage). `grillplat/simulator.py` + `probes/simulator.py` drive a thermal model for tests and dev. |
| `core/` | Command registry, settings schema, state snapshot, library (cooks/pellets/recipes), hardware config, tuner, updater, event stream. |
| `server/` | Local FastAPI API: auth, `/api/v1/*`, `/ws/state`. OpenAPI at `/docs`. |
| `bridge/` | Cloud bridge process (Firebase REST/SSE as a scoped user). |
| `web/` | React 19 + Vite + Tailwind PWA. One build, two modes (`VITE_FIREAI_MODE=local|cloud`). |
| `firebase/` | Security rules (tested in the emulator), Cloud Functions, hosting config. |
| `deploy/` | Pi installer, nginx and supervisor configs. |
| `tests/` | pytest suite incl. golden simulated cooks of the real control loop. |

## Install on a Raspberry Pi

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/fireai/main/deploy/install.sh | FIREAI_REPO=<owner>/fireai bash
```

Then open `http://<pi-ip>/`, set the admin password, and go to **Settings → Hardware** to pick your
board, display and probes (the PCB v4.x default probe map is one toggle). Reboot once on a fresh
install so SPI/I²C/PWM are enabled.

Upgrades happen in-app (**Settings → System → Software update**) from GitHub Releases, verified by
SHA-256, with the previous release kept for rollback.

## Develop on a laptop (no hardware, no Redis)

```bash
uv venv .venv && uv pip install -e ".[dev,server,bridge]"
FIREAI_AUTH_DISABLED=1 .venv/bin/python scripts/simulate.py --with-server --speed 10   # API on :8080
cd web && npm ci && npm run dev                                                          # app on :5173
```

Tests: `pytest` (Python), `cd web && npm test` (vitest), `npm run e2e` (Playwright against the
simulator), `cd firebase/functions && npm test`, and rules tests via
`firebase emulators:exec --only database,firestore "cd rules-tests && npx vitest run"`.

## Documentation

- [Modernization plan & design decisions](docs/MODERNIZATION_PLAN.md)
- [Cloud pairing and the security model](docs/CLOUD.md)
- [Hardware: boards, probes, ThermoMaven](docs/HARDWARE.md)
- [Local-only operation](docs/LOCAL.md)

## License

MIT — see [license.txt](license.txt). FireAI includes code from PiFire © Ben Parmeter and contributors.
