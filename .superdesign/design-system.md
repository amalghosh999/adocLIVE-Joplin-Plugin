# adocLIVE Test Lab Design System

## Product and audience

adocLIVE Test Lab is a contributor-facing engineering tool for exercising the
real Joplin editor bundle against deterministic scenarios. It is dense,
information-first, offline by default, and intentionally looks like diagnostic
software rather than a consumer dashboard. The target users are maintainers and
release reviewers who need to compare exact evidence, understand provenance,
and make explicit approval decisions without repository writes from the browser.

Key surfaces:

- Dashboard: configure scenarios and editor presentation, manipulate a simulated
  host, view one or two real editor frames, and inspect diagnostics.
- Baseline review: select a digest-bound candidate run, review all 13 visual
  images and one characterized scroll result, capture platform evidence, and
  export a final receipt. It is a new sibling route on the controller origin.

## Visual foundation

Use the existing controller as the sole style source.

- Font: `Inter, ui-sans-serif, system-ui, sans-serif`, base `13px/1.4`.
- Monospace: `ui-monospace, monospace`, `11px/1.35` for hashes, metrics, logs,
  and evidence tables.
- Canvas: `light-dark(#e9edf2, #15181d)`.
- Panels: `light-dark(#f7f8fa, #20242a)`.
- Controls/log surfaces: `light-dark(#ffffff, #2c323a)` and log dark
  `light-dark(#ffffff, #111418)`.
- Text: `light-dark(#20252c, #e8ebef)`; muted
  `light-dark(#59616d, #aab2bd)`.
- Border: `light-dark(#c9ced6, #48505c)`.
- Accent: `#477fd1`. Reserve it for selection, links, primary action, and focus.
- Success: restrained forest green (`#2f7d4a` light / `#66c187` dark).
- Warning: existing `#fff2bd` background with `#4d3500` text.
- Danger/rejection: existing fatal family `#6e1717`; private-warning family
  `#ffe1d5` / `#64210a` for less severe blocks.
- Corners: `.2rem` controls, `.25rem` badges. Avoid pills and large rounded cards.
- Shadow: only where layering requires it, matching `0 2px 10px #0002`.
- Spacing: compact `.2rem`–`1rem` increments; dense rows at 32–40px.
- Icons: simple inline system/SVG icons only when text alone is insufficient.
  The existing UI has no logo and must not gain an invented brand mark.

## Layout and hierarchy

- Preserve the compact top bar, with tool title/subtitle at left and status,
  environment, and navigation at right.
- Treat the existing Joplin plugin toolbar layout and button icons as immutable
  compatibility UI. New review navigation is additive and must not replace,
  redraw, resize, or restyle the existing controls or iconography.
- Desktop review uses three independently scrollable panes: a 280–320px queue,
  a flexible evidence viewer, and a 340–390px decision/evidence rail.
- Use borders and background shifts rather than floating card collections.
- Keep the evidence image as the visual priority. Controls should be quiet and
  close to the evidence they affect.
- At narrower widths, keep the queue reachable and move the decision rail below
  the viewer; never hide required evidence or decisions. At phone widths, use a
  single-column sequence with a sticky compact item header.

## Baseline-review interaction contract

- Left queue: search; status and scenario filters; one row per visual image plus
  the single scroll evidence item; explicit unresolved/approved/rejected status;
  no bulk approval.
- Center: visual modes for before, candidate, diff, synchronized split, and
  opacity overlay. Preserve image aspect and provide zoom/pan/reset. The scroll
  item instead shows all 30 values, run-order plot, distribution, geometry,
  regression ceiling, and median/worst key frames.
- Right: approve, reject, or request regeneration; notes; known-issue context;
  immutable bundle metadata; Windows/macOS evidence forms; final rationale and
  receipt export. Reject/regenerate requires a note.
- Keyboard: previous/next item and next unresolved shortcuts; shortcuts are
  disabled while a text field is active. Focus order follows queue → viewer →
  decision/evidence. Every control has visible focus.
- Drafts autosave in localStorage by bundle digest and can be imported/exported.
  A changed bundle may migrate notes but resets all decisions.
- Finalization stays disabled until every item is approved, canonical environment
  and zero production advisories are proven, both native-platform records are
  complete, known issues are acknowledged, and an overall rationale is present.
- Approval of the scroll regression ceiling characterizes current behavior only.
  The quarter-line ADL-022 target and bottom-clamp ADL-023 remain expected
  failures and must never be presented as accepted/correct behavior.

## States and accessibility

- Include loading, empty/no-run, malformed bundle, tampered/missing artifact,
  noncanonical environment, advisory-blocked, rejected, ready-to-finalize, and
  receipt-generated states.
- Meet WCAG 2.2 AA contrast, keyboard, focus visibility, names, descriptions,
  error association, and target sizing appropriate to a dense desktop tool.
- Support forced-colors with semantic borders and native controls.
- Honor `prefers-reduced-motion`; use no essential animation and no auto-panning.
- Status must never rely on color alone: always pair tone with an icon or label.

## Motion

No decorative motion. Allow only immediate state changes and a subtle,
reduced-motion-safe focus/selection transition of at most 120ms.

## Security and implementation constraints visible in the design

- Browser review is read-only with respect to the repository. The only outputs
  are local draft/receipt JSON downloads.
- The controller remains loopback-only and offline; do not design cloud sync,
  account controls, POST actions, package-management actions, or publish buttons.
- Long hashes, paths, reviewer metadata, audit IDs, and platform details must wrap
  or scroll safely without truncating the evidence needed for validation.
