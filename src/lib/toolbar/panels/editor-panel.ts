export type EditorViewMode = "live-preview" | "split";
export type SplitViewSubmode = "split" | "raw" | "preview";
type EditorModeOption = "live-preview" | "split" | "raw" | "preview";

export interface EditorPanelOptions {
  initialViewMode: EditorViewMode;
  initialSplitViewSubmode: SplitViewSubmode;
  onViewModeChange: (mode: EditorViewMode) => void;
  onSplitViewSubmodeChange: (mode: SplitViewSubmode) => void;
  onToggleLineNumbers: (show: boolean) => void;
  onToggleBlockShading: (show: boolean) => void;
  onToggleOverlayEditing: (show: boolean) => void;
  onToggleDocAttributes: (show: boolean) => void;
  onToggleFullscreen: (enabled: boolean) => void;
  onToggleAutoHide: (enabled: boolean) => void;
  onMarginChange: (px: number) => void;
  onZoomChange: (percent: number) => void;
}

export interface EditorPanelController {
  element: HTMLElement;
  setZoom: (percent: number) => void;
}

interface IconToggleOption<T extends string> {
  value: T;
  title: string;
  testId: string;
  icon: string;
}

const LIVE_PREVIEW_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M7 8h10"/><path d="M7 12h4"/><path d="M7 16h7"/><path d="M16.5 15.5c1.8 0 3.3-1.5 3.3-3.3S18.3 9 16.5 9s-3.3 1.5-3.3 3.2 1.5 3.3 3.3 3.3Z"/></svg>`;
const SPLIT_VIEW_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="7" height="14" rx="1.5"/><rect x="13" y="5" width="7" height="14" rx="1.5"/></svg>`;
const RAW_ONLY_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="12" height="14" rx="1.5"/><path d="M18.5 5v14"/><path d="M7 9h6"/><path d="M7 13h4"/><path d="M7 17h5"/></svg>`;
const PREVIEW_ONLY_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 5v14"/><rect x="8" y="5" width="11.5" height="14" rx="1.5"/><path d="M11 9h5"/><path d="M11 13h7"/><path d="M11 17h4"/></svg>`;

/** Helper: creates a `.ribbon-section` wrapper with label and child controls. */
function createRibbonSection(label: string, ...children: HTMLElement[]): HTMLElement {
  const section = document.createElement("div");
  section.className = "ribbon-section";

  const controls = document.createElement("div");
  controls.className = "ribbon-section-controls";
  for (const child of children) controls.appendChild(child);

  const lbl = document.createElement("div");
  lbl.className = "ribbon-section-label";
  lbl.textContent = label;

  section.appendChild(controls);
  section.appendChild(lbl);
  return section;
}

function createIconToggleGroup<T extends string>(
  options: IconToggleOption<T>[],
  value: T,
  onChange: (value: T) => void,
) {
  const group = document.createElement("div");
  group.className = "ribbon-icon-toggle-group";
  group.setAttribute("role", "group");

  const buttons = new Map<T, HTMLButtonElement>();
  let currentValue = value;

  const sync = () => {
    for (const option of options) {
      const button = buttons.get(option.value);
      if (!button) continue;
      const isActive = option.value === currentValue;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    }
  };

  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ribbon-icon-btn ribbon-mode-btn";
    button.title = option.title;
    button.setAttribute("aria-label", option.title);
    button.setAttribute("data-testid", option.testId);
    button.innerHTML = option.icon;
    button.addEventListener("click", () => {
      if (button.disabled || option.value === currentValue) return;
      currentValue = option.value;
      sync();
      onChange(option.value);
    });
    buttons.set(option.value, button);
    group.appendChild(button);
  }

  sync();

  return {
    element: group,
    setValue(nextValue: T) {
      currentValue = nextValue;
      sync();
    },
    setDisabled(disabled: boolean) {
      group.classList.toggle("is-disabled", disabled);
      for (const button of buttons.values()) {
        button.disabled = disabled;
      }
    },
  };
}

