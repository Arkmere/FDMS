# Vectair Flite — Quick Start Guide

Vectair Flite is a local desktop application for flight data management and ATC-style strip administration. It runs offline and stores all data locally.

---

## Launch

**Installed desktop app:**

Open the Start Menu and launch **Vectair Flite**, or double-click the desktop shortcut.

**Development harness (browser only):**

```powershell
python -m http.server 8000 --directory src
```

Then open `http://localhost:8000/` in a browser.

---

## Navigation

The primary navigation bar runs across the top of the application:

```
Live Board | Weather | Calendar | Booking | History | Reports | Cancelled | VKB Lookup | Admin
```

---

## Create a new flight strip

1. From **Live Board**, click **New** and select a movement type: **DEP**, **ARR**, **LOC**, or **OVR**.
2. Fill in callsign, registration, route, and timing.
3. Click **Save**. The strip appears on the Live Board.
4. Use **Activate** when the aircraft begins its movement and **Complete** when it finishes.

---

## Create a METAR/SPECI

The **Weather** tab is a structured drafting aid for METAR/SPECI-style reports. It does not fetch live weather; all values must be entered or confirmed by the operator.

A fresh builder contains no pre-filled operational weather values. Required fields are marked with a red asterisk (`*`). The **Copy** button is disabled until all mandatory fields are valid.

Optional sections (RVR, Recent Weather, Wind Shear, Runway State) may be hidden, collapsed, or expanded depending on **Admin > Weather** settings.

### Steps

1. **Open the Weather tab** from the navigation bar.

2. **Confirm Report type, station, and time.**
   - Select **METAR** or **SPECI**. METAR auto-sets the time to the most recent scheduled observation within the +5 min submission window. SPECI uses current UTC.
   - Confirm or edit the station identifier (default `EGOW`).
   - Confirm or adjust the observation time if needed.

3. **Enter wind.**
   - Select **Directional** (default), **Calm**, or **Variable**.
   - For directional wind: enter direction (010–360) and speed in knots. Add a gust speed if applicable (must be at least 10 kt above mean wind speed).

4. **Choose CAVOK, or enter visibility, weather, and cloud.**
   - Tick **CAVOK** only when visibility is 10 km or more, no cloud below 5,000 ft or MSA, and no significant weather.
   - If CAVOK is not ticked: enter **visibility** (4-digit metres), any **present weather** groups, and at least one **cloud layer** (FEW/SCT/BKN/OVC, or NSC for no significant cloud).

5. **Enter temperature, dew point, and QNH.**
   - Use `−5` or `M5` format for sub-zero temperatures. Dew point cannot exceed air temperature.
   - Enter QNH as a 3- or 4-digit value; it formats automatically as `Q####`.

6. **In Military mode: confirm colour state** (if the Colour State section is enabled in Admin > Weather).
   - Colour state is auto-derived from visibility and cloud. Accept or adjust as required.

7. **Resolve any validation errors.**
   - Errors are listed below the output panel. Blocking errors prevent Copy; advisory warnings are shown in amber.

8. **Copy the generated report.**
   - Click **Copy**. The report, including a trailing `=`, is placed on the clipboard for pasting into an email or operational communication.

---

## Backup your data

Before major updates or switching machines, take a backup:

1. Open **Admin → Session Management**.
2. Click **Backup to JSON** and save the file to a safe location.

To restore: open **Admin → Danger Zone → Restore from JSON**, import the backup, then reload the app.

---

## Update Flite

1. Open **Admin → System Status**.
2. In the **Updates** panel, click **Check for updates**.
3. If an update is available, click **Download and install update**.
4. Click **Restart Flite** to apply.

---

## Further reading

- `docs/user-guide.md` — full feature documentation including the Weather / METAR Builder.
- `docs/install-update-backup-troubleshooting.md` — installation, update, backup, and troubleshooting.
