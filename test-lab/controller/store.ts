import { collectDocumentSections, findSectionLineNumber } from "../../src/shared/asciidoc-sections";
import { renderAsciiDocHtml } from "../../src/host/rendering";
import { convertMarkdownToAsciiDoc } from "../../src/host/markdown-conversion";
import type { EditorHostOperations, EditorSessionContext } from "../../src/host/editor-rpc-service";
import { createEditorHostApplication, createEditorHostPorts, type EditorHostClockPort, type EditorHostIdPort } from "../../src/host/editor-host-application";
import { expandEditorIncludesSync, type ResolvedEditorInclude } from "../../src/host/include-expansion";
import type { EditorHostPush, EditorHostRequestType } from "../../src/shared/editor-host-contracts";
import type { LabScenarioV1 } from "../shared/scenario";
import { LogicalScheduler } from "../shared/scheduler";

const SENTINEL_REGEX = /\n?```asciidoc-settings\n([\s\S]*?)\n```\s*$/;

function stripSentinel(body: string): { content: string; settings: Record<string, unknown> } {
  const match = body.match(SENTINEL_REGEX);
  if (!match) return { content: body, settings: {} };
  try {
    return { content: body.replace(SENTINEL_REGEX, "").trimEnd(), settings: JSON.parse(match[1] || "{}") };
  } catch {
    return { content: body.replace(SENTINEL_REGEX, "").trimEnd(), settings: {} };
  }
}

function decodeTextDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return "";
  const metadata = dataUrl.slice(0, comma);
  const encoded = dataUrl.slice(comma + 1);
  if (metadata.includes(";base64")) {
    const binary = atob(encoded);
    return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
  }
  return decodeURIComponent(encoded);
}

