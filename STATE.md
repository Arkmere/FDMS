# STATE.md — Vectair Flite

Last updated: 2026-04-27 (Europe/London)

## Current headline status

- **Main branch is the authoritative baseline.**
- **UTC-first timing hardening is complete** for the tested strip lifecycle paths.
- **Timeline presentation work is complete for V1**: dual UTC/local ruler, fixed-display-time policy, and ruler boundary presentation are implemented.
- **Cancellation / deleted-strip lifecycle work is complete** for the current-state operational model.
- **Cancellation reporting is complete** as a current-state operational report.
- **Formation workstream is complete for V1 launch purposes.**
- Formation child elements now render as subordinate strip-style cards rather than a washed-out internal table.
- Formation elements use the **element callsign** as the primary callsign, e.g. `MERSY1`, `MERSY2`.
- Generic crew/callsign attribution and pilot identity appear in secondary/detail positions only.
- Formation child cards use normal flight-type colour language:
  - LOC = pink
  - DEP = blue
  - ARR = orange
  - OVR = green
- T&G / O/S / FIS / timing are usable as primary formation-element operational controls.
- Further formation visual polish, density tuning, inherited/shared-value signalling, 3+ element UX refinement, and responsive-layout polish are deferred to the post-launch backlog.
- Next recommended feature workstream: **Create From workflow**.
- Larger V1 launch-risk track still outstanding: **Desktop Productization**.
- Remaining V1 feature workstream after Create From: **METAR Builder**.

This file is the shared source of truth for the Manager–Worker workflow.

- **Product Owner / SME:** Stuart
- **Solutions Architect & QA Lead:** ChatGPT
- **Production Engineer:** Claude Code

ChatGPT diagnoses, architects, writes tickets, and maintains the continuity layer. Claude implements tickets only. Claude must not be asked to diagnose root cause or infer design direction.

---

## 1. Product identity and naming

The product is now branded **Vectair Flite** (“Flite”).

Older development material may still refer to the same application as:

- FDMS
- FDMS Lite
- Vectair FDMS

These refer to the same product unless explicitly stated otherwise.

**Flite** is a deliberate contraction of **FDMS + light**. New tickets, documentation, and summaries should use **Vectair Flite** or **Flite** unless referring to legacy names for continuity.

---

## 2. Runtime and delivery model

### 2.1 Product definition

**Vectair Flite is not a website and not a hosted web app.**

Flite is a local flight-data management application for Windows and Linux. It currently uses HTML/CSS/JS internally and is run during development through a lightweight local harness.

Preferred local run pattern:

```text
git pull
python -m http.server 8000
http://localhost:8000/
