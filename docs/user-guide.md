# Vectair Flite — User Guide

Vectair Flite is a desktop-local flight data management application for aviation and ATC-style administrative strip management. It runs offline and stores all data locally.

---

## Navigation

The primary navigation bar runs across the top of the application:

```
Live Board | Weather | Calendar | Booking | History | Reports | Cancelled | VKB Lookup | Admin
```

---

## Live Board

The Live Board is the main operational view. It shows all current PLANNED and ACTIVE flight strips.

### Movement types

| Type | Description |
|---|---|
| DEP | Departure |
| ARR | Arrival |
| LOC | Local — departs and returns to the same aerodrome |
| OVR | Overflight |

### Strip lifecycle

1. **Create** a strip using **New** and selecting the movement type.
2. **Activate** the strip when the movement begins (stamps ATD for DEP/LOC; AOFT for OVR; ARR Active is status-only).
3. **Complete** the strip when the movement ends (stamps ATA for LOC/ARR; ALFT for OVR).
4. Completed strips move to **History**.

### Create From

Each strip's **Edit** dropdown includes a **Create From** submenu for creating a related strip from the current one (Duplicate, Departure, Arrival, Local, Overflight). Use Duplicate for same-type reproduction; use Create From for cross-type creation.

---

## Weather / METAR Builder

### A. Purpose

The **Weather** tab is a structured drafting aid for METAR/SPECI-style reports.

- It does **not** fetch live weather from any external source.
- It does **not** transmit or disseminate the report.
- The operator is responsible for observing and entering correct meteorological data.

The output is a formatted METAR/SPECI string for manual copying into an email, log, or operational communication.

---

### B. Report section

- **METAR** uses the configured scheduled issue time. When the current time is within the +5 minute submission window of a scheduled observation time, that scheduled time is used. Otherwise, the next scheduled time is shown.
- **SPECI** uses the current UTC time at the moment of selection.
- The **station** identifier defaults to `EGOW` unless changed or configured.
- Both the station and the time fields remain manually editable after auto-population.

---

### C. Mandatory groups

The following groups are mandatory and cannot be suppressed from the output:

| Group | Required when |
|---|---|
| Wind | Always |
| Visibility | CAVOK is not set |
| Cloud | CAVOK is not set |
| Temperature | Always |
| Dew point | Always |
| QNH | Always |

- **NSC** (No Significant Cloud) must be selected deliberately when there is genuinely no significant cloud. Do not select NSC simply to avoid entering cloud layers.
- Mandatory groups cannot be manually hidden or collapsed.

---

### D. CAVOK

Ticking **CAVOK** (Ceiling and Visibility OK) suppresses visibility, present weather, RVR, and cloud from the output.

Use CAVOK only when all of the following apply (CAP 746):

- Visibility is 10 km or more.
- No cloud below 5,000 ft or the Minimum Safe Altitude (whichever is lower).
- No significant weather phenomena.

If CAVOK is later unticked, previously entered visibility, weather, and cloud values are restored.

---

### E. Present weather

The present weather selector supports structured entry and manual override.

**Structured mode:**

Each weather group has:
- **Intensity/proximity** — light (−), moderate (no prefix), heavy (+), or in vicinity (VC).
- **Descriptor** — e.g. SH (shower), TS (thunderstorm), FZ (freezing), BL (blowing).
- **Phenomenon(a)** — primary phenomenon, with two additional slots for combined precipitation.

Key rules:
- **Mixed precipitation** (e.g. rain and snow simultaneously) must be combined into one group with the dominant type first (e.g. `RASN`). Entering them as separate groups is blocked.
- **TS** (thunderstorm) alone is valid. TS with precipitation adds the precipitation code.
- **TS requires a CB cloud group** in the cloud section. TCU is not sufficient.
- Illegal intensity/descriptor/phenomenon combinations are blocked with an error.

**Manual override mode:**

For expert use or locally-recognised codes not covered by the structured selector. Manual groups bypass structured validation; a non-blocking advisory warning is shown.

---

### F. Cloud

Cloud layers are entered one at a time using **Add cloud layer**.

**Amount options:**

| Amount | Meaning |
|---|---|
| FEW | 1–2 oktas |
| SCT | 3–4 oktas |
| BKN | 5–7 oktas |
| OVC | 8 oktas |
| NSC | No significant cloud — select deliberately |

**Qualifier (TCU/CB):**

Each layer can have an optional qualifier: **TCU** (towering cumulus) or **CB** (cumulonimbus). The qualifier is disabled for NSC layers.

- A **CB** qualifier is required whenever **TS** is reported as present weather (CAP 746). TCU does not satisfy this requirement.

Enter cloud height in hundreds of feet (e.g. `023` for 2,300 ft).

---

### G. Final values

**Temperature and dew point:**

- Enter as a whole number in degrees Celsius.
- Accepted formats: `5`, `-5`, `M5`, `M05`.
- **Dew point cannot exceed air temperature** — this is a blocking error.

**QNH:**

- Enter as a 3- or 4-digit number (e.g. `1013`, `987`).
- Output is formatted as `Q1013` or `Q0987`.

---

### H. Optional and conditional sections

The following sections are optional and may appear as collapsible accordions (▸/▾). Their availability depends on **Admin > Weather** settings.

| Section | Default visibility (Woodvale) | Purpose |
|---|---|---|
| RVR | Hidden | Runway Visual Range groups |
| Recent Weather | Collapsed | Recently observed weather (RE prefix) |
| Wind Shear | Collapsed | Wind shear groups |
| Runway State | Hidden | Runway condition groups |
| Colour State | Expanded (Military) | UK military colour state |

