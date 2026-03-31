# Baseline Smoke Test Checklist

Pre-desktop-productization baseline — Vectair Flite (`7a7c36a1241fa42e9aa19f184dca946dedca6c6f`)

Run these checks against the local harness before beginning any desktop conversion work. All items must pass before productization starts.

---

- [ ] App launches via current local harness
- [ ] Live Board renders
- [ ] Movement History / Cancelled Sorties / Deleted Strips separation works
- [ ] Cancelled strip can be edited
- [ ] Cancelled strip can be reinstated to PLANNED
- [ ] Deleted strip moves to Deleted Strips and leaves ordinary reporting
- [ ] Cancellation Report renders and filters
- [ ] Export Cancellations CSV works
- [ ] Inline time mode toggle behaves correctly
- [ ] ARR Active does not fabricate ATD
- [ ] OVR remains excluded from runway totals
- [ ] Booking reconciliation banner still behaves correctly
