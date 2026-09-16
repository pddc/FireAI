# FireAI 2.0.0

FireAI is a fork of PiFire with a new app and an optional cloud.

## New

- **New app** — one responsive interface for phone, tablet and desktop; install it to the home screen for a full-screen, app-like experience with push notifications.
- **Cloud (optional)** — pair the grill once and watch or control it from anywhere. Remote control is off until you switch it on, and the grill keeps cooking without internet.
- **ThermoMaven G1 / G2 / G4 / P-series** wireless thermometers through the ThermoMaven cloud.
- **Thermal simulator** — run the whole controller on a laptop with `scripts/simulate.py`.
- **Hardware page** replaces the wizard: board, pins, display and pellet sensor in one place.
- **Cook library** — photos, notes, cover images, import and export of cook files and recipes.

## Changed

- Settings are generated from one schema, so every option is available locally and in the cloud app.
- The API is `/api/v1` with a password-protected session; the legacy Flask UI and its API were removed.
- Processes are `fireai-control`, `fireai-server` and `fireai-bridge` under supervisor.

Full notes: `docs/MODERNIZATION_PLAN.md`.
