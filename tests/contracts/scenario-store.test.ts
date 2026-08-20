import { describe, expect, it } from "vitest";
import { EditorRpcService } from "../../src/host/editor-rpc-service";
import { EDITOR_HOST_REQUEST_TYPES, type EditorHostPush } from "../../src/shared/editor-host-contracts";
import { getFixture, NOTE_IDS } from "../../test-lab/fixtures";
import { LabControllerStore } from "../../test-lab/controller/store";
import { migrateLabScenario, parseLabScenario, serializeLabScenario } from "../../test-lab/shared/scenario";

describe("scenario migrations and deterministic store", () => {
  it("round-trips V1 scenarios with byte-stable canonical JSON", () => {
    const source = getFixture("inline-sections");
    const first = serializeLabScenario(source);
    const second = serializeLabScenario(parseLabScenario(first));
    expect(second).toBe(first);
  });

  it("migrates the legacy pre-versioned shape and rejects future versions", () => {
    const migrated = migrateLabScenario({ id: "legacy", title: "Legacy", note: { id: NOTE_IDS.primary, title: "Legacy", body: "= Legacy" } });
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.sessions[0].selectedNoteId).toBe(NOTE_IDS.primary);
    expect(() => migrateLabScenario({ schemaVersion: 2 })).toThrow(/future/);
  });

  it("implements every request against the in-memory adapter", async () => {
    const store = new LabControllerStore(getFixture("inline-sections"));
    const service = new EditorRpcService(store.operations);
    const context = { sessionId: "editor-1", selectedNoteId: NOTE_IDS.primary };
    const requests: Record<string, unknown> = {
      ready: { type: "ready" }, saveNote: { type: "saveNote", noteId: NOTE_IDS.primary, body: "= Saved" },
      getNoteContent: { type: "getNoteContent", noteId: NOTE_IDS.primary }, renderAsciidoc: { type: "renderAsciidoc", source: "= Render" },
      requestResources: { type: "requestResources", resourceIds: [] }, openImageDialog: { type: "openImageDialog" }, openVideoDialog: { type: "openVideoDialog" }, openAudioDialog: { type: "openAudioDialog" },
      createResourceFromFile: { type: "createResourceFromFile", filePath: "/tmp/missing" }, createResourceFromBytes: { type: "createResourceFromBytes", fileName: "a.txt", mimeType: "text/plain", dataBase64: "YQ==" },
      searchNotes: { type: "searchNotes", query: "" }, getIncludeTargets: { type: "getIncludeTargets", fromNoteId: NOTE_IDS.primary, query: "" }, resolveXrefTarget: { type: "resolveXrefTarget", fromNoteId: NOTE_IDS.primary, target: "#first-section" },
      getNoteSections: { type: "getNoteSections", noteId: NOTE_IDS.primary }, navigateToNote: { type: "navigateToNote", noteId: NOTE_IDS.linked }, getTemplates: { type: "getTemplates" }, getTemplateContent: { type: "getTemplateContent", noteId: NOTE_IDS.template },
      markAsTemplate: { type: "markAsTemplate" }, removeTemplate: { type: "removeTemplate", noteId: NOTE_IDS.template }, getSpellcheckSettings: { type: "getSpellcheckSettings" }, getPersonalDictionary: { type: "getPersonalDictionary" }, addWordToPersonalDictionary: { type: "addWordToPersonalDictionary", word: "determinism" },
      getSnippets: { type: "getSnippets" }, addSnippet: { type: "addSnippet", name: "new", content: "body" }, updateSnippet: { type: "updateSnippet", id: "snippet-1", name: "warning-updated", content: "body" }, removeSnippet: { type: "removeSnippet", id: "snippet-1" },
      setFullscreenMode: { type: "setFullscreenMode", enabled: true }, convertMarkdownPaste: { type: "convertMarkdownPaste", markdown: "# Heading" },
    };
    expect(new Set(Object.keys(requests))).toEqual(new Set(EDITOR_HOST_REQUEST_TYPES));
    for (const type of EDITOR_HOST_REQUEST_TYPES) await expect(service.request(requests[type], context)).resolves.toBeDefined();
  });

  it("shares saves across sessions without same-handle echo by default", async () => {
    const store = new LabControllerStore(getFixture("inline-sections"));
    const first: EditorHostPush[] = [];
    const second: EditorHostPush[] = [];
    store.subscribe("editor-1", push => first.push(push));
    store.subscribe("editor-2", push => second.push(push));
    await store.operations.saveNote({ type: "saveNote", noteId: NOTE_IDS.primary, body: "= Shared" }, { sessionId: "editor-1" });
    expect(first).toHaveLength(0);
    expect(second).toMatchObject([{ type: "updateNote", value: { id: NOTE_IDS.primary, body: "= Shared" } }]);
    expect(store.scenario.notes.find(note => note.id === NOTE_IDS.primary)?.revision).toBe(2);
  });

  it("uses a logical deferred queue with explicit resolve/reject/reorder", async () => {
    const store = new LabControllerStore(getFixture("inline-sections"));
    const order: string[] = [];
    const one = store.scheduler.schedule("one", 10, () => order.push("one"));
    const two = store.scheduler.schedule("two", 10, () => order.push("two"));
    store.scheduler.reorder([two.taskId, one.taskId]);
    await store.scheduler.resolve(two.taskId);
    await store.scheduler.advance(10);
    await Promise.all([one, two]);
    expect(order).toEqual(["two", "one"]);
  });
});
