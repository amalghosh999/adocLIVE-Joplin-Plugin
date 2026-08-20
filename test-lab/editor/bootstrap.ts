import { buildEditorShell } from "../../src/shared/editor-shell";
import { MessagePortEditorTransport } from "../../src/lib/editor-transport";
import {
  LabConnectSchema,
  LabControlRequestSchema,
  type LabControlResult,
  type LabDiagnosticEnvelope,
  type LabTimelineEnvelope,
} from "../shared/lab-protocol";
import type { EditorDiagnosticEvent } from "../../src/shared/editor-diagnostics";
import type { LabTimelineEvent } from "../shared/scenario";

const params = new URLSearchParams(location.search);
const sessionId = params.get("session") || "";
const nonce = params.get("nonce") || "";
const controllerOrigin = params.get("controllerOrigin") || "";
const diagnosticsEnabled = params.get("diagnostics") !== "0";
const privateSession = params.get("private") === "1";

class IsolatedStorage implements Storage {
  private readonly values = new Map<string, string>();

  constructor(seed: Record<string, string>) {
    for (const [key, value] of Object.entries(seed)) this.values.set(key, value);
  }

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(String(key)) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(String(key)); }
  setItem(key: string, value: string): void { this.values.set(String(key), String(value)); }
}

function fail(message: string): never {
  document.body.innerHTML = `<main class="lab-editor-error"><h1>Test Lab connection failed</h1><p></p></main>`;
  document.querySelector("p")!.textContent = message;
  throw new Error(message);
}

if (!sessionId || nonce.length < 16) fail("Missing or invalid session identity.");
let expectedOrigin: URL;
try {
  expectedOrigin = new URL(controllerOrigin);
} catch {
  fail("Invalid controller origin.");
}
if (!/^https?:$/.test(expectedOrigin.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(expectedOrigin.hostname)) {
  fail("The Test Lab controller must use a loopback origin.");
}

let scenarioStorage: Record<string, string> = {};
try {
  const parsed = JSON.parse(params.get("storage") || "{}");
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    scenarioStorage = Object.fromEntries(Object.entries(parsed)
      .filter(([key, value]) => key.length <= 200 && typeof value === "string" && value.length <= 10_000)) as Record<string, string>;
  }
} catch {
  fail("Invalid editor local-storage seed.");
}

const storageSeed: Record<string, string | null> = {
  ...scenarioStorage,
  "asciidoc-editor-view-mode": params.get("view") === "live-preview" ? "live-preview" : params.get("view") ? "split" : null,
  "asciidoc-editor-split-submode": ["split", "raw", "preview"].includes(params.get("view") || "") ? params.get("view") : null,
  "asciidoc-editor-zoom": params.get("zoom"),
  "asciidoc-editor-margin": params.get("margin"),
  "asciidoc-compact-spacing": params.get("compact"),
};
const isolatedStorage = new IsolatedStorage(Object.fromEntries(Object.entries(storageSeed)
  .filter((entry): entry is [string, string] => entry[1] != null)));
Object.defineProperty(globalThis, "localStorage", { configurable: false, enumerable: true, value: isolatedStorage });

document.documentElement.dataset.adocLabDiagnostics = diagnosticsEnabled ? "true" : "false";
document.documentElement.dataset.privateSession = String(privateSession);
document.body.innerHTML = buildEditorShell({ themeClass: params.get("theme") === "dark" ? "dark-theme" : "light-theme" });

let connected = false;
let diagnosticSequence = 0;
let timelineSequence = 0;
let port: MessagePort | null = null;
let controlPort: MessagePort | null = null;
let replaying = false;

function sendDiagnostic(event: EditorDiagnosticEvent): void {
  if (!port || !diagnosticsEnabled) return;
  const envelope: LabDiagnosticEnvelope = {
    protocol: "adoclive.lab-diagnostics",
    version: 1,
    kind: "diagnostic",
    sessionId,
    nonce,
    sequence: ++diagnosticSequence,
    payload: event,
  };
  port.postMessage(envelope);
}

function sendTimeline(event: LabTimelineEvent): void {
  if (!port || replaying) return;
  const envelope: LabTimelineEnvelope = {
    protocol: "adoclive.lab-timeline",
    version: 1,
    kind: "event",
    sessionId,
    nonce,
    sequence: ++timelineSequence,
    payload: { ...event, at: 0, sessionId },
  };
  port.postMessage(envelope);
}

function modifiersFromEvent(event: KeyboardEvent): Array<"Alt" | "Control" | "Meta" | "Shift"> {
  const modifiers: Array<"Alt" | "Control" | "Meta" | "Shift"> = [];
  if (event.altKey) modifiers.push("Alt");
  if (event.ctrlKey) modifiers.push("Control");
  if (event.metaKey) modifiers.push("Meta");
  if (event.shiftKey) modifiers.push("Shift");
  return modifiers;
}

