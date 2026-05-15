import { buildTextPanel } from "./panels/text-panel";
import { buildInsertPanel } from "./panels/insert-panel";
import { buildFormattingPanel } from "./panels/formatting-panel";
import { buildEditorPanel, type EditorPanelController, type EditorPanelOptions } from "./panels/editor-panel";

type TabId = "text" | "insert" | "formatting" | "editor";

const tabs: { id: TabId; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "insert", label: "Insert" },
  { id: "formatting", label: "Advanced" },
  { id: "editor", label: "View" },
];

export function buildRibbon(container: HTMLElement, editorOptions?: EditorPanelOptions, initialMargin?: number, initialZoom?: number): void {
  let activeTab: TabId = "text";
  let currentCleanup: (() => void) | null = null;
  let activeEditorPanel: EditorPanelController | null = null;
  let currentZoom = initialZoom || 100;
  let currentMargin = initialMargin;
  let currentViewMode: EditorPanelOptions["initialViewMode"] = editorOptions?.initialViewMode || "live-preview";
  let currentSplitViewSubmode: EditorPanelOptions["initialSplitViewSubmode"] = editorOptions?.initialSplitViewSubmode || "split";

  const ribbon = document.createElement("div");
  ribbon.className = "ribbon";

  // --- Tabs row ---
  const tabsRow = document.createElement("div");
  tabsRow.className = "ribbon-tabs";

  const tabButtons: Map<TabId, HTMLButtonElement> = new Map();

  for (const tab of tabs) {
    const btn = document.createElement("button");
    btn.className = "ribbon-tab";
    if (tab.id === activeTab) btn.classList.add("active");
    btn.textContent = tab.label;
    btn.addEventListener("click", () => setTab(tab.id));
    tabsRow.appendChild(btn);
    tabButtons.set(tab.id, btn);
  }

  // --- Panel area ---
  const panel = document.createElement("div");
  panel.className = "ribbon-panel";

  ribbon.appendChild(tabsRow);
  ribbon.appendChild(panel);
  container.appendChild(ribbon);

  function setTab(id: TabId) {
    activeTab = id;
    for (const [tabId, btn] of tabButtons) {
      btn.classList.toggle("active", tabId === id);
    }
    renderPanel();
  }

  function renderPanel() {
    // Clean up previous panel's event listeners
    if (currentCleanup) {
      currentCleanup();
      currentCleanup = null;
    }
    panel.innerHTML = "";
    activeEditorPanel = null;

    let result: { element: HTMLElement; cleanup?: () => void };
    switch (activeTab) {
      case "text":
        result = buildTextPanel();
        break;
      case "insert":
        result = buildInsertPanel();
        break;
      case "formatting":
        result = buildFormattingPanel();
        break;
      case "editor": {
        const opts = editorOptions || {
          initialViewMode: "live-preview",
          initialSplitViewSubmode: "split",
          onViewModeChange: () => {},
          onSplitViewSubmodeChange: () => {},
          onToggleLineNumbers: () => {},
          onToggleBlockShading: () => {},
          onToggleOverlayEditing: () => {},
          onToggleDocAttributes: () => {},
          onToggleFullscreen: () => {},
          onToggleAutoHide: () => {},
          onMarginChange: () => {},
          onZoomChange: () => {},
        };
        const wrappedOpts = {
          ...opts,
          initialViewMode: currentViewMode,
          initialSplitViewSubmode: currentSplitViewSubmode,
          onViewModeChange: (mode: typeof currentViewMode) => {
            currentViewMode = mode;
            opts.onViewModeChange(mode);
          },
          onSplitViewSubmodeChange: (mode: typeof currentSplitViewSubmode) => {
            currentSplitViewSubmode = mode;
            opts.onSplitViewSubmodeChange(mode);
          },
          onZoomChange: (percent: number) => {
            currentZoom = percent;
            opts.onZoomChange(percent);
          },
          onMarginChange: (value: number) => {
            currentMargin = value;
            opts.onMarginChange(value);
          },
        };
        activeEditorPanel = buildEditorPanel(wrappedOpts, currentMargin, currentZoom);
        result = { element: activeEditorPanel.element };
        break;
      }
      default:
        return;
    }

    panel.appendChild(result.element);
    currentCleanup = result.cleanup || null;
  }

  // Render the initial panel
  renderPanel();
}
