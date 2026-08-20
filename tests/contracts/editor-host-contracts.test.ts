import { describe, expect, it } from "vitest";
import {
  EDITOR_HOST_REQUEST_TYPES,
  EditorHostPushSchema,
  EditorHostRequestSchema,
  EditorHostResponseSchemas,
  EditorRequestEnvelopeSchema,
  parseEditorHostResponse,
  type EditorHostRequest,
  type EditorHostRequestType,
} from "../../src/shared/editor-host-contracts";
import { EditorRpcService, type EditorHostOperations } from "../../src/host/editor-rpc-service";
import { createEditorHostApplication, createEditorHostPorts, EDITOR_HOST_CAPABILITY_REQUESTS } from "../../src/host/editor-host-application";

const requests: Record<EditorHostRequestType, EditorHostRequest> = {
  ready: { type: "ready" },
  saveNote: { type: "saveNote", noteId: "note", body: "body" },
  getNoteContent: { type: "getNoteContent", noteId: "note" },
  renderAsciidoc: { type: "renderAsciidoc", source: "= Test" },
  requestResources: { type: "requestResources", resourceIds: ["resource"] },
  openImageDialog: { type: "openImageDialog" },
  openVideoDialog: { type: "openVideoDialog" },
  openAudioDialog: { type: "openAudioDialog" },
  createResourceFromFile: { type: "createResourceFromFile", filePath: "/tmp/test.png" },
  createResourceFromBytes: { type: "createResourceFromBytes", fileName: "test.png", mimeType: "image/png", dataBase64: "AA==" },
  searchNotes: { type: "searchNotes", query: "test", mode: "search", fromNoteId: "note" },
  getIncludeTargets: { type: "getIncludeTargets", fromNoteId: "note", query: "" },
  resolveXrefTarget: { type: "resolveXrefTarget", fromNoteId: "note", target: "#section" },
  getNoteSections: { type: "getNoteSections", noteId: "note" },
  navigateToNote: { type: "navigateToNote", noteId: "note" },
  getTemplates: { type: "getTemplates" },
  getTemplateContent: { type: "getTemplateContent", noteId: "note" },
  markAsTemplate: { type: "markAsTemplate" },
  removeTemplate: { type: "removeTemplate", noteId: "note" },
  getSpellcheckSettings: { type: "getSpellcheckSettings" },
  getPersonalDictionary: { type: "getPersonalDictionary" },
  addWordToPersonalDictionary: { type: "addWordToPersonalDictionary", word: "adocLIVE" },
  getSnippets: { type: "getSnippets" },
  addSnippet: { type: "addSnippet", name: "name", content: "content" },
  updateSnippet: { type: "updateSnippet", id: "snippet", name: "name", content: "content" },
  removeSnippet: { type: "removeSnippet", id: "snippet" },
  setFullscreenMode: { type: "setFullscreenMode", enabled: true },
  convertMarkdownPaste: { type: "convertMarkdownPaste", markdown: "# title" },
};

const responses: Record<EditorHostRequestType, unknown> = {
  ready: { isDark: false },
  saveNote: { status: "saved" },
  getNoteContent: { id: "note", title: "Title", body: "body" },
  renderAsciidoc: { html: "<p>test</p>" },
  requestResources: { resources: [{ id: "resource", dataUrl: "data:text/plain,test" }] },
  openImageDialog: { filePath: null },
  openVideoDialog: { filePath: null },
  openAudioDialog: { filePath: null },
  createResourceFromFile: { resourceId: "resource", title: "test.png" },
  createResourceFromBytes: { resourceId: "resource", title: "test.png" },
  searchNotes: { notes: [{ id: "note", title: "Title", isAsciiDoc: true }] },
  getIncludeTargets: { targets: [{ id: "note", title: "Title", displayPath: "Note: Title", insertText: "joplin:note" }] },
  resolveXrefTarget: { target: null },
  getNoteSections: { sections: [{ id: "section", title: "Section", level: 1, lineNumber: 1 }] },
  navigateToNote: { status: "ok" },
  getTemplates: { templates: [{ id: "note", title: "Title" }] },
  getTemplateContent: { content: "body" },
  markAsTemplate: { status: "ok" },
  removeTemplate: { status: "ok" },
  getSpellcheckSettings: { pluralSingular: true, mode: "native" },
  getPersonalDictionary: { words: ["adocLIVE"] },
  addWordToPersonalDictionary: { status: "ok" },
  getSnippets: { snippets: [{ id: "snippet", name: "name", content: "content" }] },
  addSnippet: { status: "ok", snippet: { id: "snippet", name: "name", content: "content" } },
  updateSnippet: { status: "ok" },
  removeSnippet: { status: "ok" },
  setFullscreenMode: { status: "ok" },
  convertMarkdownPaste: { asciidoc: "= title" },
};

