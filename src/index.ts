/**
 * Joplin plugin sandbox entry point.
 * Registers the custom AsciiDoc editor, commands, and settings.
 * Reconstituted from the existing compiled plugin with the new
 * ribbon-based live-preview HTML template.
 */

import joplin from "api";
import { collectDocumentSections, findSectionLineNumber } from "./shared/asciidoc-sections";
import {
  filterJoplinNoteLinkCandidates,
  isAsciiDocNoteBody,
  type JoplinNoteLinkCandidate,
} from "./shared/joplin-note-links";
import { normalizeNoteIdsFromCommandArgs } from "./shared/joplin-command-args";
import { renderAsciiDocHtml } from "./host/rendering";
import { convertMarkdownToAsciiDoc } from "./host/markdown-conversion";
import { EditorHandleRegistry } from "./host/editor-handle";
import { createEditorHostOperations, EditorRpcService } from "./host/editor-rpc-service";
import { createEditorHostApplication, createEditorHostPorts } from "./host/editor-host-application";
import { expandEditorIncludes } from "./host/include-expansion";

// Joplin MenuItemLocation values (defined locally to avoid requiring api/types at runtime)
const MenuItemLocation = {
  File: "file",
  Edit: "edit",
  View: "view",
  Note: "note",
  Tools: "tools",
  Help: "help",
  Context: "context",
  NoteListContextMenu: "noteListContextMenu",
  EditorContextMenu: "editorContextMenu",
  FolderContextMenu: "folderContextMenu",
  TagContextMenu: "tagContextMenu",
} as const;

const ToolbarButtonLocation = {
  NoteToolbar: "noteToolbar",
  EditorToolbar: "editorToolbar",
} as const;

// =====================================================
// Sentinel helpers
// =====================================================

const SENTINEL_REGEX = /\n?```asciidoc-settings\n([\s\S]*?)\n```\s*$/;

function isAsciiDocNote(body: string): boolean {
  return isAsciiDocNoteBody(body);
}

function stripSentinel(body: string): { content: string; settings: Record<string, any> } {
  const match = body.match(SENTINEL_REGEX);
  if (!match) return { content: body, settings: {} };
  const content = body.replace(SENTINEL_REGEX, "").trimEnd();
  let settings: Record<string, any> = {};
  try {
    settings = JSON.parse(match[1] || "{}");
  } catch {}
  return { content, settings };
}

function appendSentinel(content: string, settings: Record<string, any>): string {
  const { content: stripped } = stripSentinel(content);
  return `${stripped}\n\n\`\`\`asciidoc-settings\n${JSON.stringify(settings, null, 2)}\n\`\`\`\n`;
}

const NOTE_ID_RE = /^[a-f0-9]{32}$/i;

function normalizeTargetForResolution(target: string): string {
  return target.trim().replace(/^xref:/, "").replace(/\[[\s\S]*\]$/, "");
}

async function getCurrentNoteIdFallback(explicitNoteId?: string): Promise<string> {
  if (explicitNoteId) return explicitNoteId;
  try {
    const selected = await joplin.workspace.selectedNote();
    return selected?.id || "";
  } catch {
    return "";
  }
}

async function getAsciiDocNoteContent(noteId: string): Promise<{ id: string; title: string; content: string } | null> {
  if (!noteId) return null;
  try {
    const note = await joplin.data.get(["notes", noteId], { fields: ["id", "title", "body"] });
    if (!isAsciiDocNote(note.body || "")) return null;
    const { content } = stripSentinel(note.body || "");
    return { id: note.id, title: note.title || note.id, content };
  } catch {
    return null;
  }
}

function resultItems(result: any): any[] {
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result)) return result;
  return [];
}

async function getJoplinNoteFolderId(noteId: string): Promise<string> {
  if (!noteId) return "";
  try {
    const note = await joplin.data.get(["notes", noteId], { fields: ["id", "parent_id"] });
    return note?.parent_id || "";
  } catch {
    return "";
  }
}

async function getActiveJoplinFolderId(fromNoteId?: string): Promise<string> {
  const noteId = await getCurrentNoteIdFallback(fromNoteId);
  const noteFolderId = await getJoplinNoteFolderId(noteId);
  if (noteFolderId) return noteFolderId;
  try {
    const selectedFolder = await joplin.workspace.selectedFolder();
    return selectedFolder?.id || "";
  } catch {
    return "";
  }
}

async function fetchJoplinFolderNotes(folderId: string): Promise<JoplinNoteLinkCandidate[]> {
  if (!folderId) return [];
  const notes: JoplinNoteLinkCandidate[] = [];
  let page = 1;
  let hasMore = false;

  do {
    const result = await joplin.data.get(["folders", folderId, "notes"], {
      fields: ["id", "title", "body", "updated_time"],
      order_by: "updated_time",
      order_dir: "DESC",
      limit: 100,
      page,
    });
    notes.push(...resultItems(result));
    hasMore = result?.has_more === true;
    page += 1;
  } while (hasMore && page <= 100);

  return notes;
}

async function searchJoplinNotesInActiveFolder(
  fromNoteId: string,
  query: string,
  limit: number,
  options: { asciiDocOnly?: boolean } = {},
) {
  const folderId = await getActiveJoplinFolderId(fromNoteId);
  if (!folderId) return [];
  const notes = await fetchJoplinFolderNotes(folderId);
  return filterJoplinNoteLinkCandidates(notes, {
    currentNoteId: fromNoteId,
    query,
    limit,
    asciiDocOnly: options.asciiDocOnly === true,
  });
}

async function findNoteByExactTitle(title: string, folderId?: string): Promise<{ id: string; title: string; body: string } | null> {
  const query = title.trim();
  if (!query) return null;
  try {
    const items = folderId
      ? await fetchJoplinFolderNotes(folderId)
      : resultItems(await joplin.data.get(["search"], {
          query,
          fields: ["id", "title", "body"],
          limit: 20,
        }));
    const exact = items.find((item: any) =>
      isAsciiDocNote(item.body || "")
      && String(item.title || "").trim().toLowerCase() === query.toLowerCase()
    );
    return exact || null;
  } catch {
    return null;
  }
}

