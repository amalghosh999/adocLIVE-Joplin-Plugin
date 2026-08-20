# Test Lab Contract

Status: accepted

## Invariants

1. Browser tests load the real panel entry and production styles.
2. Automated tests make no non-loopback network request.
3. The controller and every editor use separate origins and communicate only through validated envelopes on a transferred `MessagePort`.
4. Primary behavior tests use keyboard, pointer, clipboard, drag/drop, and visible controls. Lab control messages are limited to deterministic setup and observation.
5. A scenario replay is byte-stable after canonical JSON serialization and produces the same ordered observable event stream.
6. Current defects are represented as desired-behavior expected failures with an `ADL-*` record; incorrect output is never a semantic or visual baseline.
7. Browser failures retain enough non-private evidence to reproduce the failure. Private imports retain nothing without confirmation.
8. Production builds install no diagnostics sink and package no laboratory files.

## Protocol surface

`EditorHostRequest` contains the 28 editor calls: `ready`, `saveNote`, `getNoteContent`, `renderAsciidoc`, `requestResources`, three media dialogs, two resource-creation calls, note search, include targets, xref resolution, note sections, navigation, template list/content/mark/remove, spellcheck settings, dictionary read/add, snippet list/add/update/remove, fullscreen, and Markdown paste conversion.

`EditorHostPush` contains the six panel-consumed pushes: `updateNote`, `updateTheme`, `updateEditorTheme`, `updateCompactSpacing`, `updateAttributeAutocomplete`, and `updateSpellCheck`. Each request has a message-specific response schema. Unknown types and protocol versions fail closed with a structured protocol error.

## Scenario contract

`LabScenarioV1` records schema version, ID, metadata/tags, sessions and selected notes, notes/folders/resources/templates/snippets/dictionary/settings, theme and local-storage seed, fault/save-echo policy, semantic timeline, expected issue IDs, stabilization policy, and local/size-limited resource references. Future versions are rejected. Every committed prior version must have a forward migration registered and tested.

Semantic timeline actions include editor typing, selection, source-position click, scroll, key press, toolbar command, host push/navigation/mutation, request resolve/reject/reorder, and logical-clock advancement. Wall-clock sleeps are not scenario semantics.

## Stabilization and scroll

A stable editor has loaded local fonts and deterministic media, completed two animation frames, observed a quiet relevant-mutation window, and has no pending host or render work. Scroll assertions compare a visible source anchor before and after a transition. For the raw/live/raw characterization, both endpoints have identical verified raw geometry, so the source-anchor displacement is the absolute `scrollTop` delta; this remains valid when CodeMirror virtualizes the displaced anchor out of the DOM. Raw `scrollTop` without that same-geometry proof is diagnostic only.

Scenario regression ceilings are derived from 30 pinned-container repetitions as `p99 + max(1 px, MAD)`. They characterize current behavior and fail a regression beyond that reviewed ceiling. The desired displacement target is a separate one-quarter-line ADL-022 expected-failing assertion; mathematically correct bottom clamping is the separate ADL-023 expected-failing assertion. Neither safety contract is waived by approving a characterization. Scroll tests run with one worker and retain source, geometry history, diagnostics, screenshot, and trace on failure.

## Visual and accessibility

Reviewed visual baselines use pinned Linux Chromium, fixed locale/timezone/device scale factor/fonts, clean storage, local assets, and screenshot-only caret/animation suppression. Defaults are threshold `0.2`, a recorded two-channel stability epsilon, and `maxDiffPixelRatio: 0.001`; exceptions require a documented approval. The canvas normalization snaps only channel jitter at or below the epsilon to the approved before pixel; larger changes remain exact. Tests never update baselines automatically.

Accessibility targets WCAG 2.2 AA. Axe coverage spans every view mode and major theme plus ribbon panels, search, modal, dropdown, context menu, and popup states. Keyboard tests cover focus order/visibility/restoration, activation, Escape, modal containment, toolbar semantics, auto-hide, 200% zoom, narrow viewports, reduced motion, and forced colors. Only stable `ADL-*` entries may be allowlisted.

## Performance and leaks

Nightly measurements use one worker, warmups, repeated samples, median/p95, and calibration. Clean timing runs disable diagnostics. Absolute input p95 ceilings are 50 ms at 1k lines, 100 ms at 5k, 200 ms at 10k, and 400 ms at 20k. A relative failure requires both a median regression above 20% and at least 5 ms. One calibration retry is allowed; persistent calibration failure is infrastructure failure.

Leak flows repeat at least 100 times and force GC. A heap failure requires growth over both 10% and 5 MB. A DOM failure requires monotonic growth over both 10% and 500 nodes. The series and trace are retained for non-private scenarios.

## Required commands

```text
npm run lab
npm run lab:build
npm run lab:serve
npm run playwright:install
npm run typecheck:lab
npm run audit:prod:pr
npm run audit:prod:release
npm run test:browser
npm run test:browser:headed
npm run test:browser:ui
npm run test:scroll
npm run test:visual
npm run test:visual:update
npm run test:a11y
npm run test:perf
npm run test:leak
npm run test:joplin-sim
npm run test:artifact-smoke
npm run test:lab:pr
npm run test:lab:nightly
npm run baseline:candidates
npm run baseline:candidates:docker
npm run baseline:review
npm run baseline:review:import -- <candidate-artifact>
npm run baseline:apply -- <receipt.json>
npm run release:prepare
npm run release:publish -- --bundle <dir> --receipt <file> --confirm <version>
```

`baseline:candidates` is useful for local draft evidence; only the pinned Noble
container command requests the release-scoped unit, typecheck, simulator,
functional-browser, accessibility, and extracted-artifact gates and can produce
a finalizable bundle. The review server exposes
GET/HEAD only and the apply command is the sole repository-write boundary.
Direct `npm publish` is prohibited. Release publication reruns the live zero-
advisory audit and consumes the stored JPL and npm tarball bytes.

PR verification includes install, existing unit tests, both typechecks, production build, protocol/adapter contracts, browser smoke and functional coverage, protected scroll, representative visual, accessibility, Joplin simulation, and packaged-artifact smoke. Full fixtures, scale performance, leaks, and extended diagnostics run scheduled or on demand.