function getSelectedModeOption(
  viewMode: EditorViewMode,
  splitViewSubmode: SplitViewSubmode,
): EditorModeOption {
  if (viewMode === "live-preview") return "live-preview";
  return splitViewSubmode;
}

export function buildEditorPanel(options: EditorPanelOptions, initialMargin?: number, initialZoom?: number): EditorPanelController {
  const wrapper = document.createElement("div");
  wrapper.style.display = "contents";

  let currentViewMode = options.initialViewMode;
  let currentSplitViewSubmode = options.initialSplitViewSubmode;

  // --- Mode section ---
  const modeControls = document.createElement("div");
  modeControls.className = "editor-view-mode-controls";

  const modeGroup = createIconToggleGroup<EditorModeOption>([
    {
      value: "live-preview",
      title: "Live Preview",
      testId: "view-mode-live-preview",
      icon: LIVE_PREVIEW_ICON,
    },
    {
      value: "split",
      title: "Split View",
      testId: "view-mode-split",
      icon: SPLIT_VIEW_ICON,
    },
    {
      value: "raw",
      title: "Raw Text Only",
      testId: "view-mode-raw-only",
      icon: RAW_ONLY_ICON,
    },
    {
      value: "preview",
      title: "Rendered AsciiDoc Preview",
      testId: "view-mode-rendered-preview",
      icon: PREVIEW_ONLY_ICON,
    },
  ], getSelectedModeOption(currentViewMode, currentSplitViewSubmode), (mode) => {
    if (mode === "live-preview") {
      currentViewMode = "live-preview";
      localStorage.setItem("asciidoc-editor-view-mode", "live-preview");
      syncModeDependentUi();
      options.onViewModeChange("live-preview");
      return;
    }

    const nextViewMode: EditorViewMode = "split";
    const nextSplitViewSubmode: SplitViewSubmode = mode;
    const viewModeChanged = currentViewMode !== nextViewMode;
    const splitViewSubmodeChanged = currentSplitViewSubmode !== nextSplitViewSubmode;

    currentViewMode = nextViewMode;
    currentSplitViewSubmode = nextSplitViewSubmode;
    localStorage.setItem("asciidoc-editor-view-mode", nextViewMode);
    localStorage.setItem("asciidoc-editor-split-submode", nextSplitViewSubmode);
    syncModeDependentUi();

    if (viewModeChanged) {
      options.onViewModeChange(nextViewMode);
    }
    if (splitViewSubmodeChanged) {
      options.onSplitViewSubmodeChange(nextSplitViewSubmode);
    }
  });

  modeControls.appendChild(modeGroup.element);
  wrapper.appendChild(createRibbonSection("Mode", modeControls));

  // --- Display section ---
  const displayToggles = document.createElement("div");
  displayToggles.className = "editor-toggles";

  const lineNumLabel = document.createElement("label");
  lineNumLabel.className = "ribbon-toggle";
  const lineNumCb = document.createElement("input");
  lineNumCb.type = "checkbox";
  const savedLineNumbers = localStorage.getItem("asciidoc-line-numbers");
  lineNumCb.checked = savedLineNumbers === "true";
  lineNumCb.addEventListener("input", () => {
    options.onToggleLineNumbers(lineNumCb.checked);
    localStorage.setItem("asciidoc-line-numbers", String(lineNumCb.checked));
  });
  const lineNumSpan = document.createElement("span");
  lineNumSpan.textContent = "Line Numbers";
  lineNumLabel.appendChild(lineNumCb);
  lineNumLabel.appendChild(lineNumSpan);
  displayToggles.appendChild(lineNumLabel);

  const docAttrLabel = document.createElement("label");
  docAttrLabel.className = "ribbon-toggle";
  const docAttrCb = document.createElement("input");
  docAttrCb.type = "checkbox";
  const savedDocAttr = localStorage.getItem("asciidoc-doc-attributes");
  docAttrCb.checked = savedDocAttr === null ? false : savedDocAttr === "true";
  docAttrCb.addEventListener("input", () => {
    options.onToggleDocAttributes(docAttrCb.checked);
    localStorage.setItem("asciidoc-doc-attributes", String(docAttrCb.checked));
  });
  const docAttrSpan = document.createElement("span");
  docAttrSpan.textContent = "Document Attributes";
  docAttrLabel.appendChild(docAttrCb);
  docAttrLabel.appendChild(docAttrSpan);
  displayToggles.appendChild(docAttrLabel);

  wrapper.appendChild(createRibbonSection("Editor", displayToggles));

  // --- Appearance section ---
  const appearanceToggles = document.createElement("div");
  appearanceToggles.className = "editor-toggles editor-toggles-appearance";

  const shadingLabel = document.createElement("label");
  shadingLabel.className = "ribbon-toggle";
  const shadingCb = document.createElement("input");
  shadingCb.type = "checkbox";
  const savedShading = localStorage.getItem("asciidoc-block-shading");
  shadingCb.checked = savedShading === null ? false : savedShading === "true";
  shadingCb.addEventListener("input", () => {
    options.onToggleBlockShading(shadingCb.checked);
    localStorage.setItem("asciidoc-block-shading", String(shadingCb.checked));
  });
  const shadingSpan = document.createElement("span");
  shadingSpan.textContent = "Special Block Shading";
  shadingLabel.appendChild(shadingCb);
  shadingLabel.appendChild(shadingSpan);
  appearanceToggles.appendChild(shadingLabel);

  const overlayLabel = document.createElement("label");
  overlayLabel.className = "ribbon-toggle";
  const overlayCb = document.createElement("input");
  overlayCb.type = "checkbox";
  const savedOverlay = localStorage.getItem("asciidoc-overlay-editing");
  overlayCb.checked = savedOverlay === null ? true : savedOverlay === "true";
  overlayCb.addEventListener("input", () => {
    options.onToggleOverlayEditing(overlayCb.checked);
    localStorage.setItem("asciidoc-overlay-editing", String(overlayCb.checked));
  });
  const overlaySpan = document.createElement("span");
  overlaySpan.textContent = "Overlay Block Editing";
  overlayLabel.appendChild(overlayCb);
  overlayLabel.appendChild(overlaySpan);
  appearanceToggles.appendChild(overlayLabel);

  wrapper.appendChild(createRibbonSection("Appearance", appearanceToggles));

  // --- Panel section ---
  const panelToggles = document.createElement("div");
  panelToggles.className = "editor-toggles";

  const fullscreenLabel = document.createElement("label");
  fullscreenLabel.className = "ribbon-toggle";
  const fullscreenCb = document.createElement("input");
  fullscreenCb.type = "checkbox";
  fullscreenCb.checked = false;
  fullscreenCb.addEventListener("input", () => {
    options.onToggleFullscreen(fullscreenCb.checked);
  });
  const fullscreenSpan = document.createElement("span");
  fullscreenSpan.textContent = "Fullscreen Mode";
  fullscreenLabel.appendChild(fullscreenCb);
  fullscreenLabel.appendChild(fullscreenSpan);
  panelToggles.appendChild(fullscreenLabel);

  const autoHideLabel = document.createElement("label");
  autoHideLabel.className = "ribbon-toggle";
  const autoHideCb = document.createElement("input");
  autoHideCb.type = "checkbox";
  const savedAutoHide = localStorage.getItem("asciidoc-autohide-toolbar");
  autoHideCb.checked = savedAutoHide === "true";
  autoHideCb.addEventListener("input", () => {
    options.onToggleAutoHide(autoHideCb.checked);
    localStorage.setItem("asciidoc-autohide-toolbar", String(autoHideCb.checked));
  });
  const autoHideSpan = document.createElement("span");
  autoHideSpan.textContent = "Auto-Hide Toolbar";
  autoHideLabel.appendChild(autoHideCb);
  autoHideLabel.appendChild(autoHideSpan);
  panelToggles.appendChild(autoHideLabel);

  wrapper.appendChild(createRibbonSection("Panel", panelToggles));

  // --- Layout section ---
  let marginValue = initialMargin || 0;

  const marginControl = document.createElement("div");
  marginControl.className = "ribbon-margin-control";

  const marginHeader = document.createElement("div");
  marginHeader.className = "ribbon-margin-header";

  const marginValueSpan = document.createElement("span");
  marginValueSpan.className = "ribbon-margin-value";
  marginValueSpan.textContent = `${marginValue}px`;

  marginHeader.appendChild(marginValueSpan);

  const marginSlider = document.createElement("input");
  marginSlider.type = "range";
  marginSlider.min = "0";
  marginSlider.max = "300";
  marginSlider.step = "10";
  marginSlider.value = String(marginValue);
  marginSlider.className = "ribbon-margin-slider";
  marginSlider.addEventListener("input", () => {
    const val = parseInt(marginSlider.value, 10);
    if (!isNaN(val)) {
      marginValue = val;
      marginValueSpan.textContent = `${val}px`;
      options.onMarginChange(val);
    }
  });

  marginControl.appendChild(marginHeader);
  marginControl.appendChild(marginSlider);

  wrapper.appendChild(createRibbonSection("Margins", marginControl));

  // --- Zoom section ---
  let zoomValue = initialZoom || 100;

  const zoomControl = document.createElement("div");
  zoomControl.className = "ribbon-zoom-control";

  const zoomHeader = document.createElement("div");
  zoomHeader.className = "ribbon-zoom-header";

  const zoomValueSpan = document.createElement("span");
  zoomValueSpan.className = "ribbon-zoom-value";
  zoomValueSpan.textContent = `${zoomValue}%`;

  const zoomSlider = document.createElement("input");
  zoomSlider.type = "range";
  zoomSlider.min = "50";
  zoomSlider.max = "150";
  zoomSlider.step = "5";
  zoomSlider.value = String(zoomValue);
  zoomSlider.className = "ribbon-zoom-slider";

  const syncZoomUi = (percent: number) => {
    zoomValue = percent;
    zoomSlider.value = String(percent);
    zoomValueSpan.textContent = `${percent}%`;
    zoomReset.style.display = percent === 100 ? "none" : "";
  };

  const zoomReset = document.createElement("button");
  zoomReset.className = "ribbon-zoom-reset";
  zoomReset.textContent = "Reset";
  zoomReset.title = "Reset to 100%";
  zoomReset.style.display = zoomValue === 100 ? "none" : "";
  zoomReset.addEventListener("click", () => {
    syncZoomUi(100);
    options.onZoomChange(100);
  });

  zoomHeader.appendChild(zoomReset);
  zoomHeader.appendChild(zoomValueSpan);

  zoomSlider.addEventListener("input", () => {
    const val = parseInt(zoomSlider.value, 10);
    if (!isNaN(val)) {
      syncZoomUi(val);
      options.onZoomChange(val);
    }
  });

  zoomControl.appendChild(zoomHeader);
  zoomControl.appendChild(zoomSlider);

  wrapper.appendChild(createRibbonSection("Zoom", zoomControl));

  function syncModeDependentUi() {
    const splitModeActive = currentViewMode === "split";
    modeGroup.setValue(getSelectedModeOption(currentViewMode, currentSplitViewSubmode));
    overlayCb.disabled = splitModeActive;
    overlayLabel.classList.toggle("is-disabled", splitModeActive);
  }

  syncModeDependentUi();

  return {
    element: wrapper,
    setZoom: syncZoomUi,
  };
}
