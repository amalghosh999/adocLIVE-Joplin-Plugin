import { EDITOR_HOST_REQUEST_TYPES, EditorHostPushSchema, type EditorHostPush } from "../../src/shared/editor-host-contracts";
import { fixtureLibrary, getFixture, NOTE_IDS } from "../fixtures";
import { parseLabScenario, serializeLabScenario, type LabScenarioV1, type LabTimelineEvent } from "../shared/scenario";
import { LabControlResultSchema, LabEditorReadySchema, type LabControlRequest } from "../shared/lab-protocol";
import type { LabDiagnosticEvent } from "../shared/lab-schemas";
import { LabSessionBridge } from "./session-bridge";
import { LabControllerStore } from "./store";

interface LabConfig {
  controllerOrigin: string;
  editorOrigin: string;
  allowRemote: boolean;
  artifactMode: boolean;
}

interface FrameSession {
  id: string;
  nonce: string;
  frame: HTMLIFrameElement;
  bridge?: LabSessionBridge;
  controlPort?: MessagePort;
  controlSequence: number;
}

interface LabControlApi {
  getState(): unknown;
  setFixture(id: string): Promise<void>;
  advance(milliseconds: number): Promise<void>;
  push(sessionId: string, push: EditorHostPush): void;
  reset(): Promise<void>;
  replay(): Promise<void>;
  mutateNote(noteId: string, body: string, title?: string): void;
  mutateResource(resourceId: string, patch: { dataUrl?: string; delayMs?: number; failure?: string | null }): void;
  setFileSelection(path: string | null): void;
}

declare global {
  interface Window {
    __ADOC_LAB__?: LabControlApi;
  }
}

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing dashboard element: ${id}`);
  return element as T;
};

let config: LabConfig;
let currentScenario = getFixture("inline-sections");
let initialScenario = structuredClone(currentScenario);
let store = new LabControllerStore(currentScenario);
let privateSession = false;
let recording = false;
let recordedTimeline: LabTimelineEvent[] = [];
const frames = new Map<string, FrameSession>();
const diagnostics: LabDiagnosticEvent[] = [];

async function loadConfig(): Promise<LabConfig> {
  const response = await fetch("/lab-config.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load lab configuration: ${response.status}`);
  return response.json();
}

function syncScenarioFromControls(): void {
  currentScenario.settings.editorTheme = byId<HTMLSelectElement>("theme").value;
  currentScenario.theme.name = currentScenario.settings.editorTheme;
  currentScenario.theme.hostDark = ["dark", "midnight", "high-contrast"].includes(currentScenario.settings.editorTheme);
  currentScenario.settings.compactSpacing = byId<HTMLInputElement>("compact").checked;
  currentScenario.settings.attributeAutocomplete = byId<HTMLInputElement>("attributes").checked;
  currentScenario.settings.spellCheck = byId<HTMLInputElement>("spellcheck").checked;
  currentScenario.settings.spellcheckMode = currentScenario.settings.spellCheck ? "nspell" : "native";
  currentScenario.faults.latencyMs = Number(byId<HTMLInputElement>("latency").value) || 0;
  currentScenario.faults.ordering = byId<HTMLSelectElement>("ordering").value as LabScenarioV1["faults"]["ordering"];
  currentScenario.faults.saveEcho = byId<HTMLSelectElement>("save-echo").value as LabScenarioV1["faults"]["saveEcho"];
  const failureType = byId<HTMLSelectElement>("failure-request").value;
  const failureMessage = byId<HTMLInputElement>("failure-message").value.trim();
  currentScenario.faults.failRequests = failureType && failureMessage ? { [failureType]: failureMessage } : {};
  currentScenario.faults.deferRequests = byId<HTMLInputElement>("manual-defer").checked && failureType ? [failureType] : [];
  currentScenario.faults.duplicateRequests = byId<HTMLInputElement>("duplicate-request").checked && failureType ? [failureType] : [];
}

