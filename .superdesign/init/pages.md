# Page Dependency Trees

## `/` — Test Lab dashboard

Entry markup: `test-lab/controller/index.html`

Dependencies:

- `test-lab/controller/index.html`
  - `test-lab/controller/controller.css`
  - `test-lab/controller/index.ts`
    - `src/shared/editor-host-contracts.ts`
    - `test-lab/fixtures/index.ts`
      - `test-lab/shared/scenario.ts`
        - `src/shared/editor-host-contracts.ts` (shared above)
    - `test-lab/shared/scenario.ts` (shared above)
    - `test-lab/shared/lab-protocol.ts`
      - `test-lab/shared/lab-schemas.ts`
      - `test-lab/shared/scenario.ts` (shared above)
    - `test-lab/shared/lab-schemas.ts` (shared above)
    - `test-lab/controller/session-bridge.ts`
      - `src/shared/editor-host-contracts.ts` (shared above)
      - `src/host/editor-rpc-service.ts`
        - `src/shared/editor-host-contracts.ts` (shared above)
      - `test-lab/shared/lab-protocol.ts` (shared above)
      - `test-lab/shared/lab-schemas.ts` (shared above)
      - `test-lab/shared/scenario.ts` (shared above)
      - `test-lab/controller/store.ts`
        - `src/shared/asciidoc-sections.ts`
          - `src/shared/asciidoc-attributes.ts`
        - `src/host/rendering.ts`
          - `src/lib/utils/rendered-highlight.ts`
          - `src/lib/utils/rendered-math.ts`
            - `src/shared/asciidoc-attributes.ts` (shared above)
            - `src/lib/utils/math-render.ts`
        - `src/host/markdown-conversion.ts`
        - `src/host/editor-rpc-service.ts` (shared above)
        - `src/host/editor-host-application.ts`
          - `src/shared/editor-host-contracts.ts` (shared above)
          - `src/host/editor-rpc-service.ts` (shared above)
        - `src/host/include-expansion.ts`
        - `src/shared/editor-host-contracts.ts` (shared above)
        - `test-lab/shared/scenario.ts` (shared above)
        - `test-lab/shared/scheduler.ts`
    - `test-lab/controller/store.ts` (shared above)

Actual rendered desktop branch: the static HTML always renders a compact top bar
and a three-column grid. TypeScript populates and updates controls, editor
iframes, diagnostic logs, status outputs, pending work, and warning banners; it
does not select an alternate top-level layout branch.

## `/editor.html` — isolated editor iframe

Entry markup: `test-lab/editor/editor.html`

The iframe imports production editor CSS and the production panel bundle. It is
a nested work surface, not a sibling controller page. The baseline-review design
should represent evidence imagery inside its own viewer and must not reproduce
or reimplement this editor subsystem.

Dependencies relevant to layout:

- `test-lab/editor/editor.html`
  - `test-lab/editor/editor.css`
  - `test-lab/editor/bootstrap.ts`
    - `src/shared/editor-shell.ts`
    - `src/lib/editor-transport.ts`
    - `src/shared/editor-host-contracts.ts`
    - `src/shared/editor-diagnostics.ts`
  - `src/panel.ts` (production bundle entry)
  - `src/styles/editor.css`
  - `src/styles/preview.css`
  - `node_modules/katex/dist/katex.min.css`
