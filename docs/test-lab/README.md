# adocLIVE Test Lab Contributor Guide

The Test Lab runs the real adocLIVE panel bundle and production CSS in Chromium against a deterministic simulated Joplin host. It is intended for contributor verification before plugin changes, not as a substitute for the native Joplin matrix.

## Quickstart

```bash
npm ci
npm run playwright:install
npm run lab
```

Open `http://127.0.0.1:4173`. The dashboard and editor intentionally use ports 4173 and 4174. Override them with `ADOC_LAB_CONTROLLER_PORT` and `ADOC_LAB_EDITOR_PORT`. `ADOC_LAB_ALLOW_REMOTE=1 npm run lab` enables warned manual remote-content testing; never use it for automated tests or baseline approval.

The existing dashboard shell and the plugin editor toolbar keep their current
formatting and button icons. Baseline review is an additive sibling page at
`http://127.0.0.1:4173/baseline-review/`; run `npm run baseline:review` to build
and serve it.

The fixture picker covers syntax, blocks, overlays, tables, math, Mermaid, media, includes, Unicode/RTL, hostile content, scroll characterization, and 1k–20k-line scale documents. Choose one or two sessions; two sessions share the controller note store but retain independent editor realms.

Layout controls reload isolated editor frames with per-session storage seeds plus selected view, theme, viewport, zoom, margin, compact-spacing, autocomplete, and spellcheck settings. Host controls configure logical latency, manual deferral, failure, cancellation, duplication, ordering, and save-echo behavior. The queue permits explicit resolve, reject, cancel, and reorder. Note, resource, file-dialog, and theme controls exercise real validated host operations and pushes.

Record captures semantic editor typing, selection, source click, scroll, keyboard, and toolbar actions as well as host and logical-clock actions. Replay starts from the scenario seed and executes editor actions through a separate validated control channel. Export uses canonical versioned JSON. Local note/scenario imports are private; see [PRIVACY.md](PRIVACY.md).

## Verification commands

The complete command contract is in [TEST_CONTRACT.md](TEST_CONTRACT.md). Use `npm run test:lab:pr` for the required automated gate. Full performance/leak checks run with `npm run test:lab:nightly`. `npm run test:artifact-smoke` builds a JPL, inspects its contents, and boots its extracted panel. `npm run native:prepare` creates the disposable native-verification workspace.

Architecture and contribution boundaries are in [ARCHITECTURE.md](ARCHITECTURE.md). Scenario authoring is in [SCENARIOS.md](SCENARIOS.md), baseline review in [BASELINES.md](BASELINES.md), the approved review-page design is recorded in [evidence/BASELINE_REVIEW_DESIGN.md](evidence/BASELINE_REVIEW_DESIGN.md), and failure diagnosis is in [CI_AND_TROUBLESHOOTING.md](CI_AND_TROUBLESHOOTING.md).

Production dependency policy and the before/after audit evidence are in
[DEPENDENCY_SECURITY.md](DEPENDENCY_SECURITY.md). Release preparation and
publication intentionally use separate commands and never rebuild reviewed
artifacts during publication.

Current verification evidence is in [evidence/AUTOMATED_VERIFICATION.md](evidence/AUTOMATED_VERIFICATION.md), with the human baseline and native-Joplin sign-off records alongside it.