function populateControls(): void {
  const fixture = byId<HTMLSelectElement>("fixture");
  fixture.replaceChildren(...fixtureLibrary.map(item => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.title} (${item.tags.join(", ")})`;
    return option;
  }));
  fixture.value = currentScenario.id;

  const requestSelect = byId<HTMLSelectElement>("failure-request");
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "No request fault";
  requestSelect.replaceChildren(empty, ...EDITOR_HOST_REQUEST_TYPES.map(type => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    return option;
  }));
}

function applyScenarioToControls(): void {
  byId<HTMLSelectElement>("fixture").value = fixtureLibrary.some(item => item.id === currentScenario.id) ? currentScenario.id : "";
  byId<HTMLSelectElement>("theme").value = currentScenario.settings.editorTheme;
  byId<HTMLInputElement>("compact").checked = currentScenario.settings.compactSpacing;
  byId<HTMLInputElement>("attributes").checked = currentScenario.settings.attributeAutocomplete;
  byId<HTMLInputElement>("spellcheck").checked = currentScenario.settings.spellCheck;
  byId<HTMLInputElement>("latency").value = String(currentScenario.faults.latencyMs);
  byId<HTMLSelectElement>("ordering").value = currentScenario.faults.ordering;
  byId<HTMLSelectElement>("save-echo").value = currentScenario.faults.saveEcho;
  const selectedFault = byId<HTMLSelectElement>("failure-request").value;
  byId<HTMLInputElement>("duplicate-request").checked = Boolean(selectedFault && currentScenario.faults.duplicateRequests.includes(selectedFault));
  const resources = byId<HTMLSelectElement>("resource-id");
  resources.replaceChildren(...currentScenario.resources.map(resource => {
    const option = document.createElement("option");
    option.value = resource.id;
    option.textContent = `${resource.title} (${resource.id})`;
    return option;
  }));
  byId<HTMLButtonElement>("mutate-resource").disabled = currentScenario.resources.length === 0;
  byId<HTMLElement>("private-banner").hidden = !privateSession;
  document.documentElement.dataset.privateSession = String(privateSession);
}

function frameUrl(sessionId: string, nonce: string): string {
  const url = new URL("/editor.html", config.editorOrigin);
  url.searchParams.set("session", sessionId);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("controllerOrigin", config.controllerOrigin);
  url.searchParams.set("diagnostics", "1");
  url.searchParams.set("private", privateSession ? "1" : "0");
  url.searchParams.set("theme", currentScenario.theme.hostDark ? "dark" : "light");
  url.searchParams.set("view", byId<HTMLSelectElement>("view-mode").value);
  url.searchParams.set("zoom", byId<HTMLInputElement>("zoom").value);
  url.searchParams.set("margin", byId<HTMLInputElement>("margin").value);
  url.searchParams.set("compact", String(currentScenario.settings.compactSpacing));
  const session = currentScenario.sessions.find(candidate => candidate.id === sessionId);
  url.searchParams.set("storage", JSON.stringify(session?.localStorage || {}));
  return url.toString();
}

function destroyFrames(): void {
  for (const session of frames.values()) {
    session.bridge?.close();
    session.controlPort?.close();
  }
  frames.clear();
  byId("editor-grid").replaceChildren();
}

async function createFrames(): Promise<void> {
  destroyFrames();
  const count = Number(byId<HTMLSelectElement>("session-count").value);
  const grid = byId("editor-grid");
  grid.dataset.sessions = String(count);
  const viewport = byId<HTMLSelectElement>("viewport").value.split("x").map(Number);
  grid.style.setProperty("--frame-width", `${viewport[0]}px`);
  grid.style.setProperty("--frame-height", `${viewport[1]}px`);
  const sourceSessions = currentScenario.sessions.slice(0, count);
  while (sourceSessions.length < count) {
    sourceSessions.push({ id: `editor-${sourceSessions.length + 1}`, selectedNoteId: currentScenario.notes[0].id, localStorage: {} });
  }
  for (const scenarioSession of sourceSessions) {
    const nonce = crypto.randomUUID().replace(/-/g, "");
    store.ensureSession(scenarioSession.id, scenarioSession.selectedNoteId);
    const shell = document.createElement("section");
    shell.className = "editor-frame-shell";
    const heading = document.createElement("h2");
    heading.textContent = `${scenarioSession.id} · ${currentScenario.notes.find(note => note.id === scenarioSession.selectedNoteId)?.title || scenarioSession.selectedNoteId}`;
    const frame = document.createElement("iframe");
    frame.title = `adocLIVE editor session ${scenarioSession.id}`;
    frame.dataset.sessionId = scenarioSession.id;
    frame.setAttribute("allow", "clipboard-read; clipboard-write");
    frame.src = frameUrl(scenarioSession.id, nonce);
    shell.append(heading, frame);
    grid.appendChild(shell);
    frames.set(scenarioSession.id, { id: scenarioSession.id, nonce, frame, controlSequence: 0 });
  }
  renderState();
}

function onDiagnostic(event: LabDiagnosticEvent): void {
  diagnostics.push(event);
  if (diagnostics.length > 1_000) diagnostics.shift();
  renderDiagnostics();
}

window.addEventListener("message", event => {
  if (!config || event.origin !== config.editorOrigin) return;
  const ready = LabEditorReadySchema.safeParse(event.data);
  if (!ready.success) return;
  const session = frames.get(ready.data.sessionId);
  if (!session || ready.data.nonce !== session.nonce || event.source !== session.frame.contentWindow || session.bridge) return;
  const channel = new MessageChannel();
  const controlChannel = new MessageChannel();
  session.controlPort = controlChannel.port1;
  session.controlPort.start();
  session.bridge = new LabSessionBridge({
    sessionId: session.id,
    nonce: session.nonce,
    port: channel.port1,
    store,
    onDiagnostic,
    onTimeline: record,
    onPendingChange: renderState,
  });
  session.frame.contentWindow!.postMessage({
    type: "adoclive:lab-connect",
    sessionId: session.id,
    nonce: session.nonce,
  }, config.editorOrigin, [channel.port2, controlChannel.port2]);
  renderState();
});

function renderDiagnostics(): void {
  const filter = byId<HTMLInputElement>("log-filter").value.toLocaleLowerCase();
  const visible = diagnostics
    .filter(event => !filter || `${event.sessionId} ${event.area} ${event.name} ${event.phase || ""}`.toLocaleLowerCase().includes(filter))
    .slice(-200);
  byId("diagnostics-log").textContent = visible.map(event =>
    `${event.sequence.toString().padStart(4, "0")} ${event.sessionId} ${event.area}.${event.name}${event.phase ? `:${event.phase}` : ""}${event.detail ? ` ${JSON.stringify(event.detail)}` : ""}`
  ).join("\n");
  const errorCount = diagnostics.filter(event => event.phase === "error").length;
  byId("error-count").textContent = String(errorCount);
}

function renderState(): void {
  const pending = store.scheduler.pending;
  const pendingList = byId("pending-list");
  pendingList.replaceChildren(...pending.map(task => {
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${task.id} @${task.dueAt} ${task.label}`;
    const resolve = document.createElement("button");
    resolve.type = "button";
    resolve.textContent = "Resolve";
    resolve.addEventListener("click", async () => {
      await store.scheduler.resolve(task.id);
      record({ at: store.scheduler.now, action: "request.resolve", requestId: task.id });
      renderState();
    });
    const reject = document.createElement("button");
    reject.type = "button";
    reject.textContent = "Reject";
    reject.addEventListener("click", () => {
      store.scheduler.reject(task.id, "Rejected from dashboard");
      record({ at: store.scheduler.now, action: "request.reject", requestId: task.id, message: "Rejected from dashboard" });
      renderState();
    });
    row.append(label, resolve, reject);
    return row;
  }));
  byId("logical-clock").textContent = String(store.scheduler.now);
  byId("session-status").textContent = `${frames.size} frame(s), ${[...frames.values()].filter(frame => frame.bridge).length} connected`;
  byId("store-log").textContent = store.events.slice(-200).map(event =>
    `${event.at.toString().padStart(5, "0")} ${event.category} ${event.sessionId || "host"} ${event.name}${event.detail ? ` ${JSON.stringify(event.detail)}` : ""}`
  ).join("\n");
}

