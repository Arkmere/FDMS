FDMS Timing Model Clarification — Canonical Behaviour Spec

This note is intended to reset the timing logic cleanly and remove drift. It defines how strip timings are supposed to work across forms, inline edits, derived values, and the Live Board Timeline. This is not a new feature request; it is the intended behaviour model.

1. Core principle

There is one timing model per movement strip.

That single timing model may be edited from:

the full edit/create form, or

inline edits directly on the strip

These are not separate timelines or separate data models. They are different UI entry points into the same underlying timing group.

The Timeline bar on the Live Board is also not separate logic. It is a visual projection of the same resolved timing model.

2. Meaning of Duration

For DEP / ARR / LOC:

Duration means the ATC flight-duration concept:

from when lift transfers from undercarriage to lifting body

to when it transfers back again

In practical terms: airborne time.

For OVR:

Duration is different in meaning

it is the time from first contact with ATC to last contact with ATC

Do not force OVR into the airborne-duration model. It is analogous in structure but semantically different.

3. Duration source hierarchy

There are two possible duration sources:

Option 1 — Duration Actual

A known duration entered by the user from a flight plan, pilot report, briefing, etc.

Option 2 — Flight Offset Duration

A fallback/default duration from Admin for the relevant movement/flight type.

Precedence

Duration Actual is preferred

if no user-entered duration exists, use the Admin default offset duration

This distinction matters operationally. The logic should not treat explicit duration and fallback duration as equivalent in all cases.

4. Timing philosophy

Each movement has:

a movement type

a state

a current governing/root time

a dependent time

a duration source

Changing Duration should adjust the dependent side of the timing pair, not the governing/root side.

Changing the governing/root time should recalculate the dependent side.

Changing a dependent field manually should recalculate Duration.

5. State-sensitive meaning of edits

State changes alter how timing edits are interpreted.

Planned

Inline edits affect estimated/planned values.

Active

Inline edits affect actual values.

Again: this does not mean there are two timing systems. It is one timing system whose edited field meaning changes by state.

6. Movement-type behaviour
DEP
Planned

Initial root time = ETD

ETA is derived from:

ETA = ETD + Duration

Active

Once ATD exists, the governing root becomes ATD

ETA is then derived from:

ETA = ATD + Duration

Editing rules

If Duration changes, the value adjusted is ETA

If ETD changes in planned state, recalculate ETA

If ATD changes in active state, recalculate ETA

If ETA is manually edited, recalculate Duration

LOC

LOC follows the same timing behaviour as DEP.

Planned

Initial root time = ETD

ETA = ETD + Duration

Active

Once ATD exists, root becomes ATD

ETA = ATD + Duration

Editing rules

If Duration changes, adjust ETA

If ETD changes in planned state, recalculate ETA

If ATD changes in active state, recalculate ETA

If ETA is manually edited, recalculate Duration

ARR

ARR is different because the initial operational anchor is the arrival side.

Planned

Initial root time = ETA

ETD is derived from:

ETD = ETA - Duration

Planned editing rules

If Duration changes, adjust ETD

If ETA changes, recalculate ETD

If ETD is manually changed, recalculate Duration

Active

Once ATD is present, ARR may switch to forward calculation from departure side.

The intended model is:

once ATD exists, root becomes ATD

ETA is then derived from:

ETA = ATD + Duration

Active editing rules

If Duration changes after ATD exists, adjust ETA

If ATD changes, recalculate ETA

If ETA is manually changed after ATD exists, recalculate Duration

Important safeguard

This was explicitly discussed and should be preserved conceptually:

For ARR, ATD-driven ETA recalculation is only truly trustworthy when the movement has a real/explicit Duration Actual, not merely a fallback default duration.

The user explicitly confirmed that if both ETA and ATD exist but duration is only default/fallback, the system should not blindly elevate that weak default into authoritative forward prediction without care.

This distinction should remain in the logic design and debugging.

Completion

If ATA is entered, the flight is effectively concluded.

If both:

ATD and

ATA

exist, then an exact actual duration may be calculated and stored.

If the movement never had anything better than estimated departure-side data (for example ETD only), then do not create a definitive actual duration from unverified estimates.

OVR

OVR uses the same overall timing framework but different semantics.

Planned

Planned root time = EOFT

Active

Actual/live root becomes ATOF (first contact)

Completion

End point is ALFT (last contact)

Notes

OVR duration may vary wildly

it may not be known in advance

some overflights may be on frequency for one minute, others for much longer

So OVR should be handled as its own timing branch, not as a hacked version of DEP/ARR/LOC.

7. The Timeline is not separate logic

The Live Board Timeline must use the same resolved timing model as the strip fields.

It must not:

invent its own movement-type timing rules

use “whatever time is primary on the strip”

confuse calculation root with visual bar start

This distinction is especially important for ARR.

Critical distinction

For ARR in planned state:

ETA may be the governing calculation root

but ETA is not the visual start of the movement bar

