import { describe, expect, it } from "vitest";
import { EDITOR_SCRIPTS, EditorHandleRegistry, EditorHandleSession, type JoplinEditorViewPort } from "../../src/host/editor-handle";

type Handle = { id: string };

class FakeEditors implements JoplinEditorViewPort<Handle> {
  readonly html = new Map<string, string>();
  readonly scripts = new Map<string, string[]>();
  readonly updates = new Map<string, (update: unknown) => Promise<void>>();
  readonly messages = new Map<string, (message: unknown) => Promise<unknown>>();
  readonly pushes: Array<{ handle: string; message: unknown }> = [];
  readonly saves: Array<{ handle: string; noteId: string; body: string }> = [];

  async setHtml(handle: Handle, html: string) { this.html.set(handle.id, html); }
  async addScript(handle: Handle, script: string) { this.scripts.set(handle.id, [...(this.scripts.get(handle.id) || []), script]); }
  async onUpdate(handle: Handle, callback: (update: unknown) => Promise<void>) { this.updates.set(handle.id, callback); }
  async onMessage(handle: Handle, callback: (message: unknown) => Promise<unknown>) { this.messages.set(handle.id, callback); }
  postMessage(handle: Handle, message: unknown) { this.pushes.push({ handle: handle.id, message }); }
  async saveNote(handle: Handle, value: { noteId: string; body: string }) { this.saves.push({ handle: handle.id, ...value }); }
}

async function install(fake: FakeEditors, id: string) {
  const handle = { id };
  const session = new EditorHandleSession(fake, handle);
  await session.setup(id === "one" ? "light-theme" : "dark-theme");
  await session.onUpdate(async (update: any) => {
    session.post({ type: "updateNote", value: update });
  });
  await session.onMessage(async (message: any) => {
    if (message.type === "ready") return { session: id };
    if (message.type === "saveNote") {
      await session.save({ noteId: message.noteId, body: message.body });
      return { status: "saved" };
    }
    return undefined;
  });
  return session;
}

describe("focused two-handle Joplin editor simulator", () => {
  it("sets up independent exact shells and production scripts", async () => {
    const fake = new FakeEditors();
    await install(fake, "one");
    await install(fake, "two");
    expect(fake.html.get("one")).toContain('id="asciidoc-editor-root" class="light-theme"');
    expect(fake.html.get("two")).toContain('id="asciidoc-editor-root" class="dark-theme"');
    expect(fake.scripts.get("one")).toEqual(EDITOR_SCRIPTS);
    expect(fake.scripts.get("two")).toEqual(EDITOR_SCRIPTS);
  });

  it("routes ready, update, save, and settings traffic per handle", async () => {
    const fake = new FakeEditors();
    const one = await install(fake, "one");
    const two = await install(fake, "two");
    await expect(fake.messages.get("one")!({ type: "ready" })).resolves.toEqual({ session: "one" });
    await expect(fake.messages.get("two")!({ type: "ready" })).resolves.toEqual({ session: "two" });
    await fake.updates.get("one")!({ id: "note-a", body: "A" });
    await fake.updates.get("two")!({ id: "note-b", body: "B" });
    await fake.messages.get("one")!({ type: "saveNote", noteId: "note-a", body: "A2" });
    await fake.messages.get("two")!({ type: "saveNote", noteId: "note-b", body: "B2" });
    one.post({ type: "updateTheme", value: "dark" });
    two.post({ type: "updateTheme", value: "light" });
    expect(fake.pushes.map(entry => entry.handle)).toEqual(["one", "two", "one", "two"]);
    expect(fake.saves).toEqual([
      { handle: "one", noteId: "note-a", body: "A2" },
      { handle: "two", noteId: "note-b", body: "B2" },
    ]);
  });

  it("suppresses updates, saves, and postMessage after handle destruction", async () => {
    const fake = new FakeEditors();
    const session = await install(fake, "one");
    session.dispose();
    await fake.updates.get("one")!({ id: "late", body: "late" });
    await fake.messages.get("one")!({ type: "saveNote", noteId: "late", body: "late" });
    expect(session.post({ type: "updateTheme", value: "dark" })).toBe(false);
    await expect(session.save({ noteId: "late", body: "late" })).resolves.toBe(false);
    expect(fake.pushes).toEqual([]);
    expect(fake.saves).toEqual([]);
    expect(session.signal.aborted).toBe(true);
  });

  it("fans settings out once to live handles and removes destroyed handles", async () => {
    const fake = new FakeEditors();
    const registry = new EditorHandleRegistry(fake);
    const oneHandle = { id: "one" };
    const twoHandle = { id: "two" };
    const one = registry.create(oneHandle);
    const two = registry.create(twoHandle);
    await one.setup("light-theme");
    await two.setup("dark-theme");
    expect(registry.postAll({ type: "updateCompactSpacing", value: true })).toBe(2);
    expect(registry.dispose(oneHandle)).toBe(true);
    expect(registry.size).toBe(1);
    expect(registry.postAll({ type: "updateTheme", value: "dark" })).toBe(1);
    expect(fake.pushes).toEqual([
      { handle: "one", message: { type: "updateCompactSpacing", value: true } },
      { handle: "two", message: { type: "updateCompactSpacing", value: true } },
      { handle: "two", message: { type: "updateTheme", value: "dark" } },
    ]);
  });
});
