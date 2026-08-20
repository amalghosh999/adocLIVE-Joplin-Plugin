import { buildEditorShell } from "../shared/editor-shell";

export interface JoplinEditorViewPort<Handle = unknown> {
  setHtml(handle: Handle, html: string): Promise<void>;
  addScript(handle: Handle, path: string): Promise<void>;
  onUpdate(handle: Handle, callback: (update: unknown) => Promise<void>): Promise<void>;
  onMessage(handle: Handle, callback: (message: unknown) => Promise<unknown>): Promise<void>;
  postMessage(handle: Handle, message: unknown): void;
  saveNote(handle: Handle, value: { noteId: string; body: string }): Promise<void>;
}

const EDITOR_SCRIPTS = [
  "./panel.js",
  "./styles/editor.css",
  "./styles/preview.css",
  "./styles/katex.min.css",
] as const;

/** Handle-scoped registration/lifecycle seam shared with the focused simulator. */
export class EditorHandleSession<Handle = unknown> {
  private active = true;
  private readonly controller = new AbortController();

  constructor(private readonly editors: JoplinEditorViewPort<Handle>, readonly handle: Handle) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get isActive(): boolean {
    return this.active;
  }

  async setup(themeClass: "light-theme" | "dark-theme"): Promise<void> {
    this.assertActive();
    await this.editors.setHtml(this.handle, buildEditorShell({ themeClass }));
    for (const script of EDITOR_SCRIPTS) {
      this.assertActive();
      await this.editors.addScript(this.handle, script);
    }
  }

  async onUpdate(callback: (update: any) => Promise<void>): Promise<void> {
    this.assertActive();
    await this.editors.onUpdate(this.handle, async update => {
      if (this.active) await callback(update);
    });
  }

  async onMessage(callback: (message: any) => Promise<unknown>): Promise<void> {
    this.assertActive();
    await this.editors.onMessage(this.handle, message => {
      if (!this.active) return Promise.resolve(undefined);
      return callback(message);
    });
  }

  post(message: unknown): boolean {
    if (!this.active) return false;
    this.editors.postMessage(this.handle, message);
    return true;
  }

  async save(value: { noteId: string; body: string }): Promise<boolean> {
    if (!this.active) return false;
    await this.editors.saveNote(this.handle, value);
    return this.active;
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.controller.abort();
  }

  private assertActive(): void {
    if (!this.active) throw new Error("Editor handle is destroyed");
  }
}

/** Owns handle lifetime and makes settings fan-out testable without faking Joplin. */
export class EditorHandleRegistry<Handle = unknown> {
  private readonly sessions = new Map<Handle, EditorHandleSession<Handle>>();

  constructor(private readonly editors: JoplinEditorViewPort<Handle>) {}

  create(handle: Handle): EditorHandleSession<Handle> {
    this.dispose(handle);
    const session = new EditorHandleSession(this.editors, handle);
    this.sessions.set(handle, session);
    return session;
  }

  get(handle: Handle): EditorHandleSession<Handle> | undefined {
    return this.sessions.get(handle);
  }

  dispose(handle: Handle): boolean {
    const session = this.sessions.get(handle);
    if (!session) return false;
    session.dispose();
    this.sessions.delete(handle);
    return true;
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
  }

  postAll(message: unknown): number {
    let delivered = 0;
    for (const session of this.sessions.values()) {
      if (session.post(message)) delivered += 1;
    }
    return delivered;
  }

  get size(): number {
    return this.sessions.size;
  }
}

export { EDITOR_SCRIPTS };