async function resolveXrefTargetForJoplin(fromNoteId: string, rawTarget: string): Promise<{
  noteId: string;
  title: string;
  sectionAnchor?: string;
  targetLine?: number;
} | null> {
  const target = normalizeTargetForResolution(rawTarget);
  if (!target) return null;

  let noteRef = "";
  let sectionAnchor = "";
  if (target.startsWith("#")) {
    sectionAnchor = target.slice(1).trim();
  } else {
    const hashIndex = target.indexOf("#");
    if (hashIndex >= 0) {
      noteRef = target.slice(0, hashIndex).trim();
      sectionAnchor = target.slice(hashIndex + 1).trim();
    } else if (NOTE_ID_RE.test(target)) {
      noteRef = target;
    } else {
      sectionAnchor = target;
    }
  }

  let noteId = noteRef || await getCurrentNoteIdFallback(fromNoteId);
  const scopeFolderId = await getActiveJoplinFolderId(fromNoteId);
  let note = NOTE_ID_RE.test(noteId) ? await getAsciiDocNoteContent(noteId) : null;

  if (!note && noteRef) {
    const byTitle = await findNoteByExactTitle(noteRef, scopeFolderId);
    if (byTitle) {
      noteId = byTitle.id;
      const { content } = stripSentinel(byTitle.body || "");
      note = { id: byTitle.id, title: byTitle.title || byTitle.id, content };
    }
  }

  if (!note && !noteRef && sectionAnchor) {
    note = await getAsciiDocNoteContent(noteId);
    if (!note) {
      const byTitle = await findNoteByExactTitle(sectionAnchor, scopeFolderId);
      if (byTitle) {
        const { content } = stripSentinel(byTitle.body || "");
        noteId = byTitle.id;
        sectionAnchor = "";
        note = { id: byTitle.id, title: byTitle.title || byTitle.id, content };
      }
    }
  }

  if (!note) return null;

  const targetLine = sectionAnchor ? findSectionLineNumber(note.content, sectionAnchor) : undefined;
  return {
    noteId: note.id,
    title: note.title,
    ...(sectionAnchor ? { sectionAnchor } : {}),
    ...(targetLine ? { targetLine } : {}),
  };
}

interface ResolvedJoplinInclude {
  id: string;
  key: string;
  title: string;
  content: string;
  asciidoc: boolean;
}

function normalizeIncludeTarget(rawTarget: string): string {
  return rawTarget.trim().replace(/^joplin:/i, "");
}

