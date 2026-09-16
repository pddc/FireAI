# Hardware

FireAI runs on the same hardware as PiFire. The reference build is a **PiFire PCB v4.x modular
board** on a Raspberry Pi (3B+ or later recommended, Pi 5 supported), wired probes on the ADS1115
module, and a **ThermoMaven G1** wireless probe.

## Configuring hardware in the app

**Settings → Hardware** replaces PiFire's configuration wizard:

- **Controller board** — PCB 2.00a / 3.01a / PWM / 4.x.x or *Custom*. Pin assignments come from the
  board definition; toggle *Show pins* to override them.
- **Display** — any PiFire display module (ILI9341/9488, ST7789, SSD1306, DSI touch, none). The
  module's own options (rotation, SPI device, backlight…) appear underneath.
- **Pellet level sensor** — VL53L0X, HC-SR04 or none.
- **Units** and, optionally, the board's **default probe map**.

Saving writes settings and tells you whether a control restart or a reboot is needed. All hardware
module Python dependencies are installed by `deploy/install.sh`, so switching modules never runs
`pip` at runtime.

**Settings → Probes** manages probe *devices* (ADCs, RTD boards, Bluetooth, cloud, virtual), the
*probes* on their ports (name, type, profile, enabled) and Steinhart–Hart *profiles*.
**Settings → Probe tuner** fits new profiles manually or against a reference probe.

## ThermoMaven (G1 / G2 / G4 / P1 / P2 / P4)

These are **WiFi → cloud** devices: the base station talks to ThermoMaven's servers, not to the Pi.
FireAI's `probes/cloud_thermomaven.py` subscribes to the same MQTT stream the official app uses
(protocol documented by [djiesr/thermomaven-ha](https://github.com/djiesr/thermomaven-ha)).

Add it under **Settings → Probes → Add device → Cloud – ThermoMaven** and enter the account email
and password from the ThermoMaven app, your two-letter region (US, CA, UK, DE…), the device id if
the account has several thermometers, and the probe count (1 for G1/P1, 2 for G2/P2, 4 for G4/P4).

Ports per probe *n*:

| Port | Meaning |
|---|---|
| `Pn_MEAT` | internal (tip) temperature |
| `Pn_AMBIENT` | ambient sensor on the probe — can be used as the **Primary** pit probe |
| `Pn_AREA1..4` | zone temperatures along the probe, when the device reports them |

Notes:

- Readings need internet access on the Pi and go to *unavailable* after 3 minutes without an update.
  Wired probes keep working regardless.
- The integration uses an unofficial API and an app key extracted from the Android app. If
  ThermoMaven rotates it the device shows as disconnected and nothing else is affected.
- Credentials are stored only in `settings.json` on the Pi and are redacted from every API response,
  backup mirror and cloud document.

## Simulator

`grillplat/simulator.py` and `probes/simulator.py` drive a small thermal model (`core/sim.py`):
the auger adds pellets, the igniter lights them, the fan sets the burn rate, the pit integrates
heat minus loss, food probes lag the pit. `scripts/simulate.py` runs the real control process
against it — with `--speed 10` a four-minute startup takes 24 seconds — and the pytest suite runs
golden cooks (startup, hold, shutdown, over-temp, flame-out → re-ignite, prime, monitor) in seconds.