The Timeline must render from the resolved departure/start side to the resolved arrival/end side.

8. Canonical Timeline bar anchors

The Timeline bar should be based on resolved start and resolved end, not on “primary displayed time”.

DEP

Planned: ETD → ETA

Active: ATD → ETA

Completed: ATD → ATA

LOC

Planned: ETD → ETA

Active: ATD → ETA

Completed: ATD → ATA

ARR

Planned: ETD → ETA

Active: ATD → ETA

Completed: ATD → ATA

OVR

Planned: EOFT → ELFT

Active: ATOF → ELFT or ATOF → ALFT depending on available actuals

Completed: ATOF → ALFT

9. Confirmed ARR Timeline bug suspicion

The user suspects, and this fits the conceptual error pattern, that ARR Timeline bars are currently using:

ETA/ATA as the start point

That is incorrect.

ARR bars should start at:

ETD while planned

ATD while active/completed

and end at:

ETA while planned/active

ATA when completed

The ARR bar must not begin at ETA/ATA simply because ETA is the governing calculation root in planned state.

That is the likely conceptual mismatch:

calculation root ≠ timeline bar start

10. Required mental model for implementation

The implementation should treat these as three distinct concepts:

A. Governing root time

Used for recalculation logic.

B. Resolved start/end times

Used for strip display consistency and Timeline rendering.

C. Visible labels

Used for UI presentation only.

Do not conflate them.

If these are collapsed into one concept, ARR breaks first.

11. Recalculation rules summary

A useful deterministic framing is:

When any timing field changes:

identify movement type

identify movement state

identify duration source

determine governing root

determine dependent field

recalculate only the dependent side

update resolved start/end

render strip fields and Timeline from those resolved values

12. Engineering interpretation

The system should effectively expose something equivalent to:

resolvedStartTime(movement)

resolvedEndTime(movement)

The Timeline renderer should use those values only.

It should not inspect movement type and invent separate bar logic if a resolved timing model already exists.

13. Mermaid diagram — timing + Timeline model

flowchart TD

    A[Single movement timing model] --> B{Movement type}

    B --> DEP[DEP]
    B --> ARR[ARR]
    B --> LOC[LOC]
    B --> OVR[OVR]

    %% DEP
    DEP --> DEPState{ATD present?}
    DEPState -- No --> DEPPlanned[Root = ETD\nETA = ETD + Duration]
    DEPState -- Yes --> DEPActive[Root = ATD\nETA = ATD + Duration]

    %% LOC
    LOC --> LOCState{ATD present?}
    LOCState -- No --> LOCPlanned[Root = ETD\nETA = ETD + Duration]
    LOCState -- Yes --> LOCActive[Root = ATD\nETA = ATD + Duration]

    %% ARR
    ARR --> ARRState{ATD present?}
    ARRState -- No --> ARRPlanned[Root = ETA\nETD = ETA - Duration]
    ARRState -- Yes --> ARRActive[Root = ATD\nETA = ATD + Duration]

    %% OVR
    OVR --> OVRState{State}
    OVRState -- Planned --> OVRPlanned[Root = EOFT]
    OVRState -- Active --> OVRActive[Root = ATOF]
    OVRState -- Completed --> OVRComplete[End = ALFT]

    %% Resolved timeline spans
    DEPPlanned --> DEPSpan[Resolved span = ETD to ETA]
    DEPActive --> DEPSpan2[Resolved span = ATD to ETA / ATA]

    LOCPlanned --> LOCSpan[Resolved span = ETD to ETA]
    LOCActive --> LOCSpan2[Resolved span = ATD to ETA / ATA]

    ARRPlanned --> ARRSpan[Resolved span = ETD to ETA]
    ARRActive --> ARRSpan2[Resolved span = ATD to ETA / ATA]

    OVRPlanned --> OVRSpan[Resolved span = EOFT to ELFT]
    OVRActive --> OVRSpan2[Resolved span = ATOF to ELFT / ALFT]
    OVRComplete --> OVRSpan3[Resolved span = ATOF to ALFT]

    DEPSpan --> TL[Timeline uses resolved start/end only]
    DEPSpan2 --> TL
    LOCSpan --> TL
    LOCSpan2 --> TL
    ARRSpan --> TL
    ARRSpan2 --> TL
    OVRSpan --> TL
    OVRSpan2 --> TL
    OVRSpan3 --> TL

14. Plain-English implementation warning

The single biggest source of drift here is this mistake:

using the “root” time for visual start-of-bar rendering

That is wrong for ARR.

For ARR:

planned calculation root may be ETA

but visual bar still runs ETD → ETA

Keep that distinction explicit.

15. Bottom-line instruction for the FDMS chat

Treat this note as the intended canonical behaviour model for timings.

The work now is to:

compare current code against this model

identify where current logic diverges

especially inspect ARR span construction for Timeline rendering

ensure inline edit, form edit, strip display, and Timeline all operate on the same resolved timing model