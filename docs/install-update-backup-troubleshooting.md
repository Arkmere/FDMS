# Vectair Flite — Installation, Update, Backup, and Troubleshooting

---

## Installation

### Windows

1. Download the NSIS installer (`Vectair Flite_x.x.x_x64-setup.exe`) from the release.
2. Run the installer and follow the prompts.
3. After installation, Vectair Flite is available from the Start Menu and as a desktop shortcut.

If you are downgrading from a previously installed `1.0.x` build (such as `1.0.3`) to a lower version number (such as `0.9.0`), Windows version ordering requires a manual uninstall first:

> **Apps & features → Vectair Flite → Uninstall**

Then install the new version.

### Linux

1. Download the `.deb` or `.rpm` package from the release.
2. Install using the appropriate package manager:

```bash
# Debian/Ubuntu
sudo dpkg -i "Vectair Flite_x.x.x_amd64.deb"

# RPM-based
sudo rpm -i "Vectair Flite-x.x.x-1.x86_64.rpm"
```

3. Launch Vectair Flite from your application menu or by running `vectair-flite`.

---

## First launch

On first launch the application will start with empty data and default configuration. No pre-loaded operational data is included.

Flite runs fully offline. No network connectivity is required for normal operation.

---

## Updating

### In-app update (recommended)

1. Open **Admin → System Status**.
2. In the **Updates** panel, click **Check for updates**.
3. If an update is available, click **Download and install update**.
4. When complete, click **Restart Flite** to apply the update.

Update checking is operator-initiated only. The app never checks for updates at launch or in the background.

> **Recommendation:** Take an Admin → Session Management backup before installing a major update.

### Manual reinstall

Download and run the new installer directly. On Windows, you may need to uninstall the previous version first if the version number is lower than the installed version (see Installation above).

---

## Backup and restore

### Taking a backup

1. Open **Admin → Session Management**.
2. Click **Backup to JSON**.
3. Choose a save location and filename. The default format is `vectair-flite-backup-YYYYMMDD-HHMMSS.json`.

The backup covers:

- Movements
- Configuration (including Admin settings)
- Cancelled sorties
- Deleted strips
- Booking profiles
- Calendar events
- Hours log

### Restoring a backup

1. Open **Admin → Danger Zone → Restore from JSON**.
2. Select your backup file.
3. Confirm the import. A preflight summary shows record counts before you proceed.
4. **Reload the app** after restoring (Admin → System Status → Reload App, or close and reopen Flite).

> **Warning:** Restoring overwrites current data. Take a backup of the current state before restoring if you may need it.

### Backup before switching environments

Data is stored in the WebView `localStorage` profile, which is specific to the environment:

- Installed desktop app
- Tauri development mode
- Browser harness

Data entered in one environment does not automatically carry over to another. **Export a backup before moving between environments or machines.**

---

## Verifying after an update

### General post-update checks

- The app launches without errors.
- Live Board, History, Reports, and Admin all open correctly.
- Previously entered movements, configuration, and bookings are present.
- Exports work (History → Export as CSV, Reports → Export XLSX).

### Weather / METAR Builder

After updating to a version that includes the Weather / METAR Builder:

- Confirm the **Weather** tab appears in the navigation bar.
- Open the Weather tab and confirm the builder loads with an empty form.
- Confirm **Admin → Weather** settings are present and save correctly.
- Local browser storage may retain a previous builder state. The **Recall Previous** button (if available) restores the last copied observation. **Reset** clears the current builder form to defaults.

---

## Troubleshooting

### App shows a blank page or connection error (Tauri dev mode)

The Tauri development build connects to a local Python server. If the server is not running, the window will show a blank page or connection error.

Start the server before launching Tauri dev:

```powershell
python -m http.server 8000 --directory src
```

Then run:

```powershell
npm run tauri:dev
```

### Stale JavaScript or CSS after an update

The WebView may cache old JS/CSS.

In development (browser):

```
DevTools → Network → Disable cache → Reload
```

In the installed app:

```
Admin → System Status → Reload App
```

### Export Save As dialog does not appear

Native Save As is only available in the Tauri desktop app. In the browser harness, exports fall back to browser download behaviour.

Ensure you are running the installed desktop app, not the browser-only harness.

### Data appears missing after switching environments

Data is stored per-environment (installed app, Tauri dev, browser). See **Backup before switching environments** above. Restore a backup to transfer data between environments.

### Update check fails with "Offline" or no response

The update endpoint requires outbound HTTPS access to GitHub Releases. If Flite is running on a network without external access, update checks will fail gracefully with an "Offline" or unreachable status. The app remains fully functional offline; only the update check is affected.

### Registration CSV integrity check

After a major pull, merge, or reinstall, confirm the registration data file is intact:

```powershell
(Get-Content .\src\data\FDMS_REGISTRATIONS.csv).Count
```

Expected count: **25,713 lines**.
