/**
 * IPC abstraction layer for Joplin plugin webview.
 * All adapted files import from here instead of Tauri's invoke().
 * Communication happens via webviewApi.postMessage().
 */

declare const webviewApi: { postMessage(msg: any): Promise<any> };

export async function saveNoteContent(noteId: string, body: string): Promise<void> {
  await webviewApi.postMessage({ type: "saveNote", noteId, body });
}

export async function getNoteContent(noteId: string): Promise<{ id: string; title: string; body: string }> {
  return webviewApi.postMessage({ type: "getNoteContent", noteId });
}

export interface ResolvedXrefTarget {
  noteId: string;
  title: string;
  sectionAnchor?: string;
  targetLine?: number;
}

export interface IncludeTarget {
  id: string;
  title: string;
  displayPath: string;
  insertText: string;
}

export async function searchNotes(query: string, mode?: "autocomplete" | "search", fromNoteId?: string): Promise<{ notes: Array<{ id: string; title: string; isAsciiDoc: boolean }> }> {
  return webviewApi.postMessage({ type: "searchNotes", query, mode, fromNoteId });
}

export async function getNoteSections(noteId: string): Promise<{ sections: Array<{ id: string; title: string; level: number; lineNumber?: number; reftext?: string }> }> {
  return webviewApi.postMessage({ type: "getNoteSections", noteId });
}

export async function getIncludeTargets(fromNoteId: string, query: string): Promise<{ targets: IncludeTarget[] }> {
  return webviewApi.postMessage({ type: "getIncludeTargets", fromNoteId, query });
}

export async function resolveXrefTarget(fromNoteId: string, target: string): Promise<ResolvedXrefTarget | null> {
  const result = await webviewApi.postMessage({ type: "resolveXrefTarget", fromNoteId, target });
  return result?.target ?? null;
}

export async function renderAsciidoc(source: string): Promise<{ html: string }> {
  return webviewApi.postMessage({ type: "renderAsciidoc", source });
}

export async function openImageDialog(): Promise<{ filePath: string | null }> {
  return webviewApi.postMessage({ type: "openImageDialog" });
}

export async function openVideoDialog(): Promise<{ filePath: string | null }> {
  return webviewApi.postMessage({ type: "openVideoDialog" });
}

export async function openAudioDialog(): Promise<{ filePath: string | null }> {
  return webviewApi.postMessage({ type: "openAudioDialog" });
}

export async function createResourceFromFile(filePath: string): Promise<{ resourceId: string; title: string; dataUrl?: string }> {
  return webviewApi.postMessage({ type: "createResourceFromFile", filePath });
}

export async function createResourceFromBytes(fileName: string, mimeType: string, dataBase64: string): Promise<{ resourceId: string; title: string; dataUrl?: string }> {
  return webviewApi.postMessage({ type: "createResourceFromBytes", fileName, mimeType, dataBase64 });
}

export async function requestResources(resourceIds: string[]): Promise<{ resources: Array<{ id: string; dataUrl: string }> }> {
  return webviewApi.postMessage({ type: "requestResources", resourceIds });
}

export async function navigateToNote(noteId: string): Promise<void> {
  await webviewApi.postMessage({ type: "navigateToNote", noteId });
}

export async function getTemplates(): Promise<{ templates: Array<{ id: string; title: string }> }> {
  return webviewApi.postMessage({ type: "getTemplates" });
}

export async function getTemplateContent(noteId: string): Promise<{ content: string }> {
  return webviewApi.postMessage({ type: "getTemplateContent", noteId });
}

export async function markAsTemplate(): Promise<void> {
  await webviewApi.postMessage({ type: "markAsTemplate" });
}

export async function removeTemplate(noteId: string): Promise<void> {
  await webviewApi.postMessage({ type: "removeTemplate", noteId });
}

// Snippet Templates
export interface Snippet {
  id: string;
  name: string;
  content: string;
}

export async function getSnippets(): Promise<{ snippets: Snippet[] }> {
  return webviewApi.postMessage({ type: "getSnippets" });
}

export async function addSnippet(name: string, content: string): Promise<{ status: string; snippet?: Snippet; error?: string }> {
  return webviewApi.postMessage({ type: "addSnippet", name, content });
}

export async function updateSnippet(id: string, name: string, content: string): Promise<{ status: string; error?: string }> {
  return webviewApi.postMessage({ type: "updateSnippet", id, name, content });
}

export async function removeSnippet(id: string): Promise<{ status: string }> {
  return webviewApi.postMessage({ type: "removeSnippet", id });
}

export async function getSpellcheckSettings(): Promise<{ pluralSingular: boolean; mode?: "nspell" | "native" }> {
  return webviewApi.postMessage({ type: "getSpellcheckSettings" });
}

export async function getPersonalDictionary(): Promise<{ words: string[] }> {
  return webviewApi.postMessage({ type: "getPersonalDictionary" });
}

export async function addWordToPersonalDictionary(word: string): Promise<void> {
  return webviewApi.postMessage({ type: "addWordToPersonalDictionary", word });
}

export async function setFullscreenMode(enabled: boolean): Promise<void> {
  return webviewApi.postMessage({ type: "setFullscreenMode", enabled });
}

export async function convertMarkdownPaste(markdown: string): Promise<{ asciidoc: string }> {
  return webviewApi.postMessage({ type: "convertMarkdownPaste", markdown });
}
