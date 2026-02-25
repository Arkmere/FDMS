# TIMING.md — Vectair FDMS Lite Timing Semantics

## 1. Canonical Stored Fields

All movement time fields are stored as **UTC HH:MM strings** (24-hour, zero-padded).
"Local" is a **UI-only display concept** derived at runtime using `config.timezoneOffsetHours`.

| Field       | Meaning                                        | Stored as |
|-------------|------------------------------------------------|-----------|
| `depPlanned`| Estimated Time of Departure (ETD) / ECT for OVR | UTC HH:MM |
| `depActual` | Actual Time of Departure (ATD) / ACT for OVR  | UTC HH:MM |
| `arrPlanned`| Estimated Time of Arrival (ETA)                | UTC HH:MM |
| `arrActual` | Actual Time of Arrival (ATA)                   | UTC HH:MM |

Empty string (`""`) means the value is not yet recorded.

---

## 2. Flight-Type Applicability

### DEP / ARR
All four fields are applicable:
- `depPlanned` = ETD (when the aircraft expects to depart)
- `depActual`  = ATD (when the aircraft actually departed)
- `arrPlanned` = ETA (when the aircraft expects to arrive)
- `arrActual`  = ATA (when the aircraft actually arrived)

For a pure **DEP** flight, ETA/ATA are typically empty (arrival is at the destination, not EGOW).
For a pure **ARR** flight, ETD/ATD are typically empty (departure was from elsewhere).

### LOC (Local)
All four fields are applicable. Both departure and arrival occur at EGOW (circuit/local flying).
- `depPlanned` maps to ETD (takeoff/start time)
- `arrPlanned` maps to ETA (expected return/landing time)
- `depActual`  maps to ATD (actual takeoff)
- `arrActual`  maps to ATA (actual return/landing)

### OVR (Overfly)
OVR flights use **only the departure fields**:
- `depPlanned` = **ECT** — Estimated Crossing Time
- `depActual`  = **ACT** — Actual Crossing Time
- `arrPlanned` — **disabled / ignored** (no landing at EGOW)
- `arrActual`  — **disabled / ignored**

The labels ECT/ACT are display-only aliases. The canonical storage fields remain `depPlanned`/`depActual`.

---

## 3. Actual-First Display Precedence

When displaying a movement's effective time (e.g. on the Live Board strip):

1. If `depActual` is non-empty → use **ATD** (actual has occurred)
2. Otherwise → use **ETD** (planned)

Similarly for arrival:
1. If `arrActual` is non-empty → use **ATA**
2. Otherwise → use **ETA**

This is the "actual-first" rule used by `getATD()`, `getATA()`, and the timeline renderer.

---

## 4. DOF Anchoring

All times are interpreted relative to the **Date of Flight (DOF)** field (`movement.dof`, stored as `YYYY-MM-DD`).

- Times do **not** cross midnight in the current data model (HH:MM is always within the same calendar day implied by DOF).
- The system stores `HH:MM` only; full timestamps are reconstructed as `DOF + HH:MM UTC` when needed (e.g. for timeline positioning, past-time warnings).

---

## 5. `timeInputMode` Toggle Semantics

### What it does
A persistent **UTC / Local** toggle appears in the Times section of every modal (New DEP/ARR/OVR, New LOC, Edit, Duplicate). It converts the **displayed values** in the time input fields between UTC and Local time.

### What it does NOT do
- It does **not** change how times are stored. Storage is always UTC.
- It does **not** affect the Live Board display or timeline — those always read canonical UTC from the movement object.

### Persistence
`timeInputMode` is stored in `config` under the key `"vectair_fdms_config"` (same localStorage key as all other config). It persists across page reloads and modal open/close cycles.

Default: `"UTC"`.

| Value   | Meaning                                                 |
|---------|---------------------------------------------------------|
| `"UTC"` | Input fields display and accept UTC times               |
| `"LOCAL"` | Input fields display and accept Local times (UTC ± `timezoneOffsetHours`) |

### Local time calculation
- Local = UTC + `config.timezoneOffsetHours`
- UTC   = Local − `config.timezoneOffsetHours`

Day wraparound is handled (modulo 24).

### Conversion functions
| Function              | Direction      |
|-----------------------|----------------|
| `convertUTCToLocal(t)` | UTC → Local   |
| `convertLocalToUTC(t)` | Local → UTC   |

Both functions are exported from `datamodel.js`.

### Save-path rule
When the user clicks **Save** or **Save & Complete** in any modal:
- If `timeInputMode === "LOCAL"`: each non-empty time field is passed through `convertLocalToUTC()` **before** being written to the movement object.
- If `timeInputMode === "UTC"`: values are stored as-is.

This guarantees canonical UTC storage regardless of which mode the user worked in.

### Toggle mode switch behaviour
1. All non-empty time inputs are validated (`validateTime()`).
2. If any input is invalid: a toast error is shown and the mode is **not** changed.
3. If all inputs are valid: each non-empty value is converted (UTC↔Local), the new mode is persisted via `updateConfig()`, and the toggle button label is updated.

---

## 6. Times Grid Layout (Modals)

All modals use a shared **2×2 grid** rendered by `renderTimesGrid()`:

```
[ ETD / ECT ]   [ ETA ]
[ ATD / ACT ]   [ ATA ]
```

- **OVR**: ETA and ATA inputs are **disabled** (present in DOM for structural consistency, not editable).
- Tab order follows DOM order: ETD → ETA → ATD → ATA.
- The UTC/Local toggle button sits in the row above the grid (alongside the DOF field).

### Input IDs by modal

| Modal         | ETD field          | ETA field          | ATD field           | ATA field           |
|---------------|--------------------|--------------------|---------------------|---------------------|
| New DEP/ARR/OVR | `newDepPlanned`  | `newArrPlanned`    | `newDepActual`      | `newArrActual`      |
| New LOC       | `newLocStart`      | `newLocEnd`        | `newLocStartActual` | `newLocEndActual`   |
| Edit          | `editDepPlanned`   | `editArrPlanned`   | `editDepActual`     | `editArrActual`     |
| Duplicate     | `dupDepPlanned`    | `dupArrPlanned`    | `dupDepActual`      | `dupArrActual`      |