describe("editor-host protocol", () => {
  it("contains exactly the 28 reviewed request variants", () => {
    expect(EDITOR_HOST_REQUEST_TYPES).toHaveLength(28);
    expect(new Set(EDITOR_HOST_REQUEST_TYPES)).toEqual(new Set(Object.keys(requests)));
  });

  it.each(EDITOR_HOST_REQUEST_TYPES)("accepts the %s request and its message-specific response", type => {
    expect(EditorHostRequestSchema.parse(requests[type])).toEqual(requests[type]);
    expect(parseEditorHostResponse(type, responses[type])).toEqual(EditorHostResponseSchemas[type].parse(responses[type]));
  });

  it("rejects missing fields, unknown requests, unknown versions, and response mismatches", () => {
    expect(EditorHostRequestSchema.safeParse({ type: "saveNote" }).success).toBe(false);
    expect(EditorHostRequestSchema.safeParse({ type: "notARequest" }).success).toBe(false);
    expect(EditorRequestEnvelopeSchema.safeParse({
      protocol: "adoclive.editor-host",
      version: 2,
      kind: "request",
      sessionId: "editor-1",
      nonce: "0123456789abcdef",
      requestId: "1",
      payload: { type: "ready" },
    }).success).toBe(false);
    expect(() => parseEditorHostResponse("saveNote", { status: "maybe" })).toThrow();
  });

  it("validates all six consumed host pushes", () => {
    const pushes = [
      { type: "updateNote", value: { id: "note", body: "body" } },
      { type: "updateTheme", value: "dark" },
      { type: "updateEditorTheme", editorTheme: "dark", mermaidThemeVariables: "{}", isDark: true },
      { type: "updateCompactSpacing", value: true },
      { type: "updateAttributeAutocomplete", enabled: false },
      { type: "updateSpellCheck", enabled: true, mode: "nspell" },
    ];
    expect(pushes.map(push => EditorHostPushSchema.parse(push).type)).toEqual([
      "updateNote", "updateTheme", "updateEditorTheme", "updateCompactSpacing", "updateAttributeAutocomplete", "updateSpellCheck",
    ]);
  });

  it("routes through the shared RPC service and validates adapter output", async () => {
    const operations = Object.fromEntries(EDITOR_HOST_REQUEST_TYPES.map(type => [
      type,
      () => responses[type],
    ])) as EditorHostOperations;
    const service = new EditorRpcService(operations);
    for (const type of EDITOR_HOST_REQUEST_TYPES) {
      await expect(service.request(requests[type], { sessionId: "test" })).resolves.toEqual(EditorHostResponseSchemas[type].parse(responses[type]));
    }
    await expect(service.request({ type: "unknown" }, { sessionId: "test" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("assigns every request to one explicit host capability port", () => {
    const assigned = Object.values(EDITOR_HOST_CAPABILITY_REQUESTS).flat();
    expect(assigned).toHaveLength(EDITOR_HOST_REQUEST_TYPES.length);
    expect(new Set(assigned)).toEqual(new Set(EDITOR_HOST_REQUEST_TYPES));
    const operations = Object.fromEntries(EDITOR_HOST_REQUEST_TYPES.map(type => [type, () => responses[type]])) as EditorHostOperations;
    const rebuilt = createEditorHostApplication(createEditorHostPorts(operations));
    expect(new Set(Object.keys(rebuilt))).toEqual(new Set(EDITOR_HOST_REQUEST_TYPES));
  });
});