async function loadFixtureResource(path: string, mime: string): Promise<string> {
  if (typeof location === "undefined") throw new Error(`Fixture-path resources require the browser laboratory: ${path}`);
  const response = await fetch(new URL(`/${path}`, location.origin), { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load fixture resource ${path}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mime || response.headers.get("content-type") || "application/octet-stream"};base64,${btoa(binary)}`;
}

interface SessionState {
  selectedNoteId: string;
  pushSequence: number;
  listeners: Set<(push: EditorHostPush) => void>;
  destroyed: boolean;
}

export interface LabStoreEvent {
  at: number;
  category: "rpc" | "push" | "store" | "error";
  name: string;
  sessionId?: string;
  detail?: Record<string, unknown>;
}

export class LabControllerStore {
  readonly scheduler = new LogicalScheduler();
  readonly events: LabStoreEvent[] = [];
  readonly operations: EditorHostOperations;
  private scenarioValue: LabScenarioV1;
  private readonly sessions = new Map<string, SessionState>();
  private idSequence = 0;
  private fileSelection: string | null = null;
  private readonly clock: EditorHostClockPort = { now: () => this.scheduler.now };
  private readonly ids: EditorHostIdPort = { next: prefix => `${prefix}${String(++this.idSequence).padStart(31, "0")}` };

  constructor(scenario: LabScenarioV1) {
    this.scenarioValue = structuredClone(scenario);
    this.restoreSessions();
    const adapterOperations = this.createOperations();
    this.operations = createEditorHostApplication(createEditorHostPorts(adapterOperations));
  }

  get scenario(): LabScenarioV1 {
    return structuredClone(this.scenarioValue);
  }

  get faultPolicy(): LabScenarioV1["faults"] {
    return this.scenarioValue.faults;
  }

  set faultPolicy(policy: LabScenarioV1["faults"]) {
    this.scenarioValue.faults = structuredClone(policy);
    this.record("store", "fault-policy", undefined, policy);
  }

  reset(scenario: LabScenarioV1 = this.scenarioValue): void {
    this.scheduler.reset();
    this.scenarioValue = structuredClone(scenario);
    this.sessions.clear();
    this.events.splice(0);
    this.idSequence = 0;
    this.fileSelection = null;
    this.restoreSessions();
  }

  ensureSession(sessionId: string, selectedNoteId?: string): void {
    const current = this.sessions.get(sessionId);
    if (current) {
      if (selectedNoteId) current.selectedNoteId = selectedNoteId;
      current.destroyed = false;
      return;
    }
    this.sessions.set(sessionId, {
      selectedNoteId: selectedNoteId || this.scenarioValue.notes[0].id,
      pushSequence: 0,
      listeners: new Set(),
      destroyed: false,
    });
  }

  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.destroyed = true;
    session.listeners.clear();
    this.record("store", "session-destroyed", sessionId);
  }

  subscribe(sessionId: string, listener: (push: EditorHostPush) => void): () => void {
    this.ensureSession(sessionId);
    const session = this.sessions.get(sessionId)!;
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }

  push(sessionId: string, push: EditorHostPush): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.destroyed) return;
    if (push.type === "updateNote") session.selectedNoteId = push.value.id;
    session.pushSequence += 1;
    this.record("push", push.type, sessionId, { sequence: session.pushSequence });
    for (const listener of session.listeners) listener(push);
  }

  pushAll(push: EditorHostPush, exceptSessionId?: string): void {
    for (const sessionId of this.sessions.keys()) {
      if (sessionId !== exceptSessionId) this.push(sessionId, push);
    }
  }

  mutateNote(noteId: string, body: string, title?: string): void {
    const note = this.requireNote(noteId);
    note.body = body;
    if (title != null) note.title = title;
    note.revision += 1;
    note.updatedAt = this.clock.now();
    this.record("store", "note-mutated", undefined, { noteId, revision: note.revision });
    if (this.faultPolicy.notifyExternalMutations) {
      this.pushAll({ type: "updateNote", value: { id: note.id, body: note.body, html: this.render(note.body, note.id) } });
    }
  }

  navigate(sessionId: string, noteId: string): void {
    const note = this.requireNote(noteId);
    this.ensureSession(sessionId, noteId);
    this.push(sessionId, { type: "updateNote", value: { id: note.id, body: note.body, html: this.render(note.body, note.id) } });
  }

  setFileSelection(path: string | null): void {
    this.fileSelection = path;
    this.record("store", "file-selection", undefined, { selected: path != null });
  }

  mutateResource(resourceId: string, patch: { dataUrl?: string; delayMs?: number; failure?: string | null }): void {
    const resource = this.scenarioValue.resources.find(candidate => candidate.id === resourceId);
    if (!resource) throw new Error(`Unknown resource: ${resourceId}`);
    if (patch.dataUrl != null) resource.dataUrl = patch.dataUrl;
    if (patch.delayMs != null) resource.delayMs = Math.max(0, Math.floor(patch.delayMs));
    if (patch.failure === null) delete resource.failure;
    else if (patch.failure != null) resource.failure = patch.failure;
    this.record("store", "resource-mutated", undefined, {
      resourceId,
      delayMs: resource.delayMs,
      failed: Boolean(resource.failure),
    });
  }

  private createOperations(): EditorHostOperations {
    return {
      ready: (_request, context) => {
        const session = this.session(context);
        const note = this.requireNote(session.selectedNoteId);
        return {
          isDark: this.scenarioValue.theme.hostDark,
          compactSpacing: this.scenarioValue.settings.compactSpacing,
          attributeAutocomplete: this.scenarioValue.settings.attributeAutocomplete,
          spellCheck: this.scenarioValue.settings.spellCheck,
          spellcheckMode: this.scenarioValue.settings.spellcheckMode,
          editorTheme: this.scenarioValue.settings.editorTheme,
          mermaidThemeVariables: this.scenarioValue.settings.mermaidThemeVariables,
          note: { id: note.id, body: note.body, html: this.render(note.body, note.id) },
        };
      },
      saveNote: (request, context) => {
        const session = this.session(context);
        const noteId = request.noteId || session.selectedNoteId;
        const note = this.requireNote(noteId);
        note.body = request.body;
        note.revision += 1;
        note.updatedAt = this.clock.now();
        session.selectedNoteId = noteId;
        const push: EditorHostPush = { type: "updateNote", value: { id: note.id, body: note.body, html: this.render(note.body, note.id) } };
        if (this.faultPolicy.saveEcho === "same" || this.faultPolicy.saveEcho === "all") this.push(context.sessionId, push);
        if (this.faultPolicy.saveEcho === "others" || this.faultPolicy.saveEcho === "all") this.pushAll(push, context.sessionId);
        this.record("store", "note-saved", context.sessionId, { noteId, revision: note.revision });
        return { status: "saved" };
      },
      getNoteContent: request => {
        const note = this.requireNote(request.noteId);
        return { id: note.id, title: note.title, body: stripSentinel(note.body).content };
      },
      renderAsciidoc: (request, context) => ({ html: this.render(request.source, this.session(context).selectedNoteId) }),
      requestResources: async request => {
        const resources: Array<{ id: string; dataUrl: string }> = [];
        for (const resourceId of request.resourceIds) {
          const resource = this.scenarioValue.resources.find(candidate => candidate.id === resourceId);
          if (!resource || resource.failure) continue;
          if (resource.delayMs > 0) await this.scheduler.schedule(`resource:${resourceId}`, resource.delayMs, () => undefined);
          const dataUrl = resource.dataUrl || (resource.fixturePath ? await loadFixtureResource(resource.fixturePath, resource.mime) : "");
          if (dataUrl) resources.push({ id: resource.id, dataUrl });
        }
        return { resources };
      },
      openImageDialog: () => ({ filePath: this.fileSelection }),
      openVideoDialog: () => ({ filePath: this.fileSelection }),
      openAudioDialog: () => ({ filePath: this.fileSelection }),
      createResourceFromFile: request => ({ resourceId: "", title: "", error: `Browser lab cannot read host path: ${request.filePath}` }),
      createResourceFromBytes: request => {
        const resourceId = this.nextId("3");
        const dataUrl = `data:${request.mimeType || "application/octet-stream"};base64,${request.dataBase64}`;
        this.scenarioValue.resources.push({ id: resourceId, title: request.fileName, mime: request.mimeType, dataUrl, delayMs: 0 });
        return { resourceId, title: request.fileName, dataUrl };
      },
      searchNotes: request => {
        const query = request.query.trim().toLocaleLowerCase();
        const notes = this.scenarioValue.notes
          .filter(note => !query || note.title.toLocaleLowerCase().includes(query) || note.body.toLocaleLowerCase().includes(query))
          .slice(0, 20)
          .map(note => ({ id: note.id, title: note.title, isAsciiDoc: true }));
        return { notes };
      },
      getIncludeTargets: request => {
        const query = request.query.replace(/^(joplin|resource|joplin-resource):/i, "").toLocaleLowerCase();
        const noteTargets = this.scenarioValue.notes
          .filter(note => note.id !== request.fromNoteId)
          .filter(note => !query || note.title.toLocaleLowerCase().includes(query) || note.id.includes(query))
          .map(note => ({ id: note.id, title: note.title, displayPath: `Note: ${note.title}`, insertText: `joplin:${note.id}` }));
        const resourceTargets = this.scenarioValue.resources
          .filter(resource => resource.mime.startsWith("text/") || /\.(adoc|txt|csv|json)$/i.test(resource.title))
          .filter(resource => !query || resource.title.toLocaleLowerCase().includes(query) || resource.id.includes(query))
          .map(resource => ({ id: resource.id, title: resource.title, displayPath: `Resource: ${resource.title}`, insertText: `resource:${resource.id}` }));
        return { targets: [...noteTargets, ...resourceTargets].slice(0, 40) };
      },
      resolveXrefTarget: request => ({ target: this.resolveXref(request.fromNoteId, request.target) }),
      getNoteSections: request => {
        const note = this.requireNote(request.noteId);
        return { sections: collectDocumentSections(stripSentinel(note.body).content).map(section => ({
          id: section.anchor,
          title: section.title,
          level: section.level,
          lineNumber: section.lineNumber,
          ...(section.reftext ? { reftext: section.reftext } : {}),
        })) };
      },
      navigateToNote: (request, context) => {
        this.navigate(context.sessionId, request.noteId);
        return { status: "ok" };
      },
      getTemplates: () => ({ templates: this.scenarioValue.templates.map(entry => {
        const note = this.requireNote(entry.noteId);
        return { id: note.id, title: note.title };
      }) }),
      getTemplateContent: request => ({ content: stripSentinel(this.requireNote(request.noteId).body).content }),
      markAsTemplate: (_request, context) => {
        const noteId = this.session(context).selectedNoteId;
        if (!this.scenarioValue.templates.some(entry => entry.noteId === noteId)) this.scenarioValue.templates.push({ noteId });
        return { status: "ok" };
      },
      removeTemplate: request => {
        this.scenarioValue.templates = this.scenarioValue.templates.filter(entry => entry.noteId !== request.noteId);
        return { status: "ok" };
      },
      getSpellcheckSettings: () => ({ pluralSingular: true, mode: this.scenarioValue.settings.spellcheckMode }),
      getPersonalDictionary: () => ({ words: [...this.scenarioValue.dictionary] }),
      addWordToPersonalDictionary: request => {
        if (!this.scenarioValue.dictionary.includes(request.word)) this.scenarioValue.dictionary.push(request.word);
        this.scenarioValue.dictionary.sort();
        return { status: "ok" };
      },
      getSnippets: () => ({ snippets: structuredClone(this.scenarioValue.snippets) }),
      addSnippet: request => {
        if (this.scenarioValue.snippets.some(snippet => snippet.name === request.name)) return { status: "error", error: "A snippet with this name already exists" };
        const snippet = { id: `snippet-${++this.idSequence}`, name: request.name, content: request.content };
        this.scenarioValue.snippets.push(snippet);
        this.scenarioValue.snippets.sort((left, right) => left.name.localeCompare(right.name));
        return { status: "ok", snippet };
      },
      updateSnippet: request => {
        const snippet = this.scenarioValue.snippets.find(candidate => candidate.id === request.id);
        if (!snippet) return { status: "error", error: "Snippet not found" };
        if (this.scenarioValue.snippets.some(candidate => candidate.id !== request.id && candidate.name === request.name)) {
          return { status: "error", error: "A snippet with this name already exists" };
        }
        snippet.name = request.name;
        snippet.content = request.content;
        this.scenarioValue.snippets.sort((left, right) => left.name.localeCompare(right.name));
        return { status: "ok" };
      },
      removeSnippet: request => {
        this.scenarioValue.snippets = this.scenarioValue.snippets.filter(snippet => snippet.id !== request.id);
        return { status: "ok" };
      },
      setFullscreenMode: () => ({ status: "ok" }),
      convertMarkdownPaste: request => ({ asciidoc: convertMarkdownToAsciiDoc(request.markdown) }),
    };
  }

  private restoreSessions(): void {
    for (const session of this.scenarioValue.sessions) this.ensureSession(session.id, session.selectedNoteId);
  }

  private session(context: EditorSessionContext): SessionState {
    this.ensureSession(context.sessionId, context.selectedNoteId);
    const session = this.sessions.get(context.sessionId)!;
    if (session.destroyed || context.signal?.aborted) throw new Error(`Session is closed: ${context.sessionId}`);
    return session;
  }

  private requireNote(noteId: string) {
    const note = this.scenarioValue.notes.find(candidate => candidate.id === noteId);
    if (!note) throw new Error(`Unknown note: ${noteId}`);
    return note;
  }

  private render(body: string, noteId: string): string {
    const { content, settings } = stripSentinel(body);
    const expanded = expandEditorIncludesSync(content, noteId, (fromDocumentId, target) => this.resolveInclude(fromDocumentId, target), new Set([`note:${noteId}`]));
    return renderAsciiDocHtml(expanded, settings);
  }

  private resolveInclude(fromNoteId: string, rawTarget: string): ResolvedEditorInclude | null {
    const resourceTarget = /^(?:resource|joplin-resource):/i.test(rawTarget) || /^:\/?/i.test(rawTarget);
    const target = rawTarget.trim()
      .replace(/^joplin:/i, "")
      .replace(/^(resource|joplin-resource):/i, "")
      .replace(/^:\/?/, "");
    if (!target) return null;
    if (!resourceTarget) {
      const note = target === "."
        ? this.scenarioValue.notes.find(candidate => candidate.id === fromNoteId)
        : this.scenarioValue.notes.find(candidate => candidate.id === target)
          ?? this.scenarioValue.notes.find(candidate => candidate.title.toLocaleLowerCase() === target.toLocaleLowerCase());
      if (note) return {
        id: note.id,
        key: `note:${note.id}`,
        title: note.title,
        content: stripSentinel(note.body).content,
        asciidoc: true,
      };
    }
    const resource = this.scenarioValue.resources.find(candidate => candidate.id === target);
    if (!resource?.dataUrl || resource.failure) return null;
    return {
      id: resource.id,
      key: `resource:${resource.id}`,
      title: resource.title,
      content: decodeTextDataUrl(resource.dataUrl),
      asciidoc: resource.mime === "text/asciidoc" || /\.(?:adoc|asciidoc)$/i.test(resource.title),
    };
  }

  private resolveXref(fromNoteId: string, rawTarget: string) {
    const target = rawTarget.trim().replace(/^xref:/, "").replace(/\[[\s\S]*\]$/, "");
    let [noteRef, sectionAnchor] = target.split("#", 2);
    if (target.startsWith("#")) {
      noteRef = fromNoteId;
      sectionAnchor = target.slice(1);
    }
    if (!noteRef || !/^[a-f0-9]{32}$/i.test(noteRef)) noteRef = fromNoteId;
    const note = this.scenarioValue.notes.find(candidate => candidate.id === noteRef)
      ?? this.scenarioValue.notes.find(candidate => candidate.title.toLocaleLowerCase() === target.toLocaleLowerCase());
    if (!note) return null;
    const targetLine = sectionAnchor ? findSectionLineNumber(stripSentinel(note.body).content, sectionAnchor) : undefined;
    return { noteId: note.id, title: note.title, ...(sectionAnchor ? { sectionAnchor } : {}), ...(targetLine ? { targetLine } : {}) };
  }

  private nextId(prefix: string): string {
    return this.ids.next(prefix);
  }

  private record(category: LabStoreEvent["category"], name: string, sessionId?: string, detail?: Record<string, unknown>): void {
    this.events.push({ at: this.clock.now(), category, name, sessionId, detail });
  }

  recordRequest(type: EditorHostRequestType, sessionId: string, detail?: Record<string, unknown>): void {
    this.record("rpc", type, sessionId, detail);
  }

  recordError(name: string, sessionId: string, error: unknown): void {
    this.record("error", name, sessionId, { message: error instanceof Error ? error.message : String(error) });
  }
}