function editorOffset(node: Node | null, offset: number): number | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const line = element?.closest<HTMLElement>(".cm-line");
  const content = line?.closest<HTMLElement>(".cm-content");
  if (!line || !content || !node) return null;
  const lines = [...content.querySelectorAll<HTMLElement>(".cm-line")];
  const lineIndex = lines.indexOf(line);
  if (lineIndex < 0) return null;
  const within = document.createRange();
  within.setStart(line, 0);
  try { within.setEnd(node, offset); } catch { return null; }
  return lines.slice(0, lineIndex).reduce((total, candidate) => total + (candidate.textContent?.length || 0) + 1, 0)
    + within.toString().length;
}

function pointAtEditorOffset(content: HTMLElement, target: number): { node: Node; offset: number } {
  const lines = [...content.querySelectorAll<HTMLElement>(".cm-line")];
  let remaining = Math.max(0, target);
  const chosen = lines.find(line => {
    const length = line.textContent?.length || 0;
    if (remaining <= length) return true;
    remaining -= length + 1;
    return false;
  }) || lines.at(-1) || content;
  const walker = document.createTreeWalker(chosen, NodeFilter.SHOW_TEXT);
  let text = walker.nextNode();
  while (text) {
    const length = text.textContent?.length || 0;
    if (remaining <= length) return { node: text, offset: remaining };
    remaining -= length;
    text = walker.nextNode();
  }
  return { node: chosen, offset: chosen.childNodes.length };
}

function clickElement(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, clientX: rect.left + Math.min(rect.width / 2, 12), clientY: rect.top + rect.height / 2, button: 0 };
  element.dispatchEvent(new MouseEvent("mousedown", init));
  element.dispatchEvent(new MouseEvent("mouseup", init));
  element.dispatchEvent(new MouseEvent("click", init));
}