- **Hidden** — the section is not shown, not validated, and does not appear in the output.
- **Collapsed** — the section is available but collapsed by default. Open the accordion to use it.
- **Expanded** — the section is open by default.

When a section accordion is open and contains data, it contributes to the output. When the accordion is closed, its content is not output.

---

### I. Colour state / Military mode

**Military reporting mode** (configured in Admin > Weather):

- The Colour State section is available and auto-populated.
- Colour state is derived automatically from visibility and the lowest BKN or OVC cloud layer.
- A manual override can be applied; a **Recalculate** button clears the override and re-derives the state.
- Colour state appears in the report output as `RMK BLU`, `RMK WHT`, `RMK GRN`, etc.

**Civilian reporting mode:**

- The Colour State section is hidden.
- No colour state is auto-derived or output.
- No `RMK` colour code appears in the report.

---

### J. Copy behaviour

- While mandatory fields are incomplete, the output panel shows **placeholder tokens** such as `[WIND]`, `[VIS]`, `[TEMP/DEW]`, `[QNH]` to indicate what is still required.
- The **Copy** button is disabled and visually marked as blocked when any blocking error exists.
- Once all mandatory fields are valid and no blocking errors remain, Copy is enabled.
- The copied report includes a trailing `=` (end-of-message indicator).

---

## Calendar

The **Calendar** tab provides a scheduling and booking calendar view. Use it to view planned movements by date and manage bookings.

---

## Booking

The **Booking** tab manages visitor and aircraft bookings. Bookings can be linked to flight strips on the Live Board.

---

## History

The **History** tab contains completed movement history in three views:

- **Strip Board** — completed strips in chronological order. Defaults to today's completed movements.
- **Calendar** — completed movements summarised by calendar day.
- **Search / Table** — structured search and table view for finding older movements.

History contains completed movements only. Cancelled and deleted strips are in the **Cancelled** tab.

---

## Reports

The **Reports** tab provides official movement reporting:

- **Monthly Return** — official nominal movement counts for the period.
- **Dashboard** — summary statistics and movement breakdowns.
- **Insights** — movement analytics.
- **Cancellation Report** — cancelled sortie analysis.

Reports are exportable as CSV and XLSX.

---

## Cancelled

The **Cancelled** tab contains lifecycle exception views:

- **Cancelled Sorties** — movements that were cancelled. Supports reinstatement.
- **Deleted Strips** — soft-deleted strips retained for 24 hours before purge. Supports restore.

---

## VKB Lookup

The **VKB Lookup** tab provides reference data lookups for callsigns, registrations, EGOW codes, locations, and aircraft types using locally bundled data packs.

---

## Admin

The **Admin** section contains configuration for all major application behaviours.

### Admin > Weather

Configures the Weather / METAR Builder behaviour.

#### Actual Time of Observation schedule

Controls which scheduled observation time is used when report type is METAR.

| Pattern | Description |
|---|---|
| H+20 / H+50 | Observations at 20 and 50 minutes past each hour (bi-hourly) |
| H+00 / H+30 | Observations at the hour and 30 minutes past (bi-hourly) |
| H+53 | Single observation at 53 minutes past each hour |

The **+5 submission window** means that when the current time is within 5 minutes after a scheduled observation time, the builder uses that scheduled time. Outside the window, the next scheduled time is shown.

For bi-hourly patterns, a **rate** selector (bi-hourly / hourly) and an **hourly minute** selector are available for sites that observe only once per hour.

#### Reporting Mode

| Mode | Effect |
|---|---|
| Military | Colour State section is available and auto-populated. `RMK` colour code appears in the report. |
| Civilian | Colour State section is hidden. No colour code is output. |

#### Section visibility

Controls whether each optional section is shown:

| Setting | Behaviour |
|---|---|
| Hidden / Not reported | Section not shown, not validated, not in output |
| Available collapsed | Section shown but collapsed; open the accordion to use it |
| Available expanded by default | Section shown and open by default |

Sections configurable: **RVR**, **Recent Weather**, **Wind Shear**, **Runway State**, **Colour State**.

#### Suggested defaults for Woodvale (Military)

| Setting | Value |
|---|---|
| Reporting mode | Military |
| RVR | Hidden |
| Recent Weather | Collapsed |
| Wind Shear | Collapsed |
| Runway State | Hidden |
| Colour State | Expanded |

### Admin > Session Management

- **Backup to JSON** — exports all operational data (movements, config, bookings, calendar, cancellations, deleted strips, hours log) to a JSON file.
- **Restore from JSON** — imports a previously exported backup. Reload the app after restoring.

### Admin > System Status

- **Updates** — manual, operator-initiated update checker. Click **Check for updates** to query the update endpoint. No automatic or background update checks occur.
- **Reload App** — reloads the application (useful when clearing cached assets during development).

### Admin > Danger Zone

- **Restore from JSON** — restores a session backup. Use with care; this overwrites current data.

---

## Data, persistence, and export

Vectair Flite stores all data in the local WebView `localStorage` profile. Data is specific to the environment (installed app, Tauri dev, or browser harness).

**Backed-up data categories** (Admin → Session Management → Backup to JSON):

- Movements
- Configuration
- Cancelled sorties
- Deleted strips
- Booking profiles
- Calendar events
- Hours log

**Builder state** (Weather / METAR Builder) is stored separately in `localStorage` and is not included in the session backup. Use **Recall Previous** in the Weather tab to restore the last copied observation.

CSV and XLSX exports use native Save As in the Tauri desktop app. Browser fallback uses the browser download mechanism.
