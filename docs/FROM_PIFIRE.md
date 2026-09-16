# Coming from PiFire

FireAI is a hard fork of [PiFire](https://github.com/nebhead/PiFire). The control loop, controllers,
probe/display/platform modules, settings, cook files and recipe files are PiFire's. What changed is
around them.

## What is the same

- `settings.json`, `pelletdb.json`, `.pifire` cook files and `.pfrecipe` recipes — same formats. Your
  PiFire **backup** restores into FireAI (Settings → System → Restore); cook files import one by one.
- Hardware: every PiFire board, display, probe device, distance sensor and Bluetooth probe module,
  including the 1.11 bleak-based ones.
- The physical display menus.
- The HTTP API: `/api/get|set|cmd|sys`, `/api/settings|control|current|hopper` behave as documented at
  docs.pifire.io, so Home Assistant, Node-RED and the PiFire Android app keep working — with a credential
  (see below).

## What is different

| PiFire | FireAI |
|---|---|
| Flask web UI, jQuery templates | React app, installable on the phone (Settings → App → Install) |
| No authentication | Admin password on first boot; sessions; **API keys** for integrations (Settings → System) |
| Configuration wizard `wizard.py` | First-run wizard in the app; Settings → Hardware afterwards |
| `supervisorctl restart control` / `webapp` | programs `fireai-control`, `fireai-server`, `fireai-bridge` |
| `/usr/local/bin/pifire` | `/opt/fireai` (`current` → release, `data/` for settings, history, recipes, logs) |
| `updater.py` (git branches) | GitHub Releases tarball + checksum, Settings → System → Update |
| Redis with persistence flags set at runtime | Redis configured memory-only by the installer |
| Remote access = VPN | Optional cloud: pair once, monitor and (if enabled) control from anywhere; the grill never depends on it |
| Android app push via middleware | Web push from the FireAI app itself (Android, desktop, iOS 16.4+ installed PWA) |
| Admin → data management | Settings → System → Maintenance |
| `post-update-message.html` | `updater/whats-new.md`, shown once after an upgrade |

## Migrating

1. On the PiFire, Admin → Backup settings and pellet DB. Optionally download cook files from History.
2. Flash a fresh Raspberry Pi OS Lite (64-bit recommended) and run the FireAI installer
   (`deploy/install.sh`), or install on the same Pi — FireAI does not touch `/usr/local/bin/pifire`, but
   both cannot own port 80 and Redis at once, so disable PiFire's supervisor programs first.
3. Open `http://<pi>/`, set the password, then **Settings → System → Restore** with the backup. Probe
   devices, profiles, notifications and controller settings come across; the wizard is skipped because
   the restore carries `first_time_setup: false`.
4. **Settings → Hardware** to confirm the board and display; **Settings → Probes** to review devices.
5. Import cook files from **Cooks → Import**.
6. Integrations: create an API key under **Settings → System → API keys** and send it as `X-API-Key`
   (Home Assistant, Node-RED). Clients that only know HTTP basic authentication — the PiFire Android
   app's server credentials, for example — work too: any user name, the API key as the password.

## Contributing back

Probe, display, platform and controller modules are unchanged in layout, so a module written for FireAI
runs on PiFire and vice versa. Please send hardware modules upstream to nebhead/PiFire's `development`
branch as well — that is where the community is.
