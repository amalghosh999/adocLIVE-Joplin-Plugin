# Known-Failure Policy and Catalog

Expected failures describe desired behavior that the current plugin does not yet meet. Each record has a stable `ADL-*` ID, owner, rationale, exact automated test, and removal milestone. The test runner is configured so an unexpected pass fails and forces removal of the marker. New entries and changes require explicit review. Incorrect output is never recorded as a visual, scroll, security, or semantic baseline.

| ID | Owner | Desired behavior / rationale | Exact test contract | Removal milestone |
|---|---|---|---|---|
| ADL-001 | editor lifecycle | Switching notes isolates undo history | `race.spec.ts: cross-note undo isolation` | Per-note state lifecycle fix |
| ADL-002 | editor lifecycle | Dirty same-note external updates merge or surface a conflict | `race.spec.ts: dirty same-note update` | Conflict policy implementation |
| ADL-003 | render sequencing | Only the newest split render commits | `race.spec.ts: split render A/B` | Render generation tokens |
| ADL-004 | render sequencing | Only the newest linked-section render commits | `race.spec.ts: linked section A/B` | Linked preview cancellation |
| ADL-008 | security | Numeric entities remain text in label-derived markup | `security.spec.ts: numeric entity injection` | Contextual DOM construction |
| ADL-009 | security | Xref labels cannot inject markup | `security.spec.ts: xref label injection` | Contextual DOM construction |
| ADL-010 | security | Passthrough HTML is governed by an explicit safe policy | `security.spec.ts: passthrough isolation` | Rendering policy decision/fix |
| ADL-011 | security | Dangerous URL schemes cannot navigate or execute | `security.spec.ts: dangerous URLs` | URL allowlist |
| ADL-012 | security | Snippet fields cannot inject dashboard/editor UI | `security.spec.ts: snippet injection` | Text-only snippet rendering |
| ADL-013 | security | Bibliography labels cannot inject UI | `security.spec.ts: bibliography injection` | Contextual DOM construction |
| ADL-015 | conversion | Complex tables round-trip without a destructive rewrite | `conversion.spec.ts: complex table round trip` | Table converter support |
| ADL-016 | conversion | Fenced code containing an AsciiDoc listing delimiter selects a non-colliding delimiter | `host-core-golden.test.ts: non-colliding AsciiDoc delimiter` | Paste converter delimiter selection |
| ADL-018 | spellcheck | Enabling nspell must not crash CodeMirror decoration ordering | `conversion.spec.ts: real context-menu flow` | Sorted spellcheck decoration ranges |
| ADL-019 | accessibility | CodeMirror textbox exposes an accessible name | `accessibility.spec.ts: WCAG 2.2 AA checks` (`aria-input-field-name`) | Editor labeling pass |
| ADL-020 | accessibility | Ribbon tabs and section labels meet AA contrast | `accessibility.spec.ts: WCAG 2.2 AA checks` (`color-contrast`) | Theme contrast pass |
| ADL-021 | accessibility | Ribbon split-button targets meet WCAG 2.2 target size | `accessibility.spec.ts: WCAG 2.2 AA checks` (`target-size`) | Ribbon sizing pass |
| ADL-022 | scroll | Raw/live/raw transitions preserve a visual source anchor within one quarter-line | `scroll.spec.ts: 30 raw/live/raw source-anchor transitions` | Scroll-anchor correction |
| ADL-023 | scroll | Bottom-clamped view transitions remain mathematically bottom-clamped | `scroll.spec.ts: top and bottom view transitions` | Clamp correction |
| ADL-024 | accessibility | CodeMirror's scrollable region is keyboard-focusable in every transient UI state | `accessibility.spec.ts: keyboard focus contracts` (`scrollable-region-focusable`) | Editor focusability pass |
| ADL-025 | editor lifecycle | A late `ready` response cannot overwrite a newer pushed note body | `race.spec.ts: ready and pushed update reordering` | Ready-generation ordering |

An entry is not evidence that the issue exists until its exact test has been implemented and observed. Catalog-only entries may not be used to suppress failures.

## Retired audit candidates

- `ADL-014` was not reproduced: the focused browser contract proves dialog-derived file values remain data and cannot construct editor DOM. The ID is retired and will not be reused.
- `ADL-005` is covered by a passing delayed-resource/note-switch contract; late resource completion does not alter the selected note.
- `ADL-006` is covered by a passing theme-generation contract; stale Mermaid completions are discarded.
- `ADL-007` is covered by a passing late-file-dialog contract; completion cannot recreate a closed overlay.
- `ADL-017` was closed by the handle registry seam: simulator contracts cover setup, settings fan-out, save/update ordering, disposal, and suppression after destruction.
