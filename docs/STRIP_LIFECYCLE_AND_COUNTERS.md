# Strip Lifecycle and Counter Rules

> Canonical reference for movement (strip) status semantics, time fields,
> counter logic, and booking link invariants in Vectair FDMS Lite.

---

## 1. Strip Statuses

A strip (movement record) can be in exactly one of these statuses at any time:

| Status | Meaning | Visible on | Counted in daily totals? |
|---|---|---|---|
| `PLANNED` | Scheduled but not yet active. Created from a booking or manually. | Live Board (below divider) | **No** |
| `ACTIVE` | Currently in progress. Strip is live on the board. | Live Board (above divider) | **Yes** |
| `COMPLETED` | Flight finished normally. | History | **Yes** |
| `CANCELLED` | Soft-deleted. Record preserved for audit trail. | History | **No** |
| *(deleted)* | Hard-deleted. Record permanently removed from storage. | Nowhere | **No** |

### Status transitions

```
PLANNED ──→ ACTIVE ──→ COMPLETED
   │           │
   │           └──→ CANCELLED
   │
   └──→ CANCELLED

Any status ──→ (hard delete)   [permanent removal]
```

- **PLANNED → ACTIVE**: Manual via "→ Active" button, or automatic via
  `autoActivatePlannedMovements()` when the planned time falls within the
  configured activation window (default: 15 minutes before).
- **ACTIVE → COMPLETED**: Manual via "→ Complete" button, or via Edit Details
  modal.
- **PLANNED/ACTIVE → CANCELLED**: Via "Cancel" in the Edit dropdown. Requires
  user confirmation. The record is preserved with `status: "CANCELLED"`.
- **Hard delete**: Via "Delete" in the Edit dropdown. Requires user confirmation.
  Permanently removes the movement from localStorage. If the strip was linked to
  a booking, `booking.linkedStripId` is cleared first.

### Cancel vs Delete

| | Cancel (soft delete) | Delete (hard delete) |
|---|---|---|
| Record preserved? | Yes (`status: "CANCELLED"`) | No (removed from storage) |
| Visible in History? | Yes | No |
| Reversible? | Not via UI (could be restored from changeLog) | No |
| Booking link cleanup | `onMovementStatusChanged()` syncs status to booking | `booking.linkedStripId` set to `null` |

---

## 2. Canonical Time Fields

Each movement has four time fields stored in `HH:MM` format (24-hour, local):

| Field | Meaning | Set when |
|---|---|---|
| `depPlanned` | Planned departure time (ETD) | On creation |
| `depActual` | Actual departure time (ATD) | When departure is recorded |
| `arrPlanned` | Planned arrival time (ETA) | On creation |
| `arrActual` | Actual arrival time (ATA) | When arrival is recorded |

### Getter helpers (in `datamodel.js`)

These functions read from the canonical fields above:

| Helper | Returns | For flight types |
|---|---|---|
| `getETD(m)` | `m.depPlanned` | DEP, LOC, OVR |
| `getATD(m)` | `m.depActual` | DEP, LOC, OVR |
| `getETA(m)` | `m.arrPlanned` | ARR, LOC |
| `getATA(m)` | `m.arrActual` | ARR, LOC |
| `getECT(m)` | `m.depPlanned` (crossing time) | OVR |
| `getACT(m)` | `m.depActual` (actual crossing) | OVR |

### Display logic per flight type

| Flight type | Dep column shows | Arr column shows |
|---|---|---|
| `DEP` | ATD or ETD | - |
| `ARR` | - | ATA or ETA |
| `LOC` (local) | ATD or ETD | ATA or ETA |
| `OVR` (overflight) | ACT or ECT | - |

### Historical note: phantom time fields

Before Sprint 2, inline edits wrote to non-existent field names (`etd`, `atd`,
`eta`, `ata`, `ect`, `act`) due to incorrect field name resolution. These
"phantom" fields may exist on movements edited before the fix. They are harmless
because display logic only reads from canonical fields, and `updateMovement()`
uses `Object.assign` patch semantics that add new keys without removing old ones.

---

## 3. Counter Rules

### 3.1 Daily Movement Totals (EGOW counters)

Computed by `calculateDailyStats()` in `app.js`.

**Filter criteria:**
1. `dof === today` (date of flight matches today, UTC date boundary)
2. `status` is `ACTIVE` **or** `COMPLETED`
3. Deduplicated by movement `id` (defensive; should already be unique)

**Exclusions:**
- `PLANNED` strips are **not counted** (not yet real traffic)
- `CANCELLED` strips are **not counted** (soft-deleted)
- Hard-deleted strips do not exist in storage, so cannot be counted

**Classification buckets** (via `classifyMovement()` in `reporting.js`):

| Code | Meaning | Source |
|---|---|---|
| `BM` | Based Military | Registration lookup in VKB CSV → `EGOW FLIGHT TYPE` |
| `BC` | Based Civil | Registration lookup in VKB CSV → `EGOW FLIGHT TYPE` |
| `VM` | Visiting Military | Registration lookup in VKB CSV → `EGOW FLIGHT TYPE` |
| `VC` | Visiting Civil | Registration lookup in VKB CSV → `EGOW FLIGHT TYPE` |
| `VMH` | Visiting Military Helicopter | Registration lookup → includes rotary |
| `VCH` | Visiting Civil Helicopter | Registration lookup → includes rotary |
| `VNH` | Visiting Navy Helicopter | Navy operator detection |

