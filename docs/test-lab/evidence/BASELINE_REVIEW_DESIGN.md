# Baseline Review Page Design Evidence

Status: approved by the repository owner

Prepared: 2026-08-20

Approved: 2026-08-20, version 4

Superdesign project: [adocLIVE Test Lab — Baseline Review](https://superdesign.dev/teams/dd5f9021-e9f0-49cf-8f38-67b6ae4fedb0/projects/edbe6f92-5b63-4a0c-8c17-1f0d7027e9fc)

- Current-dashboard reproduction: [draft 1c3f6504](https://p.superdesign.dev/draft/1c3f6504-fd70-4397-a327-2aa456a392bb), version 1.
- Selected review-page direction: [draft da327fed](https://p.superdesign.dev/draft/da327fed-dbf6-4ed6-90a6-1c23b0e3ea28), version 4.
- Local source of design-system context: `.superdesign/design-system.md` and the six files beneath `.superdesign/init/`.

## Recorded decisions

- Preserve the current Joplin plugin toolbar's existing button icons and overall
  formatting. The Test Lab top bar is likewise compatibility UI: the review
  route may add a compact navigation link, but implementation must not replace,
  redraw, or restyle the existing controls or iconography.
- Preserve the existing compact Test Lab palette, typography, native-control
  density, square borders, and three-pane hierarchy. Do not add a logo,
  gradients, marketing artwork, or consumer-dashboard cards.
- Keep one queue row and one decision per visual artifact; never expose bulk
  approval.
- Make the evidence image or scroll visualization the central visual priority.
  The decision rail holds notes, immutable provenance, native evidence, known-
  issue acknowledgements, and finalization blockers.
- Present the 690.3125 px scroll ceiling as characterization only. ADL-022 and
  ADL-023 remain desired-behavior expected failures.
- Keep browser actions local and read-only: draft import/export and receipt
  download only, with no publication or repository mutation.

## States reviewed before approval request

- 1600 × 1000: full three-pane visual comparison with selected, approved,
  unresolved, focused, disabled, and hash-wrapping states.
- 1100 × 1000: queue and viewer remain side by side; decision/evidence reflows
  below without an unused third column.
- 700 × 1000: true single-column queue → viewer → decision flow with no crushed
  evidence column.
- Scroll selection: all 30 values, run-order plot, distribution, statistics,
  median/worst frames, and ADL-022/023 explanation are visible.
- Focus/error: the Approve focus treatment is shown without autofocus; incomplete
  macOS metadata/deviations and two missing delta checks visibly block receipt
  finalization.

The repository owner approved version 4 with the toolbar/icon preservation
constraint above. Production implementation may proceed against this record;
future visual changes iterate the selected review draft in place and preserve
version history.