async function performControl(event: LabTimelineEvent): Promise<void> {
  let content = document.querySelector<HTMLElement>(".cm-content");
  if (event.action.startsWith("editor.")) {
    const deadline = performance.now() + 10_000;
    while (!content && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
      content = document.querySelector<HTMLElement>(".cm-content");
    }
    if (!content) throw new Error("CodeMirror is not ready");
  }
  replaying = true;
  try {
    if (event.action === "editor.type") {
      content!.focus();
      if (!document.execCommand("insertText", false, event.text)) throw new Error("Browser rejected semantic text insertion");
    } else if (event.action === "editor.select") {
      const selection = getSelection();
      const range = document.createRange();
      const start = pointAtEditorOffset(content!, Math.min(event.from, event.to));
      const end = pointAtEditorOffset(content!, Math.max(event.from, event.to));
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      selection?.removeAllRanges();
      selection?.addRange(range);
      content!.focus();
      document.dispatchEvent(new Event("selectionchange"));
    } else if (event.action === "editor.sourceClick") {
      const line = [...content!.querySelectorAll<HTMLElement>(".cm-line")][event.line - 1];
      if (!line) throw new Error(`Source line ${event.line} is outside the rendered viewport`);
      clickElement(line);
    } else if (event.action === "editor.scroll") {
      document.querySelector<HTMLElement>(".cm-scroller")?.scrollBy({ top: event.deltaY, behavior: "instant" });
    } else if (event.action === "editor.key") {
      content!.focus();
      const control = event.modifiers.includes("Control");
      const meta = event.modifiers.includes("Meta");
      const shift = event.modifiers.includes("Shift");
      const alt = event.modifiers.includes("Alt");
      const lower = event.key.toLocaleLowerCase();
      let applied = false;
      if ((control || meta) && lower === "z") applied = document.execCommand(shift ? "redo" : "undo");
      else if ((control || meta) && lower === "y") applied = document.execCommand("redo");
      else if (event.key === "Backspace") applied = document.execCommand("delete");
      else if (event.key === "Enter") applied = document.execCommand("insertParagraph");
      else if (event.key.length === 1 && !control && !meta && !alt) applied = document.execCommand("insertText", false, event.key);
      if (!applied) {
        const init = { key: event.key, bubbles: true, cancelable: true, ctrlKey: control, metaKey: meta, shiftKey: shift, altKey: alt };
        content!.dispatchEvent(new KeyboardEvent("keydown", init));
        content!.dispatchEvent(new KeyboardEvent("keyup", init));
      }
    } else if (event.action === "editor.toolbar") {
      const escaped = CSS.escape(event.command);
      const candidates = [...document.querySelectorAll<HTMLElement>(`button[data-testid="${escaped}"],button[aria-label="${escaped}"],button[title="${escaped}"]`)];
      const target = candidates[0] || [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find(button => button.textContent?.trim() === event.command);
      if (!target) throw new Error(`Toolbar command not found: ${event.command}`);
      clickElement(target);
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  } finally {
    replaying = false;
  }
}

function installSemanticRecorder(): void {
  document.addEventListener("beforeinput", event => {
    if (replaying || !(event instanceof InputEvent) || !event.isTrusted || !event.data) return;
    if (!event.target || !(event.target as Element).closest?.(".cm-content")) return;
    if (event.inputType === "insertText" || event.inputType === "insertCompositionText" || event.inputType === "insertFromPaste") {
      sendTimeline({ at: 0, sessionId, action: "editor.type", text: event.data });
    }
  }, true);

  document.addEventListener("keydown", event => {
    if (replaying || !event.isTrusted || !(event.target as Element | null)?.closest?.(".cm-content")) return;
    const modifiers = modifiersFromEvent(event);
    if (event.key.length === 1 && modifiers.length === 0) return;
    sendTimeline({ at: 0, sessionId, action: "editor.key", key: event.key, modifiers });
  }, true);

  let selectionTimer = 0;
  document.addEventListener("selectionchange", () => {
    if (replaying) return;
    clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(() => {
      const selection = getSelection();
      if (!selection?.anchorNode || !selection.focusNode) return;
      const from = editorOffset(selection.anchorNode, selection.anchorOffset);
      const to = editorOffset(selection.focusNode, selection.focusOffset);
      if (from == null || to == null) return;
      sendTimeline({ at: 0, sessionId, action: "editor.select", from, to });
    }, 40);
  });

  document.addEventListener("pointerup", event => {
    if (replaying || !event.isTrusted) return;
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button");
    if (button && !button.closest(".cm-content")) {
      const command = button.dataset.testid || button.getAttribute("aria-label") || button.title || button.textContent?.trim();
      if (command) sendTimeline({ at: 0, sessionId, action: "editor.toolbar", command });
      return;
    }
    const line = target.closest<HTMLElement>(".cm-line");
    const content = line?.closest<HTMLElement>(".cm-content");
    if (line && content) {
      const lines = [...content.querySelectorAll<HTMLElement>(".cm-line")];
      sendTimeline({ at: 0, sessionId, action: "editor.sourceClick", line: lines.indexOf(line) + 1, column: 0 });
    }
  }, true);

  document.addEventListener("wheel", event => {
    if (!replaying && event.isTrusted && (event.target as Element | null)?.closest?.(".cm-scroller")) {
      sendTimeline({ at: 0, sessionId, action: "editor.scroll", deltaY: event.deltaY });
    }
  }, { capture: true, passive: true });
}

document.addEventListener("adoclive:diagnostic", (event) => {
  sendDiagnostic((event as CustomEvent<EditorDiagnosticEvent>).detail);
});

window.addEventListener("error", event => sendDiagnostic({
  area: "editor",
  name: "window-error",
  phase: "error",
  timestamp: performance.now(),
  detail: { message: event.message, filename: event.filename, line: event.lineno },
}));

window.addEventListener("unhandledrejection", event => sendDiagnostic({
  area: "editor",
  name: "unhandled-rejection",
  phase: "error",
  timestamp: performance.now(),
  detail: { message: String(event.reason) },
}));

window.addEventListener("message", event => {
  if (connected || event.origin !== expectedOrigin.origin || event.source !== parent) return;
  const parsed = LabConnectSchema.safeParse(event.data);
  if (!parsed.success || parsed.data.sessionId !== sessionId || parsed.data.nonce !== nonce || event.ports.length !== 2) return;
  connected = true;
  port = event.ports[0];
  controlPort = event.ports[1];
  controlPort.addEventListener("message", controlEvent => {
    const request = LabControlRequestSchema.safeParse(controlEvent.data);
    if (!request.success || request.data.sessionId !== sessionId || request.data.nonce !== nonce) return;
    void performControl(request.data.payload).then(() => {
      const result: LabControlResult = {
        protocol: "adoclive.lab-control", version: 1, kind: "result", sessionId, nonce,
        actionId: request.data.actionId, ok: true,
      };
      controlPort?.postMessage(result);
    }, error => {
      const result: LabControlResult = {
        protocol: "adoclive.lab-control", version: 1, kind: "result", sessionId, nonce,
        actionId: request.data.actionId, ok: false, error: error instanceof Error ? error.message : String(error),
      };
      controlPort?.postMessage(result);
    });
  });
  controlPort.start();
  const transport = new MessagePortEditorTransport({
    sessionId,
    nonce,
    port,
    onProtocolError: error => sendDiagnostic({
      area: "transport",
      name: "protocol-error",
      phase: "error",
      timestamp: performance.now(),
      detail: { code: error.code, message: error.message },
    }),
  });
  globalThis.__ADOC_EDITOR_TRANSPORT__ = transport;
  installSemanticRecorder();
  const script = document.createElement("script");
  script.src = "/panel.js";
  script.addEventListener("error", () => fail("The production panel bundle failed to load."));
  document.head.appendChild(script);
}, { passive: true });

parent.postMessage({ type: "adoclive:lab-editor-ready", sessionId, nonce }, expectedOrigin.origin);

setTimeout(() => {
  if (!connected) fail("The controller did not complete the MessageChannel handshake.");
}, 10_000);
