# Local-only operation

FireAI does not need an account, an internet connection or Firebase. Everything below works with the
Pi and your phone on the same network.

## First boot

1. Install with `deploy/install.sh` and open `http://<pi-ip>/`.
2. **Set the admin password.** Until you do, every API endpoint answers `403 setup_required`; a
   freshly imaged Pi is never controllable from the network by accident.
3. Sign in on each device you use. Sessions are JWTs valid for 30 days, stored in the browser.
4. Add the app to your home screen (**Settings → App → Install**) for the full-screen experience.

## Processes

| supervisor program | what | logs |
|---|---|---|
| `fireai-control` | the control loop (`control.py`) | `data/logs/control.*.log`, `events.log` |
| `fireai-server` | FastAPI on `127.0.0.1:8080`, proxied by nginx | `data/logs/server.*.log` |
| `fireai-bridge` | cloud sync; idles when not paired or when `cloud.enabled` is off | `data/logs/bridge.*.log` |

`sudo supervisorctl status fireai:*` shows them; **Settings → System** restarts the control process,
reboots or powers off, and downloads/restores backups (settings + pellet database).

## Layout

```
/opt/fireai/
  current -> releases/2.0.0/      code + prebuilt web app
  releases/<version>/
  data/                           settings.json, pelletdb.json, history/, recipes/, logs/, backups/
    bridge/credentials.json       only exists when paired (0600)
  venv/
```

Symlinks in `data/` point at the release's module folders so the processes can run with the data
directory as their working directory, exactly like PiFire did.

## Keeping the cloud off

- Never pair, or **Settings → Cloud → Unpair** to delete the credentials.
- **Settings → Cloud → Run the cloud bridge** off keeps credentials but stops all syncing.
- Notifications still work through Apprise, Pushover, Pushbullet, IFTTT, MQTT/Home Assistant,
  InfluxDB and WLED (**Settings → Notifications**).

## Development

`scripts/simulate.py --with-server` runs the control loop against the thermal simulator and the API
in one process with an in-memory Redis (`FIREAI_FAKE_REDIS=1`), on any OS. Set
`FIREAI_AUTH_DISABLED=1` to skip the password during development.
