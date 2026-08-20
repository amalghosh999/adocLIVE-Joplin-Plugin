# Shared UI Components

The Test Lab controller is a framework-free TypeScript application. It does not
currently have a shared component directory or JavaScript component library;
buttons, inputs, fieldsets, badges, logs, and disclosure widgets are native HTML
elements styled globally in `test-lab/controller/controller.css`.

The only shared UI-producing module is the editor shell used by both Joplin and
the Test Lab iframe.

## EditorShell

- Source: `src/shared/editor-shell.ts`
- Description: Pure editor-root markup shared by Joplin's custom-editor registration and the Test Lab.
- Key props: `themeClass` (`"light-theme" | "dark-theme"`)

```ts
export interface EditorShellOptions {
  themeClass?: "light-theme" | "dark-theme";
}

/** Pure markup shared by Joplin's custom-editor registration and the Test Lab. */
export function buildEditorShell(options: EditorShellOptions = {}): string {
  const themeClass = options.themeClass === "dark-theme" ? "dark-theme" : "light-theme";
  return `<div id="asciidoc-editor-root" class="${themeClass}">
    <div id="ribbon-container"></div>
    <div id="editor-layout" class="editor-layout" data-view-mode="live-preview" data-split-view-submode="split">
      <div id="editor-pane" class="editor-surface editor-surface--raw"></div>
      <div id="editor-split-divider" class="editor-split-divider" hidden></div>
      <div id="preview-pane-container" class="editor-surface editor-surface--preview" hidden>
        <div id="preview-pane"></div>
      </div>
    </div>
  </div>`;
}
```

The dashboard's reusable visual patterns are catalogued in
`extractable-components.md`; their source is static markup rather than an
existing component abstraction.
