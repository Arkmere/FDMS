# Sprint 3 — Option A: Stress Audit Evidence Pack
## Date: 2026-02-10

## Environment
- **Playwright:** global install
- **Browser:** Chromium 141.0.7390.37 (headless)
- **OS:** Linux (container)
- **URL:** http://localhost:8765/

## Results Table

| Test ID | Scenario | Result | Notes |
|---------|----------|--------|-------|
| S1 | Rapid inline edits (N=25) | **PASS** | 25/25 edits OK, errors=0, renders=25, ratio=1.0, strip.callsign=RAP23 |
| S2 | Multi-strip edits (10 strips, N=50) | **PASS** | 50/50 edits, strips=10, unique_ids=true, errors=0, renders=50, ratio=1.0 |
| S3 | Status transitions + counter correctness | **PASS** | c0=0, c1=3, c2=3, c3=2, expected=0,3,3,2, errors=0 |
| S4 | Booking-linked stress (N=15) | **PASS** | 15/15 edits, link_ok=true, sync_dispatches=15, ratio=1.0, errors=0 |
| S5 | Delete/cancel under load (10 strips) | **PASS** | remaining=7 (exp 7), active=2, completed=2, cancelled=3, counter_total=4 (exp 4), errors=0 |
| PERSIST | Post-stress persistence + consistency | **PASS** | before=7, after=7, unique_ids=true, responsive=true, errors=0 |
| QUIESCE | Counters quiesce after actions stop | **PASS** | renderGrowth=0, statsGrowth=0 (max 1 allowed) |

**Overall: 7/7 PASS**

## JS Errors
None.

## Diagnostics Counters (window.__fdmsDiag)
```json
{
  "S1": {
    "renderLiveBoardCount": 25,
    "renderHistoryBoardCount": 25,
    "updateDailyStatsCount": 25,
    "updateFisCountersCount": 25,
    "dataChangedDispatched": 0,
    "dataChangedReceived": 0
  },
  "S2": {
    "renderLiveBoardCount": 50,
    "renderHistoryBoardCount": 50,
    "updateDailyStatsCount": 50,
    "updateFisCountersCount": 50,
    "dataChangedDispatched": 0,
    "dataChangedReceived": 0
  },
  "S3": {
    "renderLiveBoardCount": 5,
    "renderHistoryBoardCount": 5,
    "updateDailyStatsCount": 5,
    "updateFisCountersCount": 0,
    "dataChangedDispatched": 0,
    "dataChangedReceived": 0
  },
  "S4": {
    "renderLiveBoardCount": 30,
    "renderHistoryBoardCount": 15,
    "updateDailyStatsCount": 15,
    "updateFisCountersCount": 15,
    "dataChangedDispatched": 15,
    "dataChangedReceived": 15
  },
  "S5": {
    "renderLiveBoardCount": 8,
    "renderHistoryBoardCount": 8,
    "updateDailyStatsCount": 8,
    "updateFisCountersCount": 3,
    "dataChangedDispatched": 0,
    "dataChangedReceived": 0
  },
  "QUIESCE": {
    "renderLiveBoardCount": 0,
    "renderHistoryBoardCount": 0,
    "updateDailyStatsCount": 0,
    "updateFisCountersCount": 0,
    "dataChangedDispatched": 0,
    "dataChangedReceived": 0
  }
}
```

## Screenshots
- `S3_1_S1_after_25_rapid_edits.png`
- `S3_2_S2_after_50_multistrip_edits.png`
- `S3_3_S3_counter_transitions.png`
- `S3_4_S4_booking_linked_stress.png`
- `S3_5_S5_delete_cancel_under_load.png`
- `S3_6_S_persist_after_reload.png`