function record(event: LabTimelineEvent): void {
  if (recording) recordedTimeline.push(event);
}

async function sendEditorAction(event: LabTimelineEvent): Promise<void> {
  const targetSession = event.sessionId || currentScenario.sessions[0]?.id || "editor-1";
  const deadline = performance.now() + currentScenario.stabilization.timeoutMs;
  let session = frames.get(targetSession);
  while (!session?.controlPort && performance.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
    session = frames.get(targetSession);
  }
  if (!session?.controlPort) throw new Error(`Editor control channel did not connect: ${targetSession}`);
  const actionId = `${targetSession}:action:${++session.controlSequence}`;
  const request: LabControlRequest = {
    protocol: "adoclive.lab-control",
    version: 1,
    kind: "action",
    sessionId: targetSession,
    nonce: session.nonce,
    actionId,
    payload: event,
  };
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      session!.controlPort!.removeEventListener("message", onMessage);
      reject(new Error(`Editor replay action timed out: ${event.action}`));
    }, currentScenario.stabilization.timeoutMs);
    const onMessage = (message: MessageEvent<unknown>) => {
      const result = LabControlResultSchema.safeParse(message.data);
      if (!result.success || result.data.actionId !== actionId || result.data.sessionId !== targetSession || result.data.nonce !== session!.nonce) return;
      clearTimeout(timeout);
      session!.controlPort!.removeEventListener("message", onMessage);
      if (result.data.ok) resolve();
      else reject(new Error(result.data.error || `Editor replay action failed: ${event.action}`));
    };
    session!.controlPort!.addEventListener("message", onMessage);
    session!.controlPort!.postMessage(request);
  });
}

