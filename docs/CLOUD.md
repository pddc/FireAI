# Cloud: pairing, remote control and the security model

FireAI's cloud is a **mirror of the grill, not its brain**. The control loop on the Pi never waits
on the network; the cloud shows you what it is doing and, if you opt in, lets you send it commands.

## Pairing

1. On the grill (local app): **Settings → Cloud → Pair with the cloud**. The grill shows a 6-digit
   code that is valid for 10 minutes.
2. In the hosted app: sign in (Google or email), **Pair a grill**, type the code.
3. The grill polls until the pairing is claimed, receives its own cloud identity and starts syncing.

What happens underneath (`firebase/functions/src/index.ts`, `bridge/pairing.py`):

- The Pi calls `requestPairing` with the code and a **secret** it generated; only a hash of the
  secret is stored.
- Your signed-in app calls `pairGrill`, which creates the `grills/{grillId}` document with you as
  owner, adds `grills: {grillId: 'owner'}` to your custom claims, and mints a **custom token** for
  the bridge identity `grill_{grillId}` with claims `{bridge: true, grill: grillId}`.
- The Pi calls `claimPairing` with its secret, gets the custom token once, exchanges it for an ID
  token + refresh token via the Identity Toolkit REST API and stores the refresh token in
  `bridge/credentials.json` (mode 0600, outside `settings.json`, never backed up or mirrored).

There is **no service account on the Pi**. The bridge is an ordinary Firebase user subject to the
same security rules as the app.

## What is synced

| Where | What | Who writes |
|---|---|---|
| RTDB `grills/{id}/state` | dashboard snapshot, change-only, ≤ 1 Hz | bridge |
| RTDB `grills/{id}/presence` | `lastSeen` (server timestamp) every 15 s; the app shows *offline* after 45 s | bridge |
| RTDB `grills/{id}/notifications` | alerts (probe reached, timer, errors) → Cloud Function → FCM push | bridge |
| RTDB `grills/{id}/commands/{id}` | remote commands (see below) | Function creates, bridge updates status |
| Firestore `grills/{id}/settings/current` | redacted settings (no secrets, no local auth block) | bridge |
| Firestore `grills/{id}/settings/schema` | settings UI schema so the hosted app renders the same forms | bridge |
| Firestore `grills/{id}/cooks/*` + `samples/*` | cook archive, 10 s samples streamed every 2 min during the cook (long cooks are never truncated) | bridge |

Secrets (notification tokens, ThermoMaven credentials) are redacted before they leave the Pi.

## Remote commands

Commands can only be created by the `sendCommand` Cloud Function, which:

1. checks you are a member with a sufficient role (owner/operator/viewer),
2. validates the command name against the allow-list in `firebase/functions/src/lib/commands.ts`
   and a light argument schema,
3. checks the grill's mirrored `cloud.control_enabled` flag,
4. writes the command with a **server timestamp** and a random nonce.

The bridge applies a command only if **all** of these hold:

- local `cloud.control_enabled` is on (Settings → Cloud → *Remote control*, off by default),
- `createdAt` is within 30 s of the bridge's own clock (stale commands are rejected, never queued),
- the nonce has not been seen,
- the command is marked `cloud_allowed` in `core/commands.py` (reboot/shutdown never are).

It then writes `acked` → `done` / `failed` (or `rejected` with a reason) so the app can show the
outcome. The full Pydantic validation happens on the Pi in `core/commands.py`.

Settings edits from the cloud travel the same way, as `settings.patch` commands; direct writes to the
settings mirror are denied by rules.

## Members and roles

Owners add members by email (**Settings → Members**) as *operator* (can control) or *viewer*. Roles
live in `grills/{id}.members` **and** in each user's custom claims (`grills`), which RTDB and Storage
rules check. A user's token refreshes within an hour, or immediately on next sign-in.

## Running your own cloud

Create a Firebase project, enable Auth (Google + email), Realtime Database, Firestore, Storage,
Functions, Hosting and App Check, then:

```bash
cd firebase && firebase use <project>
firebase functions:config:set  # not used; params are set at deploy:
firebase deploy --only functions,firestore:rules,database,storage   # prompts for FIREAI_WEB_API_KEY / FIREAI_DATABASE_URL
cd ../web && cp .env.example .env.local   # fill in the web config, VITE_FIREAI_MODE=cloud
npm run build && cd ../firebase && firebase deploy --only hosting
```

Point the grill at your project with **Settings → Cloud → Advanced → Cloud Functions URL**. The
`release.yml` workflow deploys all of this automatically when the `FIREBASE_*` repository variables
and the `FIREBASE_SERVICE_ACCOUNT` secret are set.

Expected cost for a household: within the Firebase free tier (RTDB bandwidth for a 1 Hz 300-byte
state is negligible; cook samples are batched).