For counter display purposes, each movement is classified into exactly one bucket.
The `TOTAL` counter is the sum of all classified movements (BM + BC + VM + VC +
any other codes).

**No double counting:** A movement that transitions ACTIVE → COMPLETED is still
counted once. The dedup-by-ID ensures this even if data anomalies exist.

### 3.2 FIS Counters

Displayed in the Flight Information Service section. Three values:

| Counter | Source | Description |
|---|---|---|
| **Generic (Manual)** | `genericOvrCount` in localStorage | Manual tally of free-caller overflights. Incremented/decremented via +/- buttons. |
| **Strip FIS** | `calculateStripFisCount()` in `app.js` | Sum of `m.fisCount` across all movements with `dof === today`. All statuses included (no status filter). |
| **Total FIS** | Generic + Strip | Sum of the above two. |

**Note:** Strip FIS counts all movements for today regardless of status, unlike
the daily movement totals. This is because FIS interactions occur regardless of
whether the strip is later cancelled.

### 3.3 Per-Strip Counters

Each strip has three per-movement counters managed via +/- buttons on the Live
Board:

| Counter | Field | Meaning |
|---|---|---|
| T&G | `tngCount` | Touch-and-go count |
| O/S | `osCount` | Overshoot count |
| FIS | `fisCount` | FIS contact count |

These are integer values, incremented/decremented directly via the Live Board UI.

### 3.4 Counter Update Triggers

Counters are refreshed in these situations:
- After every inline edit save (`updateDailyStats()` + `updateFisCounters()`)
- After every status transition (activate, complete, cancel)
- After strip creation or deletion
- On a 45-second periodic tick (`app.js` interval)
- On initial page load (`initLiveboardCounters()`)

The `fdms:data-changed` event (from booking operations and bookingSync) triggers
`renderLiveBoard()` and `renderTimeline()` but does **not** directly trigger
counter updates. The 45-second tick acts as a safety net to catch any stale
counter state.

---

## 4. Booking Link Invariants

### Bidirectional link

A booking and a strip are linked via two pointers:

```
movement.bookingId  ←→  booking.linkedStripId
```

When both are set and point to each other, the link is healthy.

### Sync pathways

| Trigger | Function | Effect |
|---|---|---|
| Strip edited (inline or modal) | `onMovementUpdated(movement)` | Patches booking with updated schedule, aircraft, movement, ops fields |
| Strip status change | `onMovementStatusChanged(movement, status)` | Patches booking status (COMPLETED/CANCELLED) |
| Booking edited | `fdms:data-changed` event | Live Board re-renders (no automatic strip field update) |
| Strip hard-deleted | `performDeleteStrip()` | Clears `booking.linkedStripId` before deletion |

### Reentrancy guard

`bookingSync._dispatchBookingPatch()` has a `_patchInProgress` flag that prevents
recursive event dispatch. If a booking patch triggers further updates, the nested
call is silently dropped.

### Startup reconciliation

`reconcileLinks()` runs once at app startup and performs:

1. **Pass 1:** For each movement with a `bookingId`, check if the booking exists.
   If not, clear `movement.bookingId`.
2. **Pass 2:** For each booking with a `linkedStripId`, check if the movement
   exists and points back. If not, clear `booking.linkedStripId`. If a booking
   has no `linkedStripId` but exactly one movement claims it, repair the link.

This is deterministic and conservative: conflicting claims (multiple movements
referencing the same booking) result in clearing rather than guessing.

---

## 5. Operational Notes

### Inline edit vs modal edit

| | Inline edit | Edit Details modal |
|---|---|---|
| Access | Double-click a cell on the Live Board | Edit dropdown → Details |
| Scope | Single field at a time | All fields |
| Enrichment | None (minimal-risk patch semantics) | Full: WTC lookup on type change, voice callsign generation, popular name lookup |
| Booking sync | Yes (`onMovementUpdated()`) | Yes (`onMovementUpdated()`) |
| Counter update | Yes | Yes |
| Guard against double-save | `saved` flag prevents Enter+blur race | Modal submit button |

Inline edit is intentionally "minimal-risk" — it patches only the edited field
via `Object.assign` and does not trigger type-dependent enrichments like WTC
lookup or voice callsign updates. This prevents unexpected side effects during
rapid editing. Full enrichment requires the modal path.

### Storage format

Movements are stored in localStorage under key `vectair_fdms_movements_v3`:

```json
{
  "version": 3,
  "timestamp": "2026-02-09T12:00:00.000Z",
  "movements": [ ... ]
}
```

Bookings are stored under key `vectair_fdms_bookings_v1`:

```json
{
  "version": 1,
  "timestamp": "2026-02-09T12:00:00.000Z",
  "bookings": [ ... ]
}
```

### Diagnostics mode

Setting `window.__FDMS_DIAGNOSTICS__ = true` and initializing
`window.__fdmsDiag` enables test-only counters for:

- `renderLiveBoardCount` — number of `renderLiveBoard()` calls
- `renderHistoryBoardCount` — number of `renderHistoryBoard()` calls
- `updateDailyStatsCount` — number of `updateDailyStats()` calls
- `updateFisCountersCount` — number of `updateFisCounters()` calls
- `dataChangedDispatched` — number of `fdms:data-changed` events dispatched
- `dataChangedReceived` — number of `fdms:data-changed` events received

These are gated behind the flag and produce zero overhead in normal operation.
