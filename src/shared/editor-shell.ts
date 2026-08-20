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
