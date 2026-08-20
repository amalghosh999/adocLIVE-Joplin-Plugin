# Extractable Components

The dashboard is static HTML rather than a component tree. The following stable
patterns can still be extracted for design continuity; source fragments live in
`test-lab/controller/index.html` and styles in
`test-lab/controller/controller.css`.

## TestLabTopbar

- Source: `test-lab/controller/index.html`
- Category: layout
- Description: Compact product/tool identity at left with live status metrics at right.
- Extractable props: `title` (string, default `adocLIVE Test Lab`), `subtitle` (string), `activePage` (string, default `dashboard`), `statusItems` (static preview values for the canvas)
- Hardcoded: typography, panel background, bottom border, compact height, utility-first density, no logo or decorative mark

## ThreePaneWorkspace

- Source: `test-lab/controller/index.html`
- Category: layout
- Description: Left control rail, flexible central work surface, and right diagnostic/detail rail.
- Extractable props: `leftTitle`, `centerTitle`, `rightTitle`, `activePane`
- Hardcoded: CSS-grid structure, panel borders, independent scrolling, compact spacing

## StatusBadge

- Source: `test-lab/controller/index.html`
- Category: basic
- Description: Small rectangular status label used for artifact and environment state.
- Extractable props: `label`, `tone`, `hidden`
- Hardcoded: `.25rem` radius, compact padding, white-on-accent default

## BorderedSection

- Source: `test-lab/controller/index.html`
- Category: basic
- Description: Native fieldset/legend grouping used throughout the controls rail.
- Extractable props: `title`, `disabled`
- Hardcoded: square bordered container, `.65rem` padding, `.45rem` internal gap
