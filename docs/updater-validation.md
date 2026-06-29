# Flite updater validation

Flite uses Tauri updater artifacts.

Current endpoint:
https://github.com/Arkmere/FDMS/releases/latest/download/latest.json

The public signing key is committed in src-tauri/tauri.conf.json.

The private signing key must never be committed.

Release/update builds require:
- TAURI_SIGNING_PRIVATE_KEY
- TAURI_SIGNING_PRIVATE_KEY_PASSWORD

For pre-V1 updater testing, use monotonically increasing 0.x versions, for example:
- installed test build: 0.9.0
- available update build: 0.9.1

Do not use 1.0.0 until the launch decision.

Validation path:
1. Install signed older build.
2. Publish signed newer GitHub Release containing latest.json and platform update artifacts.
3. Open older installed Flite.
4. Use Admin → Overview → Version & Updates → Check for updates.
5. Confirm newer version is detected.
6. Install update.
7. Restart Flite.
8. Confirm current version changed.
9. Confirm local data survived:
   - movements
   - VKB overrides
   - audit log
   - bookings/calendar
   - settings