async function resetLab(useInitial = true): Promise<void> {
  syncScenarioFromControls();
  if (useInitial && privateSession) {
    currentScenario = getFixture("inline-sections");
    initialScenario = structuredClone(currentScenario);
    privateSession = false;
  } else if (useInitial) {
    currentScenario = structuredClone(initialScenario);
  }
  store = new LabControllerStore(currentScenario);
  diagnostics.splice(0);
  recordedTimeline = [];
  applyScenarioToControls();
  await createFrames();
  renderDiagnostics();
}

async function setFixture(id: string): Promise<void> {
  currentScenario = getFixture(id);
  initialScenario = structuredClone(currentScenario);
  privateSession = false;
  store = new LabControllerStore(currentScenario);
  applyScenarioToControls();
  await createFrames();
}

async function advance(milliseconds: number): Promise<void> {
  await store.scheduler.advance(milliseconds);
  record({ at: store.scheduler.now, action: "clock.advance", milliseconds });
  renderState();
}

async function replay(): Promise<void> {
  const timeline = recordedTimeline.length ? [...recordedTimeline] : [...currentScenario.timeline];
  await resetLab(false);
  for (const event of timeline) {
    if (event.action.startsWith("editor.")) await sendEditorAction(event);
    if (event.action === "clock.advance") await advance(event.milliseconds);
    if (event.action === "host.navigate" && event.sessionId) store.navigate(event.sessionId, event.noteId);
    if (event.action === "host.mutate") store.mutateNote(event.noteId, event.body, event.title);
    if (event.action === "host.push" && event.sessionId) store.push(event.sessionId, event.push);
    if (event.action === "request.resolve") await store.scheduler.resolve(event.requestId);
    if (event.action === "request.reject") store.scheduler.reject(event.requestId, event.message);
    if (event.action === "request.reorder") store.scheduler.reorder(event.requestIds);
  }
  renderState();
}

async function importFile(file: File): Promise<void> {
  if (file.size > 10 * 1024 * 1024) throw new Error("Local Test Lab imports are limited to 10 MB");
  const text = await file.text();
  if (/\.json$/i.test(file.name)) {
    currentScenario = parseLabScenario(text);
  } else {
    currentScenario = getFixture("inline-sections");
    currentScenario.id = `private-${crypto.randomUUID()}`;
    currentScenario.title = file.name;
    currentScenario.description = "Private local import; persistent artifacts are disabled.";
    currentScenario.notes[0].title = file.name;
    currentScenario.notes[0].body = text;
    currentScenario.tags = ["private-import"];
  }
  privateSession = true;
  initialScenario = structuredClone(currentScenario);
  store = new LabControllerStore(currentScenario);
  applyScenarioToControls();
  await createFrames();
}

