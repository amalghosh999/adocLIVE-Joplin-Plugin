# Test Lab Planning Handoff

The approved implementation order is A0 architecture records; A1 exact-panel lab; A2 current-behavior characterization and human baseline approval; A3 shared shell, typed protocol, and diagnostics; A4 shared host core and Joplin adapters; A5 deterministic host/dashboard/scenarios; A6 functional/race/security; A7 protected scroll/visual/accessibility; A8 performance/leaks; A9 Joplin simulator/artifact/native tools; A10 CI/docs/final evidence.

The A2 baseline gate is intentional: production seams must not silently redefine current scroll behavior. Candidate measurements are generated from 30 repetitions in the pinned image, reviewed as JSON/distributions/screenshots, and approved by a human before they become protected bounds. Later updates follow the same process.

No card may substitute a parallel editor implementation, broad production cleanup, a live-preview redesign, complete Joplin emulation, or automated desktop GUI testing. Existing production dependency advisories are recorded but remain a separate security-hardening change.

Completion evidence is recorded in `docs/test-lab/evidence/`: baseline approvals, headed-dashboard review, Linux native Joplin matrix, package inspection, command transcript, and final size comparison. Windows/macOS evidence is a pre-publication gate. Unperformed human checks remain explicitly open and cannot be reported as passed.

Implementation must preserve all 185 pre-lab unit tests, pass both TypeScript projects, create the production distribution and JPL, and leave only intentional tracked changes. `npm pack --dry-run --json` and extracted-JPL inspection must demonstrate that lab source, fixtures, baselines, reports, traces, and browser binaries are absent.