function normalizeResourceIncludeTarget(rawTarget: string): string {
  return rawTarget
    .trim()
    .replace(/^resource:/i, "")
    .replace(/^joplin-resource:/i, "")
    .replace(/^:\/?/, "");
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function isTextResource(resource: any): boolean {
  const mime = String(resource?.mime || "").toLowerCase();
  const title = String(resource?.title || "").toLowerCase();
  return mime.startsWith("text/")
    || mime === "application/json"
    || mime === "application/xml"
    || /\.(adoc|asciidoc|txt|md|csv|tsv|json|xml|html?|css|js|ts|log)$/i.test(title);
}

function isAsciiDocResource(resource: any): boolean {
  return /\.(adoc|asciidoc)$/i.test(String(resource?.title || ""));
}

async function resolveIncludeResourceTarget(rawTarget: string): Promise<ResolvedJoplinInclude | null> {
  const target = normalizeResourceIncludeTarget(rawTarget);
  if (!NOTE_ID_RE.test(target)) return null;
  try {
    const resource = await joplin.data.get(["resources", target], { fields: ["id", "title", "mime"] });
    if (!isTextResource(resource)) return null;
    const fs = require("fs");
    const resourcePath = await joplin.data.resourcePath(target);
    const content = normalizeLineEndings(String(fs.readFileSync(resourcePath, "utf8")));
    return {
      id: resource.id,
      key: `resource:${resource.id}`,
      title: resource.title || resource.id,
      content: isAsciiDocResource(resource) ? stripSentinel(content).content : content,
      asciidoc: isAsciiDocResource(resource),
    };
  } catch {
    return null;
  }
}

async function resolveIncludeTarget(fromNoteId: string, rawTarget: string): Promise<ResolvedJoplinInclude | null> {
  if (/^(resource|joplin-resource):/i.test(rawTarget) || /^:\/?[a-f0-9]{32}$/i.test(rawTarget)) {
    return resolveIncludeResourceTarget(rawTarget);
  }

  const target = normalizeIncludeTarget(rawTarget);
  if (!target) return null;
  if (target === ".") {
    const note = await getAsciiDocNoteContent(fromNoteId);
    return note ? { ...note, key: `note:${note.id}`, asciidoc: true } : null;
  }
  if (NOTE_ID_RE.test(target)) {
    const note = await getAsciiDocNoteContent(target);
    return note ? { ...note, key: `note:${note.id}`, asciidoc: true } : null;
  }
  const byTitle = await findNoteByExactTitle(target);
  if (byTitle) {
    const { content } = stripSentinel(byTitle.body || "");
    return { id: byTitle.id, key: `note:${byTitle.id}`, title: byTitle.title || byTitle.id, content, asciidoc: true };
  }
  return null;
}

// =====================================================
// Asciidoctor.js rendering
// =====================================================

function renderAsciidoc(source: string, settings: Record<string, any> = {}): string {
  return renderAsciiDocHtml(source, settings);
}

// =====================================================
// Template tag
// =====================================================

const TEMPLATE_TAG = "asciidoc-template";

async function ensureTemplateTag(): Promise<string> {
  let page = 1;
  for (;;) {
    const result = await joplin.data.get(["tags"], {
      fields: ["id", "title"],
      page,
      limit: 100,
    });
    const items = result.items || result;
    for (const tag of items) {
      if (tag.title === TEMPLATE_TAG) return tag.id;
    }
    if (!result.has_more) break;
    page++;
  }
  const newTag = await joplin.data.post(["tags"], null, { title: TEMPLATE_TAG });
  return newTag.id;
}

async function getTemplateNotes(tagId: string): Promise<Array<{ id: string; title: string }>> {
  const notes: Array<{ id: string; title: string }> = [];
  let page = 1;
  for (;;) {
    const result = await joplin.data.get(["tags", tagId, "notes"], {
      fields: ["id", "title"],
      page,
      limit: 100,
    });
    const items = result.items || result;
    for (const note of items) {
      notes.push({ id: note.id, title: note.title });
    }
    if (!result.has_more) break;
    page++;
  }
  return notes.sort((a, b) => a.title.localeCompare(b.title));
}

// =====================================================
// Notebook conversion helpers
// =====================================================

async function getNotesInFolder(folderId: string): Promise<Array<{ id: string; title: string; body: string }>> {
  const notes: Array<{ id: string; title: string; body: string }> = [];
  let page = 1;
  for (;;) {
    const result = await joplin.data.get(["folders", folderId, "notes"], {
      fields: ["id", "title", "body"],
      page,
      limit: 100,
    });
    const items = result.items || result;
    for (const note of items) {
      notes.push({ id: note.id, title: note.title, body: note.body });
    }
    if (!result.has_more) break;
    page++;
  }
  return notes;
}

async function getSubFolders(parentId: string): Promise<Array<{ id: string; title: string }>> {
  const folders: Array<{ id: string; title: string }> = [];
  let page = 1;
  for (;;) {
    const result = await joplin.data.get(["folders"], {
      fields: ["id", "title", "parent_id"],
      page,
      limit: 100,
    });
    const items = result.items || result;
    for (const folder of items) {
      if ((folder as any).parent_id === parentId) {
        folders.push({ id: folder.id, title: folder.title });
      }
    }
    if (!result.has_more) break;
    page++;
  }
  return folders;
}

async function copyNotebookAsAsciiDoc(sourceFolderId: string, targetParentId: string, newTitle: string) {
  const newFolder = await joplin.data.post(["folders"], null, {
    parent_id: targetParentId,
    title: newTitle,
  });

  const notes = await getNotesInFolder(sourceFolderId);
  for (const note of notes) {
    const body = isAsciiDocNote(note.body)
      ? note.body
      : appendSentinel(convertMarkdownToAsciiDoc(note.body), {});
    await joplin.data.post(["notes"], null, {
      parent_id: newFolder.id,
      title: note.title,
      body,
    });
  }

  const subFolders = await getSubFolders(sourceFolderId);
  for (const sub of subFolders) {
    await copyNotebookAsAsciiDoc(sub.id, newFolder.id, sub.title);
  }
}

async function replaceNotebookWithAsciiDoc(folderId: string) {
  const notes = await getNotesInFolder(folderId);
  for (const note of notes) {
    if (isAsciiDocNote(note.body)) continue;
    const converted = convertMarkdownToAsciiDoc(note.body);
    const newBody = appendSentinel(converted, {});
    await joplin.data.put(["notes", note.id], null, { body: newBody });
  }

  const subFolders = await getSubFolders(folderId);
  for (const sub of subFolders) {
    await replaceNotebookWithAsciiDoc(sub.id);
  }
}

// =====================================================
// Commands registration
// =====================================================

let attributesDialog: any = null;

async function noteIdsFromCommandArgs(args: unknown[]): Promise<string[]> {
  const noteIds = normalizeNoteIdsFromCommandArgs(args);
  if (noteIds.length > 0) return noteIds;

  const selected = await joplin.workspace.selectedNote();
  return selected?.id ? [selected.id] : [];
}

async function reloadNoteWithEditor(noteId: string, parentId: string) {
  const tmp = await joplin.data.post(["notes"], null, {
    parent_id: parentId,
    title: ".tmp-adoclive-convert",
    body: "",
  });
  try {
    await joplin.commands.execute("openNote", tmp.id);
  } finally {
    await joplin.data.delete(["notes", tmp.id]);
  }
  await joplin.commands.execute("openNote", noteId);
}

async function createAdocLiveCopy(noteId: string): Promise<string | null> {
  const note = await joplin.data.get(["notes", noteId], {
    fields: ["id", "title", "body", "parent_id"],
  });
  if (!note) return null;

  const body = isAsciiDocNote(note.body)
    ? note.body
    : appendSentinel(convertMarkdownToAsciiDoc(note.body), {});
  const copy = await joplin.data.post(["notes"], null, {
    parent_id: note.parent_id,
    title: `${note.title || "Untitled"} (adocLIVE)`,
    body,
  });
  return copy.id || null;
}

async function replaceNoteWithAdocLive(noteId: string): Promise<{ id: string; parentId: string } | null> {
  const note = await joplin.data.get(["notes", noteId], {
    fields: ["id", "body", "parent_id"],
  });
  if (!note || isAsciiDocNote(note.body)) return null;

  const converted = convertMarkdownToAsciiDoc(note.body);
  const newBody = appendSentinel(converted, {});
  await joplin.data.put(["notes", note.id], null, { body: newBody });
  return { id: note.id, parentId: note.parent_id };
}

async function registerCommands() {
  await joplin.commands.register({
    name: "asciidoc.createNote",
    label: "New adocLIVE Note",
    iconName: "fas fa-file-alt",
    execute: async () => {
      const folder = await joplin.workspace.selectedFolder();
      const note = await joplin.data.post(["notes"], null, {
        parent_id: folder.id,
        title: "New adocLIVE Note",
        body: "= New adocLIVE Note\n\nStart writing here...\n\n```asciidoc-settings\n{}\n```\n",
      });
      setTimeout(async () => {
        await joplin.commands.execute("openNote", note.id);
        try {
          await joplin.commands.execute("showEditorPlugin");
        } catch {}
      }, 100);
    },
  });

  await joplin.commands.register({
    name: "asciidoc.convertCurrentNote",
    label: "Convert to adocLIVE Note",
    iconName: "fas fa-exchange-alt",
    execute: async () => {
      const selected = await joplin.workspace.selectedNote();
      if (!selected) return;
      const replaced = await replaceNoteWithAdocLive(selected.id);
      if (replaced) await reloadNoteWithEditor(replaced.id, replaced.parentId);
    },
  });

  await joplin.commands.register({
    name: "asciidoc.convertCurrentNoteCopy",
    label: "Convert to adocLIVE Note (new note)",
    iconName: "fas fa-copy",
    execute: async () => {
      const selected = await joplin.workspace.selectedNote();
      if (!selected) return;
      const copyId = await createAdocLiveCopy(selected.id);
      if (!copyId) return;
      setTimeout(async () => {
        await joplin.commands.execute("openNote", copyId);
      }, 100);
    },
  });

  await joplin.commands.register({
    name: "asciidoc.editAttributes",
    label: "Edit AsciiDoc Attributes",
    iconName: "fas fa-cog",
    execute: async () => {
      const selected = await joplin.workspace.selectedNote();
      if (!selected || !isAsciiDocNote(selected.body)) return;

      const { content, settings } = stripSentinel(selected.body);
      const attributes = settings.attributes || {};
      const attrText = Object.entries(attributes)
        .map(([k, v]) => (v ? `${k}=${v}` : k))
        .join("\n");

      if (!attributesDialog) {
        attributesDialog = await joplin.views.dialogs.create("asciidoc-attributes");
      }

      await joplin.views.dialogs.setHtml(
        attributesDialog,
        `<div style="padding: 16px; font-family: sans-serif;">
          <h3 style="margin-top: 0;">AsciiDoc Document Attributes</h3>
          <p style="font-size: 13px; color: #666;">One attribute per line. Use <code>key=value</code> or just <code>key</code> for boolean attributes.</p>
          <textarea name="attributes" style="width: 100%; height: 200px; font-family: monospace; font-size: 13px; padding: 8px; box-sizing: border-box;">${attrText}</textarea>
        </div>`
      );

      await joplin.views.dialogs.setButtons(attributesDialog, [
        { id: "ok", title: "Save" },
        { id: "cancel", title: "Cancel" },
      ]);

      const result = await joplin.views.dialogs.open(attributesDialog);
      if (result.id === "ok" && result.formData) {
        const rawAttrs = result.formData.attributes?.attributes || "";
        const newAttrs: Record<string, string> = {};
        for (const line of rawAttrs.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            newAttrs[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
          } else {
            newAttrs[trimmed] = "";
          }
        }
        const newSettings = { ...settings, attributes: newAttrs };
        const newBody = appendSentinel(content, newSettings);
        await joplin.data.put(["notes", selected.id], null, { body: newBody });
        await joplin.commands.execute("openNote", selected.id);
      }
    },
  });

  // "Create adocLIVE Copy" — available in note list right-click menu.
  await joplin.commands.register({
    name: "asciidoc.createAsciiDocCopy",
    label: "Create adocLIVE Copy",
    iconName: "fas fa-copy",
    execute: async (...args: any[]) => {
      const noteIds = await noteIdsFromCommandArgs(args);
      let lastCopyId = "";
      for (const noteId of noteIds) {
        const copyId = await createAdocLiveCopy(noteId);
        if (copyId) lastCopyId = copyId;
      }
      if (lastCopyId) {
        const noteToOpen = lastCopyId;
        setTimeout(async () => {
          await joplin.commands.execute("openNote", noteToOpen);
        }, 100);
      }
    },
  });

  // "Replace with adocLIVE Note" — converts note in-place from note list right-click menu.
  await joplin.commands.register({
    name: "asciidoc.replaceWithAsciiDoc",
    label: "Replace with adocLIVE Note",
    iconName: "fas fa-exchange-alt",
    execute: async (...args: any[]) => {
      const noteIds = await noteIdsFromCommandArgs(args);
      let lastReplaced: { id: string; parentId: string } | null = null;
      for (const noteId of noteIds) {
        const replaced = await replaceNoteWithAdocLive(noteId);
        if (replaced) lastReplaced = replaced;
      }
      if (lastReplaced) await reloadNoteWithEditor(lastReplaced.id, lastReplaced.parentId);
    },
  });

  // "Make adocLIVE" — converts current note in-place, shown as toolbar button.
  await joplin.commands.register({
    name: "asciidoc.makeCurrentNoteAsciiDoc",
    label: "Make adocLIVE",
    iconName: "fas fa-file-alt",
    execute: async () => {
      const selected = await joplin.workspace.selectedNote();
      if (!selected) return;
      const replaced = await replaceNoteWithAdocLive(selected.id);
      if (replaced) await reloadNoteWithEditor(replaced.id, replaced.parentId);
    },
  });

  // Register toolbar button — appears in the note toolbar for quick access
  await joplin.views.toolbarButtons.create(
    "asciidocMakeAsciiDocBtn",
    "asciidoc.makeCurrentNoteAsciiDoc",
    ToolbarButtonLocation.NoteToolbar,
  );

  // Register menu items
  await joplin.views.menuItems.create("asciidocCreateNote", "asciidoc.createNote", MenuItemLocation.Tools);
  await joplin.views.menuItems.create("asciidocConvert", "asciidoc.convertCurrentNote", MenuItemLocation.Tools);
  await joplin.views.menuItems.create("asciidocConvertCopy", "asciidoc.convertCurrentNoteCopy", MenuItemLocation.Tools);
  await joplin.views.menuItems.create("asciidocEditAttrs", "asciidoc.editAttributes", MenuItemLocation.Tools);

  // Note list right-click context menu
  await joplin.views.menuItems.create("asciidocCopyContextMenu", "asciidoc.createAsciiDocCopy", MenuItemLocation.NoteListContextMenu);
  await joplin.views.menuItems.create("asciidocReplaceContextMenu", "asciidoc.replaceWithAsciiDoc", MenuItemLocation.NoteListContextMenu);

  // Notebook (folder) conversion commands
  await joplin.commands.register({
    name: "asciidoc.copyNotebookAsAsciiDoc",
    label: "Create adocLIVE Copy of Notebook",
    iconName: "fas fa-copy",
    execute: async (...args: any[]) => {
      try {
        // Folder ID may be passed as argument from context menu, or fall back to selected folder
        const folderId = args[0] || (await joplin.workspace.selectedFolder())?.id;
        if (!folderId) {
          console.error("[adocLIVE] copyNotebook: no folder ID available");
          return;
        }
        const folderData = await joplin.data.get(["folders", folderId], {
          fields: ["id", "title", "parent_id"],
        });
        if (!folderData) {
          console.error("[adocLIVE] copyNotebook: folder not found:", folderId);
          return;
        }
        console.info("[adocLIVE] Creating AsciiDoc copy of notebook:", folderData.title);
        await copyNotebookAsAsciiDoc(folderData.id, folderData.parent_id || "", folderData.title + " (adocLIVE)");
        console.info("[adocLIVE] Notebook copy complete");
      } catch (e) {
        console.error("[adocLIVE] copyNotebook failed:", e);
      }
    },
  });

  await joplin.commands.register({
    name: "asciidoc.replaceNotebookWithAsciiDoc",
    label: "Replace with adocLIVE Notebook",
    iconName: "fas fa-exchange-alt",
    execute: async (...args: any[]) => {
      try {
        const folderId = args[0] || (await joplin.workspace.selectedFolder())?.id;
        if (!folderId) {
          console.error("[adocLIVE] replaceNotebook: no folder ID available");
          return;
        }
        console.info("[adocLIVE] Replacing notebook with AsciiDoc:", folderId);
        await replaceNotebookWithAsciiDoc(folderId);
        console.info("[adocLIVE] Notebook replacement complete");
      } catch (e) {
        console.error("[adocLIVE] replaceNotebook failed:", e);
      }
    },
  });

  // Folder right-click context menu
  await joplin.views.menuItems.create("asciidocCopyNotebookContextMenu", "asciidoc.copyNotebookAsAsciiDoc", MenuItemLocation.FolderContextMenu);
  await joplin.views.menuItems.create("asciidocReplaceNotebookContextMenu", "asciidoc.replaceNotebookWithAsciiDoc", MenuItemLocation.FolderContextMenu);
}

// =====================================================
// Settings registration
// =====================================================

async function registerSettings() {
  await joplin.settings.registerSection("asciidoc", {
    label: "adocLIVE",
    iconName: "fas fa-file-alt",
  });

  await joplin.settings.registerSection("asciidoc-spellchecker", {
    label: "Spell Checker",
    iconName: "fas fa-spell-check",
  });

  await joplin.settings.registerSettings({
    "asciidoc.newNotesAsAsciiDoc": {
      section: "asciidoc",
      public: true,
      type: 3, // Boolean
      value: false,
      label: "Create new notes as adocLIVE",
      description: "When enabled, new notes will automatically be created as adocLIVE notes with the Live Preview editor.",
    },
    "asciidoc.compactSpacing": {
      section: "asciidoc",
      public: true,
      type: 3, // Boolean
      value: false,
      label: "Compact Spacing",
      description: "When enabled, uses tighter spacing between elements instead of official Asciidoctor spacing values.",
    },
    "asciidoc.personalDictionary": {
      section: "asciidoc",
      public: false,
      type: 2, // String
      value: "[]",
      label: "Personal Dictionary",
      description: "JSON array of custom dictionary words (managed by the spell checker).",
    },
    "asciidoc.spellcheckPluralSingular": {
      section: "asciidoc-spellchecker",
      public: true,
      type: 3, // Boolean
      value: true,
      label: "Adding New Words Adds Their Plural/Singular",
      description: "When enabled, the spell-checker right-click menu includes options to add a word along with its plural or singular form.",
    },
    "asciidoc.snippetTemplates": {
      section: "asciidoc",
      public: false,
      type: 2, // String (JSON array)
      value: "[]",
      label: "Snippet Templates",
      description: "JSON array of user-defined snippet templates (managed by the editor).",
    },
    "asciidoc.attributeAutocomplete": {
      section: "asciidoc",
      public: true,
      type: 3, // Boolean
      value: false,
      label: "Attribute Autocomplete",
      description: "When enabled, typing { shows an autocomplete menu for document attributes defined in the header.",
    },
    "asciidoc.spellCheck": {
      section: "asciidoc-spellchecker",
      public: true,
      type: 3, // Boolean
      value: true,
      label: "Use nspell Spell Checker",
      description: "When enabled, adocLIVE uses nspell with AsciiDoc-aware underlines and dictionary actions. When disabled, the editor falls back to Joplin/Electron native spell checking.",
    },
    "asciidoc.editorTheme": {
      section: "asciidoc",
      public: true,
      type: 2, // String
      value: "follow",
      label: "Editor Theme",
      description: "Controls the editor color theme.",
      isEnum: true,
      options: {
        follow: "Follow Joplin theme",
        light: "Light",
        dark: "Dark",
        sepia: "Sepia",
        "high-contrast": "High Contrast",
        midnight: "Midnight",
      },
    },
    "asciidoc.mermaidThemeVariables": {
      section: "asciidoc",
      public: true,
      type: 2, // String
      value: "{}",
      label: "Mermaid Theme Variables",
      description: "JSON object of Mermaid themeVariables merged into diagram rendering.",
    },
  });
}

// =====================================================
// Plugin entry point
// =====================================================

joplin.plugins.register({
  onStart: async function () {
    console.info("[adocLIVE] Plugin onStart called");
    try {
    await registerSettings();
    await registerCommands();
    console.info("[adocLIVE] Commands and settings registered");

    let templateTagId: string;
    try {
      templateTagId = await ensureTemplateTag();
    } catch (e) {
      console.error("[adocLIVE] Failed to ensure template tag:", e);
      templateTagId = "";
    }

    const editors = (joplin.views as any).editors;
    if (!editors) {
      console.error("[adocLIVE] joplin.views.editors not available — custom editor requires Joplin 3.1+");
      return;
    }
    let currentNoteId: string | null = null;
    let lastNote: { id: string; body: string; html: string } | null = null;
    const editorHandles = new EditorHandleRegistry(editors);

    async function renderNote(body: string): Promise<string> {
      const { content, settings } = stripSentinel(body);
      const sourceNoteId = currentNoteId || "";
      const seen = NOTE_ID_RE.test(sourceNoteId) ? new Set([`note:${sourceNoteId}`]) : new Set<string>();
      const expanded = await expandEditorIncludes(content, sourceNoteId, resolveIncludeTarget, seen);
      return renderAsciidoc(expanded, settings);
    }

    try {
    await editors.register("asciidoc-editor", {
      async onSetup(handle: any) {
        const isDark = await joplin.shouldUseDarkColors();
        const themeClass: "dark-theme" | "light-theme" = isDark ? "dark-theme" : "light-theme";
        const editorHandle = editorHandles.create(handle);

        // Shared exact shell and production assets. The webview owns presentation state.
        await editorHandle.setup(themeClass);

        // Handle note updates from Joplin
        await editorHandle.onUpdate(async (update: any) => {
          if (!isAsciiDocNote(update.newBody)) return;
          currentNoteId = update.noteId;
          const html = await renderNote(update.newBody);
          lastNote = { id: update.noteId, body: update.newBody, html };
          editorHandle.post({
            type: "updateNote",
            value: lastNote,
          });
        });

        // Concrete Joplin operations retain their message-specific behavior while
        // shared EditorRpcService owns request/response validation and routing.
        const dispatchEditorMessage = async (msg: any) => {

          // Ready — send current note (always fetch fresh to avoid stale cache)
          if (msg.type === "ready") {
            const nspellSpellcheckEnabled = await joplin.settings.value("asciidoc.spellCheck") !== false;
            const response: any = {
              isDark: await joplin.shouldUseDarkColors(),
              compactSpacing: await joplin.settings.value("asciidoc.compactSpacing") === true,
              attributeAutocomplete: await joplin.settings.value("asciidoc.attributeAutocomplete") !== false,
              spellCheck: nspellSpellcheckEnabled,
              spellcheckMode: nspellSpellcheckEnabled ? "nspell" : "native",
              editorTheme: await joplin.settings.value("asciidoc.editorTheme"),
              mermaidThemeVariables: await joplin.settings.value("asciidoc.mermaidThemeVariables"),
            };
            try {
              const note = await joplin.workspace.selectedNote();
              if (note && isAsciiDocNote(note.body)) {
                currentNoteId = note.id;
                const html = await renderNote(note.body);
                lastNote = { id: note.id, body: note.body, html };
                response.note = lastNote;
              } else {
                // Clear stale cache when switching to a non-AsciiDoc note
                lastNote = null;
              }
            } catch {}
            return response;
          }

          // Save note — panel.ts sends body with sentinel already included
          if (msg.type === "saveNote") {
            const noteId = msg.noteId || currentNoteId;
            if (!noteId) return { status: "error", error: "No note ID" };
            // Ensure the sentinel is present; if panel sent raw content, add it
            const body = isAsciiDocNote(msg.body) ? msg.body : appendSentinel(msg.body, {});
            await editorHandle.save({ noteId, body });
            return { status: "saved" };
          }

          // Get note content (for section preview)
          if (msg.type === "getNoteContent") {
            try {
              const note = await joplin.data.get(["notes", msg.noteId], {
                fields: ["id", "title", "body"],
              });
              const { content } = stripSentinel(note.body || "");
              return { id: note.id, title: note.title, body: content };
            } catch {
              return { id: msg.noteId, title: "", body: "" };
            }
          }

          // Render AsciiDoc
          if (msg.type === "renderAsciidoc") {
            return { html: await renderNote(msg.source) };
          }

          // Resolve Joplin resources
          if (msg.type === "requestResources") {
            const resources: Array<{ id: string; dataUrl: string }> = [];
            for (const id of msg.resourceIds) {
              try {
                const path = await joplin.data.resourcePath(id);
                resources.push({ id, dataUrl: "file://" + path });
              } catch (e) {
                console.warn("Failed to resolve resource " + id + ":", e);
              }
            }
            return { resources };
          }

          // Open image file dialog
          if (msg.type === "openImageDialog") {
            try {
              const result = await joplin.views.dialogs.showOpenDialog({
                title: "Select Image",
                filters: [
                  {
                    name: "Images",
                    extensions: [
                      "jpg", "jpeg", "png", "gif", "bmp", "svg",
                      "webp", "ico", "tiff", "tif", "avif",
                    ],
                  },
                ],
                properties: ["openFile"],
              } as any);

              if (Array.isArray(result)) {
                if (result.length > 0) return { filePath: result[0] };
              } else if (result && !result.canceled && result.filePaths?.length > 0) {
                return { filePath: result.filePaths[0] };
              }
            } catch (e) {
              console.warn("showOpenDialog failed:", e);
            }
            return { filePath: null };
          }

          // Open video file dialog
          if (msg.type === "openVideoDialog") {
            try {
              const result = await joplin.views.dialogs.showOpenDialog({
                title: "Select Video",
                filters: [
                  {
                    name: "Videos",
                    extensions: [
                      "mp4", "m4v", "webm", "ogv", "ogg",
                      "mov", "avi", "mkv", "wmv", "flv",
                    ],
                  },
                ],
                properties: ["openFile"],
              } as any);

              if (Array.isArray(result)) {
                if (result.length > 0) return { filePath: result[0] };
              } else if (result && !result.canceled && result.filePaths?.length > 0) {
                return { filePath: result.filePaths[0] };
              }
            } catch (e) {
              console.warn("showOpenDialog failed:", e);
            }
            return { filePath: null };
          }

          // Open audio file dialog
          if (msg.type === "openAudioDialog") {
            try {
              const result = await joplin.views.dialogs.showOpenDialog({
                title: "Select Audio",
                filters: [
                  {
                    name: "Audio",
                    extensions: [
                      "mp3", "m4a", "aac", "wav", "flac",
                      "ogg", "oga", "opus", "webm", "aiff", "aif",
                    ],
                  },
                ],
                properties: ["openFile"],
              } as any);

              if (Array.isArray(result)) {
                if (result.length > 0) return { filePath: result[0] };
              } else if (result && !result.canceled && result.filePaths?.length > 0) {
                return { filePath: result.filePaths[0] };
              }
            } catch (e) {
              console.warn("showOpenDialog failed:", e);
            }
            return { filePath: null };
          }

          // Create resource from file
          if (msg.type === "createResourceFromFile") {
            try {
              const path = require("path");
              const title = path.basename(msg.filePath);
              const resource = await joplin.data.post(
                ["resources"],
                null,
                { title },
                [{ path: msg.filePath }]
              );
              let dataUrl = "";
              try {
                const resourcePath = await joplin.data.resourcePath(resource.id);
                dataUrl = "file://" + resourcePath;
              } catch {}
              return { resourceId: resource.id, title: resource.title, ...(dataUrl ? { dataUrl } : {}) };
            } catch (e) {
              console.warn("createResourceFromFile failed:", e);
              return { error: String(e) };
            }
          }

          // Create resource from webview-provided bytes (paste/drop fallback)
          if (msg.type === "createResourceFromBytes") {
            const fs = require("fs");
            const os = require("os");
            const path = require("path");
            let tmpPath = "";
            try {
              const safeName = String(msg.fileName || "attachment.bin").replace(/[\\/]/g, "_");
              const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "joplin-asciidoc-resource-"));
              tmpPath = path.join(tmpDir, safeName);
              fs.writeFileSync(tmpPath, Buffer.from(String(msg.dataBase64 || ""), "base64"));
              const resource = await joplin.data.post(
                ["resources"],
                null,
                { title: safeName, mime: msg.mimeType || undefined },
                [{ path: tmpPath }]
              );
              let dataUrl = "";
              try {
                const resourcePath = await joplin.data.resourcePath(resource.id);
                dataUrl = "file://" + resourcePath;
              } catch {}
              try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
              } catch {}
              return { resourceId: resource.id, title: resource.title, ...(dataUrl ? { dataUrl } : {}) };
            } catch (e) {
              console.warn("createResourceFromBytes failed:", e);
              if (tmpPath) {
                try {
                  fs.rmSync(path.dirname(tmpPath), { recursive: true, force: true });
                } catch {}
              }
              return { error: String(e) };
            }
          }

          // Search notes
          if (msg.type === "searchNotes") {
            try {
              const query = (msg.query || "").trim();
              const fromNoteId = await getCurrentNoteIdFallback(msg.fromNoteId || currentNoteId || "");
              const notes = await searchJoplinNotesInActiveFolder(fromNoteId, query, 20);
              return { notes };
            } catch {
              return { notes: [] };
            }
          }

          // Include completion targets: Joplin AsciiDoc notes.
          if (msg.type === "getIncludeTargets") {
            try {
              const query = (msg.query || "").replace(/^joplin:/i, "").trim();
              const fromNoteId = await getCurrentNoteIdFallback(msg.fromNoteId || currentNoteId || "");
              const noteTargets = (await searchJoplinNotesInActiveFolder(fromNoteId, query, 25, { asciiDocOnly: true }))
                .map((note) => ({
                  id: note.id,
                  title: note.title || note.id,
                  displayPath: `Note: ${note.title || note.id}`,
                  insertText: `joplin:${note.id}`,
                }));

              let resourceTargets: any[] = [];
              const resourceQuery = String(msg.query || "").replace(/^(resource|joplin-resource):/i, "").replace(/^:\/?/, "").trim().toLowerCase();
              try {
                const resourceResult = await joplin.data.get(["resources"], {
                  fields: ["id", "title", "mime", "updated_time"],
                  order_by: "updated_time",
                  order_dir: "DESC",
                  limit: 100,
                });
                const resources = resourceResult.items || resourceResult || [];
                resourceTargets = resources
                  .filter((resource: any) => isTextResource(resource))
                  .filter((resource: any) => {
                    if (!resourceQuery) return true;
                    const title = String(resource.title || "").toLowerCase();
                    const id = String(resource.id || "").toLowerCase();
                    return title.includes(resourceQuery) || id.includes(resourceQuery);
                  })
                  .slice(0, 25)
                  .map((resource: any) => ({
                    id: resource.id,
                    title: resource.title || resource.id,
                    displayPath: `Resource: ${resource.title || resource.id}`,
                    insertText: `resource:${resource.id}`,
                  }));
              } catch (e) {
                console.warn("getIncludeTargets resource lookup failed:", e);
              }

              return {
                targets: [...noteTargets, ...resourceTargets].slice(0, 40),
              };
            } catch (e) {
              console.warn("getIncludeTargets failed:", e);
              return { targets: [] };
            }
          }

          // Resolve note/section cross-reference targets
          if (msg.type === "resolveXrefTarget") {
            try {
              const fromNoteId = await getCurrentNoteIdFallback(msg.fromNoteId);
              const target = await resolveXrefTargetForJoplin(fromNoteId, msg.target || "");
              return { target };
            } catch {
              return { target: null };
            }
          }

          // Get note sections (headings)
          if (msg.type === "getNoteSections") {
            try {
              const note = await joplin.data.get(["notes", msg.noteId], {
                fields: ["body"],
              });
              const { content } = stripSentinel(note.body || "");
              const sections = collectDocumentSections(content).map(section => ({
                id: section.anchor,
                title: section.title,
                level: section.level,
                lineNumber: section.lineNumber,
                ...(section.reftext ? { reftext: section.reftext } : {}),
              }));
              return { sections };
            } catch {
              return { sections: [] };
            }
          }

          // Navigate to note
          if (msg.type === "navigateToNote") {
            await joplin.commands.execute("openNote", msg.noteId);
            return { status: "ok" };
          }

          // Get templates
          if (msg.type === "getTemplates") {
            const templates = await getTemplateNotes(templateTagId);
            return { templates };
          }

          // Get template content
          if (msg.type === "getTemplateContent") {
            try {
              const note = await joplin.data.get(["notes", msg.noteId], {
                fields: ["body"],
              });
              const { content } = stripSentinel(note.body || "");
              return { content };
            } catch {
              return { content: "", error: "Failed to load template" };
            }
          }

          // Mark note as template
          if (msg.type === "markAsTemplate" && currentNoteId) {
            try {
              await joplin.data.post(["tags", templateTagId, "notes"], null, {
                id: currentNoteId,
              });
              return { status: "ok" };
            } catch {
              return { status: "error" };
            }
          }

          // Remove a specific note from templates by ID
          if (msg.type === "removeTemplate" && msg.noteId) {
            try {
              await joplin.data.delete(["tags", templateTagId, "notes", msg.noteId]);
              return { status: "ok" };
            } catch {
              return { status: "error" };
            }
          }

          // Get spell-check settings
          if (msg.type === "getSpellcheckSettings") {
            try {
              const pluralSingular = await joplin.settings.value("asciidoc.spellcheckPluralSingular");
              const nspellSpellcheckEnabled = await joplin.settings.value("asciidoc.spellCheck") !== false;
              return {
                pluralSingular: pluralSingular !== false,
                mode: nspellSpellcheckEnabled ? "nspell" : "native",
              };
            } catch {
              return { pluralSingular: true, mode: "nspell" };
            }
          }

          // Get personal dictionary
          if (msg.type === "getPersonalDictionary") {
            try {
              const raw = await joplin.settings.value("asciidoc.personalDictionary");
              const words = JSON.parse(raw || "[]");
              return { words: Array.isArray(words) ? words : [] };
            } catch {
              return { words: [] };
            }
          }

          // Add word to personal dictionary
          if (msg.type === "addWordToPersonalDictionary") {
            try {
              const raw = await joplin.settings.value("asciidoc.personalDictionary");
              const words: string[] = JSON.parse(raw || "[]");
              if (!words.includes(msg.word)) {
                words.push(msg.word);
                words.sort();
                await joplin.settings.setValue("asciidoc.personalDictionary", JSON.stringify(words));
              }
              return { status: "ok" };
            } catch (e) {
              console.error("[adocLIVE] Failed to save dictionary word:", e);
              return { status: "error" };
            }
          }

          // Snippet Templates
          if (msg.type === "getSnippets") {
            try {
              const raw = await joplin.settings.value("asciidoc.snippetTemplates");
              const snippets = JSON.parse(raw || "[]");
              return { snippets: Array.isArray(snippets) ? snippets : [] };
            } catch {
              return { snippets: [] };
            }
          }

          if (msg.type === "addSnippet") {
            try {
              const raw = await joplin.settings.value("asciidoc.snippetTemplates");
              const snippets: any[] = JSON.parse(raw || "[]");
              if (snippets.some((s: any) => s.name === msg.name)) {
                return { status: "error", error: "A snippet with this name already exists" };
              }
              const snippet = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: msg.name, content: msg.content };
              snippets.push(snippet);
              snippets.sort((a: any, b: any) => a.name.localeCompare(b.name));
              await joplin.settings.setValue("asciidoc.snippetTemplates", JSON.stringify(snippets));
              return { status: "ok", snippet };
            } catch (e) {
              console.error("[adocLIVE] Failed to save snippet:", e);
              return { status: "error", error: "Failed to save snippet" };
            }
          }

          if (msg.type === "updateSnippet") {
            try {
              const raw = await joplin.settings.value("asciidoc.snippetTemplates");
              const snippets: any[] = JSON.parse(raw || "[]");
              const idx = snippets.findIndex((s: any) => s.id === msg.id);
              if (idx < 0) return { status: "error", error: "Snippet not found" };
              // Check name uniqueness (excluding the current snippet)
              if (snippets.some((s: any, i: number) => i !== idx && s.name === msg.name)) {
                return { status: "error", error: "A snippet with this name already exists" };
              }
              snippets[idx] = { ...snippets[idx], name: msg.name, content: msg.content };
              snippets.sort((a: any, b: any) => a.name.localeCompare(b.name));
              await joplin.settings.setValue("asciidoc.snippetTemplates", JSON.stringify(snippets));
              return { status: "ok" };
            } catch (e) {
              console.error("[adocLIVE] Failed to update snippet:", e);
              return { status: "error", error: "Failed to update snippet" };
            }
          }

          if (msg.type === "removeSnippet") {
            try {
              const raw = await joplin.settings.value("asciidoc.snippetTemplates");
              const snippets: any[] = JSON.parse(raw || "[]");
              const filtered = snippets.filter((s: any) => s.id !== msg.id);
              await joplin.settings.setValue("asciidoc.snippetTemplates", JSON.stringify(filtered));
              return { status: "ok" };
            } catch (e) {
              console.error("[adocLIVE] Failed to remove snippet:", e);
              return { status: "error" };
            }
          }

          // Fullscreen mode — toggle sidebars
          if (msg.type === "setFullscreenMode") {
            try {
              const layout = await (joplin.settings as any).globalValue("ui.layout");
              if (msg.enabled) {
                // Store current visibility before hiding
                let sideBarVisible = true;
                let noteListVisible = true;
                if (layout) {
                  const findVisible = (items: any[], key: string): boolean | undefined => {
                    for (const item of items) {
                      if (item.key === key) return item.visible !== false;
                      if (item.children) {
                        const found = findVisible(item.children, key);
                        if (found !== undefined) return found;
                      }
                    }
                    return undefined;
                  };
                  const layoutChildren = layout.children || [layout];
                  sideBarVisible = findVisible(layoutChildren, "sideBar") ?? true;
                  noteListVisible = findVisible(layoutChildren, "noteList") ?? true;
                }
                (globalThis as any).__asciidocFullscreenState = { sideBarVisible, noteListVisible };
                if (sideBarVisible) await joplin.commands.execute("toggleSideBar");
                if (noteListVisible) await joplin.commands.execute("toggleNoteList");
              } else {
                // Restore previous visibility
                const state = (globalThis as any).__asciidocFullscreenState;
                if (state) {
                  if (state.sideBarVisible) await joplin.commands.execute("toggleSideBar");
                  if (state.noteListVisible) await joplin.commands.execute("toggleNoteList");
                  delete (globalThis as any).__asciidocFullscreenState;
                }
              }
              return { status: "ok" };
            } catch (e) {
              console.error("[adocLIVE] Failed to toggle fullscreen:", e);
              return { status: "error" };
            }
          }

          // Convert Markdown to AsciiDoc (for paste conversion)
          if (msg.type === "convertMarkdownPaste") {
            return { asciidoc: convertMarkdownToAsciiDoc(msg.markdown || "") };
          }
        };
        const joplinOperations = createEditorHostOperations(dispatchEditorMessage);
        const rpcService = new EditorRpcService(createEditorHostApplication(createEditorHostPorts(joplinOperations)));
        await editorHandle.onMessage(async (msg: any) => {
          if (msg?.kind === "ReturnValueResponse") return undefined;
          return rpcService.request(msg, {
            sessionId: `joplin:${String(handle?.id ?? handle)}`,
            handleId: String(handle?.id ?? handle),
            selectedNoteId: currentNoteId || undefined,
            signal: editorHandle.signal,
          });
        });

      },

      async onDestroy(handle: any) {
        editorHandles.dispose(handle);
      },

      async onActivationCheck(event: any) {
        if (!event.noteId) return false;
        const note = await joplin.data.get(["notes", event.noteId], {
          fields: ["body"],
        });
        return isAsciiDocNote(note?.body ?? "");
      },
    } as any);
    // Register one setting observer and fan out to the currently live handles.
    await (joplin.settings as any).onChange(async (event: any) => {
      if (event.keys.includes("asciidoc.compactSpacing")) {
        editorHandles.postAll({
          type: "updateCompactSpacing",
          value: await joplin.settings.value("asciidoc.compactSpacing") === true,
        });
      }
      if (event.keys.includes("asciidoc.attributeAutocomplete")) {
        editorHandles.postAll({
          type: "updateAttributeAutocomplete",
          enabled: await joplin.settings.value("asciidoc.attributeAutocomplete") !== false,
        });
      }
      if (event.keys.includes("asciidoc.spellCheck")) {
        const enabled = await joplin.settings.value("asciidoc.spellCheck") !== false;
        editorHandles.postAll({ type: "updateSpellCheck", enabled, mode: enabled ? "nspell" : "native" });
      }
      if (event.keys.includes("asciidoc.editorTheme") || event.keys.includes("asciidoc.mermaidThemeVariables")) {
        editorHandles.postAll({
          type: "updateEditorTheme",
          editorTheme: await joplin.settings.value("asciidoc.editorTheme"),
          mermaidThemeVariables: await joplin.settings.value("asciidoc.mermaidThemeVariables"),
          isDark: await joplin.shouldUseDarkColors(),
        });
      }
    });
    } catch (e) {
      console.error("[adocLIVE] Failed to register custom editor:", e);
    }
    // Auto-convert new notes to AsciiDoc when setting is enabled.
    // Uses a debounce + lock to prevent loops. No temp notes.
    let autoConvertLock = false;
    const convertedNoteIds = new Set<string>();
    await joplin.workspace.onNoteSelectionChange(async (event: any) => {
      if (autoConvertLock) return;
      try {
        const autoConvert = await joplin.settings.value("asciidoc.newNotesAsAsciiDoc");
        if (!autoConvert) return;

        const noteIds = event.value;
        if (!noteIds || noteIds.length === 0) return;
        const noteId = noteIds[0];

        // Never process the same note twice
        if (convertedNoteIds.has(noteId)) return;

        const note = await joplin.data.get(["notes", noteId], {
          fields: ["id", "title", "body", "created_time"],
        });
        if (!note) return;
        if (isAsciiDocNote(note.body)) {
          convertedNoteIds.add(noteId); // Already AsciiDoc, mark as seen
          return;
        }

        // Only convert notes created very recently (within 5 seconds) with empty/default body
        const age = Date.now() - note.created_time;
        const bodyTrimmed = (note.body || "").trim();
        const isNew = age < 5000 && (bodyTrimmed === "" || bodyTrimmed === note.title);
        if (!isNew) return;

        // Lock to prevent re-entry from our own openNote call
        autoConvertLock = true;
        convertedNoteIds.add(noteId);

        // Just add the sentinel — Joplin will detect the change and reload
        const newBody = appendSentinel(note.body, {});
        await joplin.data.put(["notes", noteId], null, { body: newBody });

        // Re-open the same note so Joplin re-evaluates which editor to use
        await joplin.commands.execute("openNote", noteId);
      } catch (e) {
        console.error("[adocLIVE] Auto-convert failed:", e);
      } finally {
        // Release lock after a delay to let Joplin settle
        setTimeout(() => { autoConvertLock = false; }, 1000);
      }
    });

    } catch (e) {
      console.error("[adocLIVE] Plugin onStart failed:", e);
    }
  },
});