function exportScenario(): void {
  if (privateSession && !confirm("This private scenario may contain note text and resource metadata. Persist an export on this computer?")) return;
  const scenario = store.scenario;
  scenario.timeline = recordedTimeline.length ? structuredClone(recordedTimeline) : scenario.timeline;
  const blob = new Blob([serializeLabScenario(scenario)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${scenario.id.replace(/[^a-z0-9_-]+/gi, "-")}.scenario.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function wireControls(): void {
  byId<HTMLSelectElement>("fixture").addEventListener("change", event => void setFixture((event.target as HTMLSelectElement).value));
  byId("apply-layout").addEventListener("click", async () => {
    syncScenarioFromControls();
    store = new LabControllerStore(currentScenario);
    await createFrames();
  });
  byId("reset").addEventListener("click", () => void resetLab());
  byId("advance-clock").addEventListener("click", () => void advance(Number(byId<HTMLInputElement>("clock-step").value) || 0));
  byId("resolve-all").addEventListener("click", async () => {
    for (const task of [...store.scheduler.pending]) await store.scheduler.resolve(task.id);
    renderState();
  });
  byId("reverse-pending").addEventListener("click", () => {
    const ids = store.scheduler.pending.map(task => task.id).reverse();
    store.scheduler.reorder(ids);
    record({ at: store.scheduler.now, action: "request.reorder", requestIds: ids });
    renderState();
  });
  byId("cancel-all").addEventListener("click", () => {
    for (const task of [...store.scheduler.pending]) store.scheduler.reject(task.id, "Cancelled from dashboard");
    renderState();
  });
  byId("external-update").addEventListener("click", () => {
    const body = byId<HTMLTextAreaElement>("mutation-body").value;
    store.mutateNote(NOTE_IDS.primary, body || `= External update\n\nLogical time ${store.scheduler.now}`);
    record({ at: store.scheduler.now, action: "host.mutate", noteId: NOTE_IDS.primary, body });
    renderState();
  });
  byId("push-theme").addEventListener("click", () => {
    const isDark = !currentScenario.theme.hostDark;
    currentScenario.theme.hostDark = isDark;
    const push: EditorHostPush = { type: "updateEditorTheme", editorTheme: isDark ? "dark" : "light", mermaidThemeVariables: "{}", isDark };
    store.pushAll(push);
    for (const sessionId of frames.keys()) record({ at: store.scheduler.now, sessionId, action: "host.push", push });
  });
  byId("mutate-resource").addEventListener("click", () => {
    const resourceId = byId<HTMLSelectElement>("resource-id").value;
    if (!resourceId) return;
    const failure = byId<HTMLInputElement>("resource-failure").value.trim();
    const delayMs = Math.max(0, Number(byId<HTMLInputElement>("resource-delay").value) || 0);
    store.mutateResource(resourceId, { delayMs, failure: failure || null });
    currentScenario = store.scenario;
    renderState();
  });
  byId("apply-file-selection").addEventListener("click", () => {
    store.setFileSelection(byId<HTMLInputElement>("file-selection").value || null);
    renderState();
  });
  byId("record").addEventListener("click", event => {
    recording = !recording;
    (event.currentTarget as HTMLButtonElement).textContent = recording ? "Stop recording" : "Record";
    if (recording) recordedTimeline = [];
  });
  byId("replay").addEventListener("click", () => void replay());
  byId("export").addEventListener("click", exportScenario);
  byId<HTMLInputElement>("import-file").addEventListener("change", event => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void importFile(file);
  });
  byId<HTMLInputElement>("log-filter").addEventListener("input", renderDiagnostics);
  byId("clear-logs").addEventListener("click", () => {
    diagnostics.splice(0);
    store.events.splice(0);
    renderDiagnostics();
    renderState();
  });
}

async function main(): Promise<void> {
  config = await loadConfig();
  if (config.allowRemote) byId("remote-banner").hidden = false;
  if (config.artifactMode) byId("artifact-badge").hidden = false;
  populateControls();
  applyScenarioToControls();
  wireControls();
  window.__ADOC_LAB__ = {
    getState: () => ({ scenario: store.scenario, events: structuredClone(store.events), diagnostics: structuredClone(diagnostics), pending: structuredClone(store.scheduler.pending), privateSession }),
    setFixture,
    advance,
    push: (sessionId, push) => store.push(sessionId, EditorHostPushSchema.parse(push)),
    reset: () => resetLab(),
    replay,
    mutateNote: (noteId, body, title) => store.mutateNote(noteId, body, title),
    mutateResource: (resourceId, patch) => store.mutateResource(resourceId, patch),
    setFileSelection: path => store.setFileSelection(path),
  };
  await createFrames();
}

void main().catch(error => {
  byId("fatal-error").hidden = false;
  byId("fatal-error").textContent = error instanceof Error ? error.stack || error.message : String(error);
});
