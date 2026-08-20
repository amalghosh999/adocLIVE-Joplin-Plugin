/**
 * Webview entry point for the AsciiDoc live-preview editor.
 * Replaces the old split-view panel.js with a single-pane CM6 editor
 * with always-on live-preview decorations.
 */

import { EditorView, ViewPlugin, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder, Decoration, gutterLineClass, GutterMarker, type Panel } from "@codemirror/view";
import { EditorState, Compartment, Prec, RangeSet, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, openSearchPanel, closeSearchPanel, searchPanelOpen, search, SearchQuery, setSearchQuery, getSearchQuery, findNext, findPrevious, replaceNext, replaceAll } from "@codemirror/search";
import { type CompletionContext, type CompletionResult, startCompletion, completionStatus } from "@codemirror/autocomplete";
import { bracketMatching } from "@codemirror/language";
import { asciidocLanguage } from "./lib/editor/asciidoc-language";
import { asciidocKeymap } from "./lib/editor/keybindings";
import { livePreview, refreshLivePreview, updateResourceUrls, setOverlayEditingEnabled, setCompactSpacing, setDocAttributesVisible, closeFloatingPreview, getBiblioLabels, getDocumentAttributes } from "./lib/editor/live-preview";
import { wikiLinkCompletion } from "./lib/editor/wiki-link-completion";
import { includeCompletionSource, includeCompletionTrigger } from "./lib/editor/include-completion";
import { spellcheckExtension, loadPersonalDictionary, onDictionaryChange, refreshSpellcheck, resolveSpellcheckMode, setShowPluralSingular, setSpellcheckMode, type SpellcheckMode } from "./lib/editor/spellcheck";
import { buildRibbon } from "./lib/toolbar/ribbon";
import { isSmartQuotesEnabled } from "./lib/toolbar/panels/formatting-panel";
import { saveNoteContent, requestResources, createResourceFromBytes, getPersonalDictionary, addWordToPersonalDictionary, getSpellcheckSettings, setFullscreenMode, convertMarkdownPaste, renderAsciidoc, getSnippets, addSnippet, type Snippet } from "./lib/ipc";
import { setCurrentNoteId } from "./lib/note-context";
import { setMermaidThemeConfig } from "./lib/utils/mermaid-render";
import { getEditorTransport, subscribeToHostPush } from "./lib/editor-transport";
import { emitEditorDiagnostic } from "./shared/editor-diagnostics";

// =====================================================
// State
// =====================================================

let editorView: EditorView | null = null;
let currentNoteId = "";
let currentSentinel = "";
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let isDirty = false;
let suppressNextDocChange = false; // Prevent save-back loop when loading new note
let lastSavedContent: string | null = null; // Track last saved content to detect echo-back updates
const SAVE_DEBOUNCE_MS = 2000;

const lineNumbersCompartment = new Compartment();
const spellcheckCompartment = new Compartment();
const livePreviewCompartment = new Compartment();
let showLineNumbers = localStorage.getItem("asciidoc-line-numbers") === "true";
let specialBlockShading = localStorage.getItem("asciidoc-block-shading") === "true";
let overlayEditingEnabled = localStorage.getItem("asciidoc-overlay-editing") !== "false";
let spellcheckEnabled = localStorage.getItem("asciidoc-spellcheck") === "true";
let spellcheckMode: SpellcheckMode = normalizeSpellcheckMode(localStorage.getItem("asciidoc-spellcheck-mode"));
let currentZoom = parseInt(localStorage.getItem("asciidoc-editor-zoom") || "100", 10);
if (currentZoom < 50 || currentZoom > 150) currentZoom = 100;
let compactSpacingEnabled = false;

type EditorViewMode = "live-preview" | "split";
type SplitViewSubmode = "split" | "raw" | "preview";
let editorViewMode: EditorViewMode = localStorage.getItem("asciidoc-editor-view-mode") === "split" ? "split" : "live-preview";
let splitViewSubmode: SplitViewSubmode = (() => {
  const raw = localStorage.getItem("asciidoc-editor-split-submode");
  return raw === "raw" || raw === "preview" || raw === "split" ? raw : "split";
})();
let splitRawFraction = (() => {
  const parsed = Number.parseFloat(localStorage.getItem("asciidoc-editor-split-fraction") || "0.5");
  return Number.isFinite(parsed) ? Math.min(0.85, Math.max(0.15, parsed)) : 0.5;
})();
let renderedPreviewTimer: ReturnType<typeof setTimeout> | null = null;
let renderedPreviewSeq = 0;
let hostDarkTheme = false;
let editorThemeName = "follow";
let mermaidThemeVariablesRaw = "{}";

const EDITOR_THEME_NAMES = ["follow", "light", "dark", "sepia", "high-contrast", "midnight"] as const;
type EditorThemeName = typeof EDITOR_THEME_NAMES[number];

const SEARCH_FLAGS_KEY = "adl.search.flags";
const SEARCH_EXPANDED_KEY = "adl.search.expanded";

interface SearchFlags {
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

function loadSearchFlags(): SearchFlags {
  const fallback: SearchFlags = { caseSensitive: false, wholeWord: false, regexp: false };
  try {
    const raw = localStorage.getItem(SEARCH_FLAGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      caseSensitive: !!parsed.caseSensitive,
      wholeWord: !!parsed.wholeWord,
      regexp: !!parsed.regexp,
    };
  } catch {
    return fallback;
  }
}

function saveSearchFlags(flags: SearchFlags): void {
  try {
    localStorage.setItem(SEARCH_FLAGS_KEY, JSON.stringify(flags));
  } catch {}
}

function loadSearchExpanded(): boolean {
  return localStorage.getItem(SEARCH_EXPANDED_KEY) === "1";
}

function saveSearchExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(SEARCH_EXPANDED_KEY, expanded ? "1" : "0");
  } catch {}
}

function normalizeSpellcheckMode(value: unknown): SpellcheckMode {
  return value === "native" || value === "nspell" ? value : "nspell";
}

function effectiveSpellcheckMode(): SpellcheckMode {
  return resolveSpellcheckMode(spellcheckEnabled ? spellcheckMode : "native");
}

function currentSpellcheckExtension() {
  return spellcheckExtension(effectiveSpellcheckMode());
}

// ── Snippet Templates state ──
let snippets: Snippet[] = [];
let snippetCompletionActive = false;
let snippetTriggerPos = 0;
let snippetTriggerIsInline = false;

function snippetCompletionSource(context: CompletionContext): CompletionResult | null {
  if (!snippetCompletionActive || snippets.length === 0) return null;
  const from = snippetTriggerPos;
  return {
    from,
    options: snippets.map((snippet) => ({
      label: snippetTriggerIsInline ? "@@" + snippet.name : snippet.name,
      displayLabel: snippet.name,
      detail: snippet.content.replace(/\n/g, "\u23CE ").slice(0, 60) + (snippet.content.length > 60 ? "\u2026" : ""),
      type: "text" as const,
      apply: (view: any, _c: any, from: number, to: number) => {
        view.dispatch({
          changes: { from, to, insert: snippet.content },
          selection: { anchor: from + snippet.content.length },
        });
        snippetCompletionActive = false;
      },
    })),
    validFor: snippetTriggerIsInline ? /^@@.*/ : /^.*/,
  };
}

// ── Attribute Autocomplete state ──
let attributeAutocompleteEnabled = true;

function attributeCompletionSource(context: CompletionContext): CompletionResult | null {
  if (!attributeAutocompleteEnabled) return null;
  const match = context.matchBefore(/\{[\w-]*/);
  if (!match) return null;

  const lineNumber = context.state.doc.lineAt(match.from).number;
  const docAttrs = getDocumentAttributes(lineNumber);
  if (docAttrs.size === 0) return null;

  const query = match.text.slice(1).toLowerCase(); // strip leading {
  const from = match.from + 1; // position after {

  const options = [];
  for (const [name, value] of docAttrs) {
    if (query && !name.includes(query)) continue;
    options.push({
      label: name,
      detail: value.length > 40 ? value.slice(0, 40) + "\u2026" : value,
      type: "variable" as const,
      apply: (view: any, _c: any, _from: number, to: number) => {
        const insert = name + "}";
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
        });
      },
    });
  }

  if (options.length === 0) return null;

  return {
    from,
    options,
    validFor: /^[\w-]*/,
  };
}

// Sync initial state to live-preview module
setOverlayEditingEnabled(overlayEditingEnabled);
setCompactSpacing(compactSpacingEnabled);
const savedDocAttr = localStorage.getItem("asciidoc-doc-attributes");
setDocAttributesVisible(savedDocAttr === "true");

function parseMermaidVariables(raw: string): Record<string, any> | undefined {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeEditorThemeName(value: unknown): EditorThemeName {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (EDITOR_THEME_NAMES as readonly string[]).includes(raw) ? raw as EditorThemeName : "follow";
}

function applyEditorTheme(root: HTMLElement | null = document.getElementById("asciidoc-editor-root")) {
  if (!root) return;
  const normalized = normalizeEditorThemeName(editorThemeName);
  const effectiveDark = normalized === "dark" || normalized === "high-contrast" || normalized === "midnight" || (normalized === "follow" && hostDarkTheme);
  root.classList.remove("dark-theme", "light-theme", "theme-sepia", "theme-high-contrast", "theme-midnight");
  root.classList.add(effectiveDark ? "dark-theme" : "light-theme");
  if (normalized === "sepia") root.classList.add("theme-sepia");
  if (normalized === "high-contrast") root.classList.add("theme-high-contrast");
  if (normalized === "midnight") root.classList.add("theme-midnight");

  const mermaidVariables = parseMermaidVariables(mermaidThemeVariablesRaw);
  setMermaidThemeConfig({
    theme: effectiveDark ? "dark" : "default",
    ...(mermaidVariables ? { variables: mermaidVariables } : {}),
  });
  if (editorView) refreshLivePreview(editorView);
  scheduleRenderedPreviewRender(0);
}

// Highlight removal helpers
const backgroundHighlightPattern = /\[\.[a-z-]+-background\]#([^#]+)#/g;
const plainHighlightPattern = /(?<!\])#([^#]+)#/g;

// =====================================================
// Sentinel handling
// =====================================================

const SENTINEL_REGEX = /\n?```asciidoc-settings\n([\s\S]*?)\n```\s*$/;

function stripSentinel(body: string): { content: string; sentinel: string } {
  const match = body.match(SENTINEL_REGEX);
  if (match) {
    return {
      content: body.slice(0, match.index!),
      sentinel: match[0],
    };
  }
  return { content: body, sentinel: "" };
}

function appendSentinel(content: string, sentinel: string): string {
  if (!sentinel) return content;
  return content + sentinel;
}

// =====================================================
// Resource resolution
// =====================================================

function extractResourceIds(content: string): string[] {
  const ids = new Set<string>();
  const regex = /:\/?([a-f0-9]{32})/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

async function resolveResources(content: string) {
  const ids = extractResourceIds(content);
  if (ids.length === 0) return;
  try {
    const result = await requestResources(ids);
    if (result.resources && result.resources.length > 0) {
      updateResourceUrls(result.resources);
      if (editorView) {
        refreshLivePreview(editorView);
      }
    }
  } catch (e) {
    console.error("[panel] Failed to resolve resources:", e);
  }
}

function getMediaMacroKind(file: File): "image" | "audio" | "video" | null {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|bmp|svg|webp|avif|tiff?|ico)$/.test(name)) return "image";
  if (mime.startsWith("audio/") || /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|aiff?)$/.test(name)) return "audio";
  if (mime.startsWith("video/") || /\.(mp4|m4v|webm|ogv|ogg|mov|avi|mkv|wmv|flv)$/.test(name)) return "video";
  return null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function createResourceFromDroppedFile(file: File): Promise<{ id: string; title: string; dataUrl?: string } | null> {
  const filePath = (file as any).path;
  if (typeof filePath === "string" && filePath) {
    const { createResourceFromFile } = await import("./lib/ipc");
    const resource = await createResourceFromFile(filePath);
    return { id: resource.resourceId, title: resource.title, dataUrl: resource.dataUrl };
  }

  const dataBase64 = arrayBufferToBase64(await file.arrayBuffer());
  const resource = await createResourceFromBytes(file.name || "attachment", file.type || "application/octet-stream", dataBase64);
  return { id: resource.resourceId, title: resource.title, dataUrl: resource.dataUrl };
}

async function insertMediaFiles(files: FileList | File[]): Promise<boolean> {
  if (!editorView) return false;
  const entries = Array.from(files).filter((file) => getMediaMacroKind(file) !== null);
  if (entries.length === 0) return false;

  const macros: string[] = [];
  const resourcesToCache: Array<{ id: string; dataUrl: string }> = [];

  for (const file of entries) {
    const kind = getMediaMacroKind(file);
    if (!kind) continue;
    const resource = await createResourceFromDroppedFile(file);
    if (!resource?.id) continue;
    if (resource.dataUrl) resourcesToCache.push({ id: resource.id, dataUrl: resource.dataUrl });
    const target = `:/${resource.id}`;
    const escapedTitle = (resource.title || file.name || "").replace(/[\[\]\n\r]/g, " ").trim();
    if (kind === "image") {
      macros.push(`image::${target}[${escapedTitle}]`);
    } else if (kind === "audio") {
      macros.push(`audio::${target}[]`);
    } else {
      macros.push(`video::${target}[]`);
    }
  }

  if (macros.length === 0 || !editorView) return false;
  if (resourcesToCache.length > 0) updateResourceUrls(resourcesToCache);

  const selection = editorView.state.selection.main;
  const prefix = selection.from > 0 && editorView.state.sliceDoc(selection.from - 1, selection.from) !== "\n" ? "\n" : "";
  const suffix = selection.to < editorView.state.doc.length && editorView.state.sliceDoc(selection.to, selection.to + 1) !== "\n" ? "\n" : "";
  const insert = `${prefix}${macros.join("\n\n")}${suffix}`;
  editorView.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: { anchor: selection.from + insert.length },
  });
  resolveResources(editorView.state.doc.toString());
  return true;
}

// =====================================================
// Save
// =====================================================

function scheduleSave() {
  isDirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, SAVE_DEBOUNCE_MS);
}

async function doSave() {
  if (!editorView || !isDirty || !currentNoteId) return;
  isDirty = false;
  saveTimer = null;
  // Capture state before async operation to prevent race conditions
  const noteId = currentNoteId;
  const content = editorView.state.doc.toString();
  lastSavedContent = content; // Track what we sent so we can detect echo-back
  const body = appendSentinel(content, currentSentinel);
  try {
    await saveNoteContent(noteId, body);
  } catch (e) {
    console.error("[panel] Save failed:", e);
    isDirty = true; // Restore dirty flag so save is retried on next edit
  }
}

function forceSave() {
  if (saveTimer) clearTimeout(saveTimer);
  doSave();
}

// =====================================================
// Highlight removal
// =====================================================

interface HighlightWrapper {
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
  innerText: string;
}

function collectHighlightWrappers(lineText: string): HighlightWrapper[] {
  const wrappers: HighlightWrapper[] = [];
  for (const pattern of [backgroundHighlightPattern, plainHighlightPattern]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(lineText)) !== null) {
      const fullMatch = match[0];
      const innerText = match[1] ?? "";
      const start = match.index;
      const end = start + fullMatch.length;
      const innerOffset = fullMatch.indexOf(innerText);
      wrappers.push({
        start,
        end,
        innerStart: start + Math.max(0, innerOffset),
        innerEnd: start + Math.max(0, innerOffset) + innerText.length,
        innerText,
      });
      if (fullMatch.length === 0) {
        pattern.lastIndex += 1;
      }
    }
  }
  return wrappers.sort((a, b) => (a.end - a.start) - (b.end - b.start));
}

function removeHighlightMarkup() {
  if (!editorView) return;
  const { from, to } = editorView.state.selection.main;
  const lineObj = editorView.state.doc.lineAt(from);
  if (to > lineObj.to) return;
  const relFrom = from - lineObj.from;
  const relTo = to - lineObj.from;
  const isCollapsed = from === to;
  const wrappers = collectHighlightWrappers(lineObj.text);
  const wrapper = wrappers.find((candidate) =>
    isCollapsed
      ? relFrom >= candidate.start && relFrom <= candidate.end
      : relFrom >= candidate.start && relTo <= candidate.end,
  );
  if (!wrapper) return;
  const replaceFrom = lineObj.from + wrapper.start;
  const replaceTo = lineObj.from + wrapper.end;
  const newFromOffset = Math.max(0, Math.min(relFrom - wrapper.innerStart, wrapper.innerText.length));
  const newToOffset = isCollapsed
    ? newFromOffset
    : Math.max(0, Math.min(relTo - wrapper.innerStart, wrapper.innerText.length));
  editorView.dispatch({
    changes: { from: replaceFrom, to: replaceTo, insert: wrapper.innerText },
    selection: {
      anchor: replaceFrom + newFromOffset,
      head: replaceFrom + newToOffset,
    },
  });
}

// =====================================================
// Text case transforms
// =====================================================

const CASE_TRANSFORMS = ["upper", "title", "lower", "snake"] as const;
let caseCycleIndex = 0;
let caseCycleOriginal: string | null = null; // original text before cycling started
let caseCycleSelKey: string | null = null;   // tracks which selection we're cycling on

function toTitleCase(s: string): string {
  return s.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function toSnakeCase(s: string): string {
  // Handle camelCase/PascalCase
  let result = s.replace(/([a-z])([A-Z])/g, "$1_$2");
  // Replace spaces and hyphens with underscores
  result = result.replace(/[\s\-]+/g, "_");
  return result.toLowerCase();
}

function applyTextTransform(text: string, transform: string): string {
  switch (transform) {
    case "upper": return text.toUpperCase();
    case "title": return toTitleCase(text);
    case "lower": return text.toLowerCase();
    case "snake": return toSnakeCase(text);
    case "cycle": {
      // Build selection key to detect when the user highlights new text
      const selKey = `${text.length}:${text}`;
      if (caseCycleSelKey !== selKey && caseCycleOriginal !== text) {
        // New selection — reset cycle and remember the original
        caseCycleIndex = 0;
        caseCycleOriginal = text;
        caseCycleSelKey = selKey;
      }
      const result = applyTextTransform(caseCycleOriginal!, CASE_TRANSFORMS[caseCycleIndex]);
      caseCycleIndex = (caseCycleIndex + 1) % CASE_TRANSFORMS.length;
      // Update the key to match the transformed output so next cycle continues
      caseCycleSelKey = `${result.length}:${result}`;
      return result;
    }
    default: return text;
  }
}

// =====================================================
// Editor command handler (toolbar → CM6)
// =====================================================

function handleEditorCommand(e: Event) {
  const detail = (e as CustomEvent).detail;
  if (!editorView) return;

  // Bibliography insertion command
  if (detail.command === "insert-bibliography") {
    const doc = editorView.state.doc;
    const fullText = doc.toString();
    // Check if a bibliography section already exists
    if (/^\[bibliography\]$/m.test(fullText)) {
      // Scroll to existing bibliography section
      for (let ln = 1; ln <= doc.lines; ln++) {
        if (doc.line(ln).text.trim() === "[bibliography]") {
          const pos = doc.line(ln).from;
          editorView.dispatch({
            selection: { anchor: pos },
            effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 50 }),
          });
          editorView.focus();
          return;
        }
      }
    } else {
      // Insert new bibliography skeleton at end of document
      const skeleton = "\n\n[bibliography]\n== References\n\n* [[[ref1]]] Author. _Title_. Publisher. Year.";
      const end = doc.length;
      editorView.dispatch({
        changes: { from: end, insert: skeleton },
        selection: { anchor: end + skeleton.length },
      });
      editorView.focus();
    }
    return;
  }

  const { type, before, after, text } = detail;
  const { from, to } = editorView.state.selection.main;

  if (type === "wrap") {
    const selected = editorView.state.sliceDoc(from, to);

    // Toggle: if selected text is already wrapped, unwrap it
    if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
      const inner = selected.slice(before.length, selected.length - after.length);
      editorView.dispatch({
        changes: { from, to, insert: inner },
        selection: { anchor: from, head: from + inner.length },
      });
    }
    // Toggle: if the characters around the selection are the markers, remove them
    else if (
      editorView.state.sliceDoc(from - before.length, from) === before &&
      editorView.state.sliceDoc(to, to + after.length) === after
    ) {
      editorView.dispatch({
        changes: [
          { from: from - before.length, to: from, insert: "" },
          { from: to, to: to + after.length, insert: "" },
        ],
        selection: { anchor: from - before.length, head: to - before.length },
      });
    }
    // Otherwise, wrap the selection
    else {
      editorView.dispatch({
        changes: { from, to, insert: before + selected + after },
        selection: { anchor: from + before.length, head: to + before.length },
      });
    }
  } else if (type === "insert") {
    const detail = (e as CustomEvent).detail;
    const selectFrom = detail.selectFrom;
    const selectTo = detail.selectTo;
    const selection = selectFrom != null && selectTo != null
      ? { anchor: from + selectFrom, head: from + selectTo }
      : { anchor: detail.cursorOffset != null ? from + detail.cursorOffset : from + text.length };
    editorView.dispatch({
      changes: { from, insert: text },
      selection,
    });
  } else if (type === "heading") {
    const firstLine = editorView.state.doc.lineAt(from);
    const lastLine = editorView.state.doc.lineAt(to);
    const changes: Array<{ from: number; to: number; insert: string }> = [];
    for (let ln = firstLine.number; ln <= lastLine.number; ln++) {
      const lineObj = editorView.state.doc.line(ln);
      const stripped = lineObj.text.replace(/^=+\s*/, "");
      changes.push({ from: lineObj.from, to: lineObj.to, insert: text + stripped });
    }
    editorView.dispatch({ changes });
  } else if (type === "prefix") {
    const firstLine = editorView.state.doc.lineAt(from);
    const lastLine = editorView.state.doc.lineAt(to);
    const changes: Array<{ from: number; to: number; insert: string }> = [];
    for (let ln = firstLine.number; ln <= lastLine.number; ln++) {
      const lineObj = editorView.state.doc.line(ln);
      if (lineObj.text.startsWith(text)) {
        changes.push({ from: lineObj.from, to: lineObj.from + text.length, insert: "" });
      } else {
        changes.push({ from: lineObj.from, to: lineObj.from, insert: text });
      }
    }
    editorView.dispatch({ changes });
  } else if (type === "suffix") {
    const firstLine = editorView.state.doc.lineAt(from);
    const lastLine = editorView.state.doc.lineAt(to);
    const changes: Array<{ from: number; to: number; insert: string }> = [];
    for (let ln = firstLine.number; ln <= lastLine.number; ln++) {
      const lineObj = editorView.state.doc.line(ln);
      if (lineObj.text.endsWith(text)) {
        changes.push({ from: lineObj.to - text.length, to: lineObj.to, insert: "" });
      } else {
        changes.push({ from: lineObj.to, to: lineObj.to, insert: text });
      }
    }
    editorView.dispatch({ changes });
  } else if (type === "transform") {
    const selected = editorView.state.sliceDoc(from, to);
    if (!selected) return;
    const transformed = applyTextTransform(selected, detail.transform);
    if (transformed !== selected) {
      editorView.dispatch({
        changes: { from, to, insert: transformed },
        selection: { anchor: from, head: from + transformed.length },
      });
    }
  } else if (type === "remove-highlight") {
    removeHighlightMarkup();
  }

  editorView.focus();
}

// =====================================================
// Editor panel options (for ribbon Editor tab)
// =====================================================

function updateLineNumbers() {
  if (!editorView) return;
  const show = showLineNumbers;
  editorView.dispatch({
    effects: lineNumbersCompartment.reconfigure(
      show ? [lineNumbers(), highlightActiveLineGutter()] : []
    ),
  });
}

function updateBlockShading() {
  if (!editorView) return;
  editorView.dom.style.setProperty("--lp-block-shading-hover", specialBlockShading ? "1" : "0");
}

function updateCompactSpacing() {
  const root = document.getElementById("asciidoc-editor-root");
  if (root) root.classList.toggle("compact-spacing", compactSpacingEnabled);
  setCompactSpacing(compactSpacingEnabled);
  if (editorView) refreshLivePreview(editorView);
}

function updateSpellcheck() {
  const mode = effectiveSpellcheckMode();
  setSpellcheckMode(mode);
  if (!editorView) return;
  editorView.dispatch({
    effects: spellcheckCompartment.reconfigure(spellcheckExtension(mode)),
  });
  if (mode === "nspell") refreshSpellcheck(editorView);
}

// =====================================================
// Fullscreen mode
// =====================================================

let isFullscreen = false; // never persisted — always starts off
const FULLSCREEN_EXTRA_MARGIN = 0;
let autoHideToolbar = localStorage.getItem("asciidoc-autohide-toolbar") === "true";

let autoHideTrigger: HTMLElement | null = null;
let autoHideTimeout: any = null;

function setAutoHideToolbar(enabled: boolean) {
  autoHideToolbar = enabled;
  const root = document.getElementById("asciidoc-editor-root");
  if (!root) return;
  root.classList.toggle("autohide-toolbar", enabled);

  const ribbonContainer = document.getElementById("ribbon-container");
  if (!ribbonContainer) return;

  // Clean up previous trigger zone
  if (autoHideTrigger) {
    autoHideTrigger.remove();
    autoHideTrigger = null;
  }

  if (!enabled) {
    ribbonContainer.classList.remove("autohide-visible");
    return;
  }

  // Create an invisible trigger zone at the very top of the root
  const trigger = document.createElement("div");
  trigger.style.cssText = "position:absolute;top:0;left:0;right:0;height:10px;z-index:101";
  root.appendChild(trigger);
  autoHideTrigger = trigger;

  function showRibbon() {
    clearTimeout(autoHideTimeout);
    ribbonContainer!.classList.add("autohide-visible");
  }

  function hideRibbon() {
    clearTimeout(autoHideTimeout);
    autoHideTimeout = setTimeout(() => {
      ribbonContainer!.classList.remove("autohide-visible");
    }, 300);
  }

  trigger.addEventListener("mouseenter", showRibbon);
  ribbonContainer.addEventListener("mouseenter", showRibbon);
  ribbonContainer.addEventListener("mouseleave", hideRibbon);
  // Keep ribbon visible when pointer is above it (in the title bar area)
  trigger.addEventListener("mouseleave", (e) => {
    // Only hide if pointer moved downward (into editor), not upward (into title bar)
    const rect = trigger.getBoundingClientRect();
    if ((e as MouseEvent).clientY > rect.bottom) {
      // Pointer moved down — check if it entered the ribbon
      // Give a brief delay so mouseenter on ribbon can cancel
      hideRibbon();
    }
    // If pointer moved up (into title bar), keep ribbon visible
  });
}

function setFullscreen(enabled: boolean) {
  isFullscreen = enabled;
  const root = document.getElementById("asciidoc-editor-root");
  if (!root) return;
  if (enabled) {
    root.classList.add("fullscreen-mode");
    document.documentElement.style.setProperty("--fullscreen-margin", `${FULLSCREEN_EXTRA_MARGIN}px`);
  } else {
    root.classList.remove("fullscreen-mode");
    document.documentElement.style.setProperty("--fullscreen-margin", "0px");
  }
  // Toggle Joplin sidebars via IPC
  setFullscreenMode(enabled).catch(e => console.error("[panel] Failed to toggle fullscreen sidebars:", e));
  // Sync the editor panel checkbox if it's currently visible
  root.querySelectorAll<HTMLInputElement>(".ribbon-panel .ribbon-toggle input[type=checkbox]").forEach(checkbox => {
    const label = checkbox.nextElementSibling?.textContent;
    if (label === "Fullscreen Mode" && checkbox.checked !== enabled) {
      checkbox.checked = enabled;
    }
  });
}

// =====================================================
// Snippet name prompt
// =====================================================

function showSnippetNamePrompt(view: EditorView, content: string) {
  // Remove any existing prompt
  document.querySelector(".snippet-name-prompt")?.remove();

  const coords = view.coordsAtPos(view.state.selection.main.head);
  const prompt = document.createElement("div");
  prompt.className = "snippet-name-prompt";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Snippet name";
  input.autocomplete = "off";
  input.spellcheck = false;

  const saveBtn = document.createElement("button");
  saveBtn.className = "snippet-prompt-save";
  saveBtn.textContent = "Save";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "snippet-prompt-cancel";
  cancelBtn.textContent = "Cancel";

  const errorDiv = document.createElement("div");
  errorDiv.className = "snippet-prompt-error";
  errorDiv.style.display = "none";

  prompt.append(input, saveBtn, cancelBtn, errorDiv);

  // Position near cursor
  const editorRect = view.dom.getBoundingClientRect();
  if (coords) {
    prompt.style.top = (coords.bottom - editorRect.top + 4) + "px";
    prompt.style.left = Math.max(0, coords.left - editorRect.left) + "px";
  } else {
    prompt.style.top = "40px";
    prompt.style.left = "20px";
  }

  const close = () => prompt.remove();

  const save = async () => {
    let name = input.value.trim();
    if (!name) {
      // Default to first ~20 chars of content, cleaned up
      name = content.replace(/\n/g, " ").trim().slice(0, 20).trim();
      if (content.length > 20) name += "\u2026";
      if (!name) { input.focus(); return; }
      input.value = name;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    try {
      const result = await addSnippet(name, content);
      if (result.status === "ok" && result.snippet) {
        snippets = [...snippets, result.snippet].sort((a, b) => a.name.localeCompare(b.name));
        window.dispatchEvent(new CustomEvent("snippets-changed"));
        close();
      } else {
        errorDiv.textContent = result.error || "Failed to save";
        errorDiv.style.display = "";
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
      }
    } catch {
      errorDiv.textContent = "Failed to save snippet";
      errorDiv.style.display = "";
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  };

  saveBtn.addEventListener("click", save);
  cancelBtn.addEventListener("click", close);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    if (e.key === "Escape") { e.preventDefault(); close(); }
  });

  view.dom.appendChild(prompt);
  input.focus();
}

// =====================================================
// Find/Replace panel
// =====================================================

const SEARCH_ICON_PREV = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3.5,9.5 8,5 12.5,9.5"/></svg>`;
const SEARCH_ICON_NEXT = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3.5,6.5 8,11 12.5,6.5"/></svg>`;
const SEARCH_ICON_CLOSE = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`;
const SEARCH_ICON_CHEVRON = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,4 10,8 6,12"/></svg>`;
const SEARCH_ICON_REPLACE = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h6a3 3 0 0 1 0 6H5l2-2M7 12l-2-2"/></svg>`;
const SEARCH_ICON_REPLACE_ALL = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a3 3 0 0 1 0 6H4l2-2M6 11l-2-2"/><path d="M9 7h5"/><path d="M9 10h5"/><path d="M9 13h5"/></svg>`;

class SearchMatchLineMarker extends GutterMarker {
  override elementClass = "adl-search-line-match";
}
const searchMatchLineMarker = new SearchMatchLineMarker();

interface SearchScope { readonly from: number; readonly to: number; }

const setSearchScope = StateEffect.define<SearchScope | null>();

const searchScopeField = StateField.define<SearchScope | null>({
  create() { return null; },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSearchScope)) return effect.value;
    }
    if (value !== null && tr.docChanged) {
      const from = tr.changes.mapPos(value.from, 1);
      const to = tr.changes.mapPos(value.to, -1);
      if (from >= to) return null;
      return { from, to };
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (scope) => {
    if (scope === null) return Decoration.none;
    return Decoration.set([
      Decoration.mark({ class: "adl-search-scope" }).range(scope.from, scope.to),
    ]);
  }),
});

function computeSearchLineMarkers(state: EditorState): RangeSet<GutterMarker> {
  if (!searchPanelOpen(state)) return RangeSet.empty;
  const q = getSearchQuery(state);
  if (!q.valid || !q.search) return RangeSet.empty;
  const scope = state.field(searchScopeField);
  const builder = new RangeSetBuilder<GutterMarker>();
  let lastLineNumber = -1;
  try {
    const cursor = (scope === null
      ? q.getCursor(state)
      : q.getCursor(state, scope.from, scope.to)) as Iterator<{ from: number; to: number }>;
    let next = cursor.next();
    let safety = 0;
    while (!next.done && safety++ < 100000) {
      const line = state.doc.lineAt(next.value.from);
      if (line.number !== lastLineNumber) {
        lastLineNumber = line.number;
        builder.add(line.from, line.from, searchMatchLineMarker);
      }
      next = cursor.next();
    }
  } catch {}
  return builder.finish();
}

const searchMatchLineField = StateField.define<RangeSet<GutterMarker>>({
  create(state) {
    return computeSearchLineMarkers(state);
  },
  update(value, tr) {
    const queryEffectChange = tr.effects.some((effect) => effect.is(setSearchQuery));
    const scopeEffectChange = tr.effects.some((effect) => effect.is(setSearchScope));
    const panelToggled = searchPanelOpen(tr.startState) !== searchPanelOpen(tr.state);
    if (tr.docChanged || queryEffectChange || scopeEffectChange || panelToggled) {
      return computeSearchLineMarkers(tr.state);
    }
    return value;
  },
  provide: (field) => gutterLineClass.from(field),
});

function armScopeFromSelection(view: EditorView): void {
  const sel = view.state.selection.main;
  if (sel.from === sel.to) return;
  const fromLine = view.state.doc.lineAt(sel.from).number;
  const toLine = view.state.doc.lineAt(sel.to).number;
  if (toLine > fromLine) {
    view.dispatch({ effects: setSearchScope.of({ from: sel.from, to: sel.to }) });
  }
}

type ReplacementMatch = { match?: RegExpExecArray | string[] };
function getReplacementFor(q: SearchQuery, match: ReplacementMatch): string {
  return (q as unknown as { getReplacement(m: ReplacementMatch): string }).getReplacement(match);
}

function findNextInScope(view: EditorView): boolean {
  const scope = view.state.field(searchScopeField);
  if (scope === null) return findNext(view);
  const q = getSearchQuery(view.state);
  if (!q.valid || !q.search) return false;
  const sel = view.state.selection.main;
  const startFrom = sel.to >= scope.from && sel.to <= scope.to ? sel.to : scope.from;
  const findFirst = (from: number): { from: number; to: number } | null => {
    try {
      const cursor = q.getCursor(view.state, from, scope.to) as Iterator<{ from: number; to: number }>;
      const next = cursor.next();
      return next.done ? null : next.value;
    } catch { return null; }
  };
  let match = findFirst(startFrom);
  if (!match) match = findFirst(scope.from);
  if (!match) return false;
  view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true, userEvent: "select.search" });
  return true;
}

function findPrevInScope(view: EditorView): boolean {
  const scope = view.state.field(searchScopeField);
  if (scope === null) return findPrevious(view);
  const q = getSearchQuery(view.state);
  if (!q.valid || !q.search) return false;
  const anchor = view.state.selection.main.from >= scope.from && view.state.selection.main.from <= scope.to
    ? view.state.selection.main.from
    : scope.to;
  const matches: Array<{ from: number; to: number }> = [];
  try {
    const cursor = q.getCursor(view.state, scope.from, scope.to) as Iterator<{ from: number; to: number }>;
    let next = cursor.next();
    let safety = 0;
    while (!next.done && safety++ < 100000) {
      matches.push(next.value);
      next = cursor.next();
    }
  } catch {}
  if (matches.length === 0) return false;
  let chosen = matches[matches.length - 1];
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].to <= anchor) {
      chosen = matches[i];
      break;
    }
  }
  view.dispatch({ selection: { anchor: chosen.from, head: chosen.to }, scrollIntoView: true, userEvent: "select.search" });
  return true;
}

function replaceNextInScope(view: EditorView): boolean {
  const scope = view.state.field(searchScopeField);
  if (scope === null) return replaceNext(view);
  const q = getSearchQuery(view.state);
  if (!q.valid || !q.search) return false;
  const sel = view.state.selection.main;
  if (!(sel.from >= scope.from && sel.to <= scope.to && sel.from < sel.to)) return findNextInScope(view);
  let currentMatch: { from: number; to: number; match?: RegExpExecArray | string[] } | null = null;
  try {
    const cursor = q.getCursor(view.state, sel.from, sel.to) as Iterator<{ from: number; to: number; match?: RegExpExecArray | string[] }>;
    const next = cursor.next();
    if (!next.done && next.value.from === sel.from && next.value.to === sel.to) currentMatch = next.value;
  } catch {}
  if (!currentMatch) return findNextInScope(view);
  const replacement = getReplacementFor(q, currentMatch);
  const changes = view.state.changes({ from: sel.from, to: sel.to, insert: replacement });
  view.dispatch({ changes, userEvent: "input.replace" });
  return true;
}

function replaceAllInScope(view: EditorView): boolean {
  const scope = view.state.field(searchScopeField);
  if (scope === null) return replaceAll(view);
  const q = getSearchQuery(view.state);
  if (!q.valid || !q.search) return false;
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  try {
    const cursor = q.getCursor(view.state, scope.from, scope.to) as Iterator<{ from: number; to: number; match?: RegExpExecArray | string[] }>;
    let next = cursor.next();
    let safety = 0;
    while (!next.done && safety++ < 100000) {
      changes.push({ from: next.value.from, to: next.value.to, insert: getReplacementFor(q, next.value) });
      next = cursor.next();
    }
  } catch {}
  if (changes.length === 0) return false;
  view.dispatch({ changes, userEvent: "input.replace.all" });
  return true;
}

function closeSearchPanelAndClearScope(view: EditorView): boolean {
  if (view.state.field(searchScopeField) !== null) {
    view.dispatch({ effects: setSearchScope.of(null) });
  }
  return closeSearchPanel(view);
}

function createFindReplacePanel(view: EditorView): Panel {
  const flags = loadSearchFlags();
  let expanded = loadSearchExpanded();

  const root = document.createElement("div");
  root.className = "adl-search";
  root.setAttribute("role", "search");
  if (expanded) root.classList.add("adl-search--expanded");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "adl-search__icon adl-search__close";
  closeBtn.title = "Close";
  closeBtn.innerHTML = SEARCH_ICON_CLOSE;

  const chevron = document.createElement("button");
  chevron.type = "button";
  chevron.className = "adl-search__chevron";
  chevron.title = "Toggle replace";
  chevron.setAttribute("aria-expanded", expanded ? "true" : "false");
  chevron.innerHTML = SEARCH_ICON_CHEVRON;

  const rows = document.createElement("div");
  rows.className = "adl-search__rows";

  const findRow = document.createElement("div");
  findRow.className = "adl-search__row adl-search__row--find";
  const findField = document.createElement("div");
  findField.className = "adl-search__field";
  const findInput = document.createElement("input");
  findInput.type = "text";
  findInput.className = "adl-search__input";
  findInput.setAttribute("main-field", "true");
  findInput.setAttribute("name", "search");
  findInput.placeholder = "Find";
  const counter = document.createElement("span");
  counter.className = "adl-search__counter";
  counter.setAttribute("aria-live", "polite");
  findField.append(findInput, counter);

  const toggles = document.createElement("div");
  toggles.className = "adl-search__toggles";
  const toggleDefs: Array<{ flag: keyof SearchFlags; label: string; title: string }> = [
    { flag: "caseSensitive", label: "Aa", title: "Match case" },
    { flag: "wholeWord", label: "ab|", title: "Whole word" },
    { flag: "regexp", label: ".*", title: "Regular expression" },
  ];
  const toggleButtons = Object.create(null) as Record<keyof SearchFlags, HTMLButtonElement>;
  for (const def of toggleDefs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "adl-search__toggle";
    btn.title = def.title;
    btn.setAttribute("aria-label", def.title);
    btn.setAttribute("aria-pressed", flags[def.flag] ? "true" : "false");
    btn.textContent = def.label;
    toggleButtons[def.flag] = btn;
    toggles.appendChild(btn);
  }

  const inSelectionBtn = document.createElement("button");
  inSelectionBtn.type = "button";
  inSelectionBtn.className = "adl-search__toggle";
  inSelectionBtn.title = "Find in selection";
  inSelectionBtn.setAttribute("aria-label", "Find in selection");
  inSelectionBtn.setAttribute("aria-pressed", "false");
  inSelectionBtn.textContent = "[ ]";
  toggles.appendChild(inSelectionBtn);

  const nav = document.createElement("div");
  nav.className = "adl-search__nav";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "adl-search__icon";
  prevBtn.title = "Previous match";
  prevBtn.innerHTML = SEARCH_ICON_PREV;
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "adl-search__icon";
  nextBtn.title = "Next match";
  nextBtn.innerHTML = SEARCH_ICON_NEXT;
  nav.append(prevBtn, nextBtn);

  const sep1 = document.createElement("span");
  sep1.className = "adl-search__sep";
  const sep2 = document.createElement("span");
  sep2.className = "adl-search__sep";
  findRow.append(findField, sep1, toggles, sep2, nav);

  const replaceRow = document.createElement("div");
  replaceRow.className = "adl-search__row adl-search__row--replace";
  const replaceField = document.createElement("div");
  replaceField.className = "adl-search__field";
  const replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.className = "adl-search__input";
  replaceInput.setAttribute("name", "replace");
  replaceInput.placeholder = "Replace";
  replaceField.appendChild(replaceInput);
  const replaceNav = document.createElement("div");
  replaceNav.className = "adl-search__nav";
  const replaceBtn = document.createElement("button");
  replaceBtn.type = "button";
  replaceBtn.className = "adl-search__icon";
  replaceBtn.title = "Replace";
  replaceBtn.innerHTML = SEARCH_ICON_REPLACE;
  const replaceAllBtn = document.createElement("button");
  replaceAllBtn.type = "button";
  replaceAllBtn.className = "adl-search__icon";
  replaceAllBtn.title = "Replace all";
  replaceAllBtn.innerHTML = SEARCH_ICON_REPLACE_ALL;
  replaceNav.append(replaceBtn, replaceAllBtn);
  const sep3 = document.createElement("span");
  sep3.className = "adl-search__sep";
  replaceRow.append(replaceField, sep3, replaceNav);

  rows.append(findRow, replaceRow);
  root.append(closeBtn, chevron, rows);

  const buildQuery = (overrides: Partial<{ search: string; replace: string } & SearchFlags> = {}) => new SearchQuery({
    search: overrides.search ?? findInput.value,
    replace: overrides.replace ?? replaceInput.value,
    caseSensitive: overrides.caseSensitive ?? flags.caseSensitive,
    wholeWord: overrides.wholeWord ?? flags.wholeWord,
    regexp: overrides.regexp ?? flags.regexp,
  });

  const dispatchQuery = (q: SearchQuery) => view.dispatch({ effects: setSearchQuery.of(q) });

  const updateCounter = () => {
    const q = getSearchQuery(view.state);
    if (!q.search) {
      counter.textContent = "";
      prevBtn.disabled = nextBtn.disabled = replaceBtn.disabled = replaceAllBtn.disabled = true;
      root.classList.remove("adl-search--no-results");
      return;
    }
    if (!q.valid) {
      counter.textContent = "Invalid";
      prevBtn.disabled = nextBtn.disabled = replaceBtn.disabled = replaceAllBtn.disabled = true;
      root.classList.add("adl-search--no-results");
      return;
    }
    const scope = view.state.field(searchScopeField);
    const matches: Array<{ from: number; to: number }> = [];
    try {
      const cursor = (scope === null ? q.getCursor(view.state) : q.getCursor(view.state, scope.from, scope.to)) as Iterator<{ from: number; to: number }>;
      let next = cursor.next();
      let safety = 0;
      while (!next.done && safety++ < 100000) {
        matches.push(next.value);
        next = cursor.next();
      }
    } catch {}
    if (matches.length === 0) {
      counter.textContent = "No results";
      prevBtn.disabled = nextBtn.disabled = replaceBtn.disabled = replaceAllBtn.disabled = true;
      root.classList.add("adl-search--no-results");
      return;
    }
    const cursorPos = view.state.selection.main.from;
    let idx = matches.findIndex((match) => match.from >= cursorPos);
    if (idx === -1) idx = matches.length - 1;
    counter.textContent = `${idx + 1} of ${matches.length}`;
    prevBtn.disabled = nextBtn.disabled = replaceBtn.disabled = replaceAllBtn.disabled = false;
    root.classList.remove("adl-search--no-results");
  };

  findInput.addEventListener("input", () => dispatchQuery(buildQuery({ search: findInput.value })));
  replaceInput.addEventListener("input", () => dispatchQuery(buildQuery({ replace: replaceInput.value })));
  for (const def of toggleDefs) {
    const btn = toggleButtons[def.flag];
    btn.addEventListener("click", () => {
      flags[def.flag] = !flags[def.flag];
      btn.setAttribute("aria-pressed", flags[def.flag] ? "true" : "false");
      saveSearchFlags(flags);
      dispatchQuery(buildQuery());
      findInput.focus();
    });
  }

  inSelectionBtn.addEventListener("click", () => {
    const current = view.state.field(searchScopeField);
    if (current !== null) {
      view.dispatch({ effects: setSearchScope.of(null) });
    } else {
      armScopeFromSelection(view);
    }
    findInput.focus();
  });
  prevBtn.addEventListener("click", () => { findPrevInScope(view); findInput.focus(); });
  nextBtn.addEventListener("click", () => { findNextInScope(view); findInput.focus(); });
  replaceBtn.addEventListener("click", () => { replaceNextInScope(view); replaceInput.focus(); });
  replaceAllBtn.addEventListener("click", () => { replaceAllInScope(view); findInput.focus(); });
  closeBtn.addEventListener("click", () => { closeSearchPanelAndClearScope(view); });
  chevron.addEventListener("click", () => {
    expanded = !expanded;
    root.classList.toggle("adl-search--expanded", expanded);
    chevron.setAttribute("aria-expanded", expanded ? "true" : "false");
    saveSearchExpanded(expanded);
    findInput.focus();
  });

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanelAndClearScope(view);
      return;
    }
    if (e.altKey && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      inSelectionBtn.click();
      return;
    }
    const isMod = e.ctrlKey || e.metaKey;
    if (e.key === "Enter" && isMod && e.altKey) {
      e.preventDefault();
      replaceAllInScope(view);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.target === replaceInput) replaceNextInScope(view);
      else if (e.shiftKey) findPrevInScope(view);
      else findNextInScope(view);
    }
  });

  return {
    dom: root,
    top: true,
    mount() {
      const existing = getSearchQuery(view.state);
      findInput.value = existing.search ?? "";
      replaceInput.value = existing.replace ?? "";
      setTimeout(() => {
        if (!view.dom.isConnected) return;
        dispatchQuery(buildQuery({ search: findInput.value, replace: replaceInput.value }));
        updateCounter();
      }, 0);
      findInput.focus();
      findInput.select();
      updateCounter();
    },
    update() {
      const q = getSearchQuery(view.state);
      if (q.search !== findInput.value) findInput.value = q.search;
      if (q.replace !== replaceInput.value) replaceInput.value = q.replace;
      const scope = view.state.field(searchScopeField);
      const scopeActive = scope !== null;
      inSelectionBtn.setAttribute("aria-pressed", scopeActive ? "true" : "false");
      if (scopeActive) {
        inSelectionBtn.disabled = false;
      } else {
        const sel = view.state.selection.main;
        inSelectionBtn.disabled = sel.from === sel.to || view.state.doc.lineAt(sel.from).number === view.state.doc.lineAt(sel.to).number;
      }
      updateCounter();
    },
  };
}

// =====================================================
// Editor view modes
// =====================================================

function isRawPaneVisible(): boolean {
  return editorViewMode === "live-preview" || splitViewSubmode === "split" || splitViewSubmode === "raw";
}

function isRenderedPreviewVisible(): boolean {
  return editorViewMode === "split" && (splitViewSubmode === "split" || splitViewSubmode === "preview");
}

function updateEditorLayoutVisibility() {
  const layout = document.getElementById("editor-layout");
  const editorPane = document.getElementById("editor-pane");
  const divider = document.getElementById("editor-split-divider");
  const previewContainer = document.getElementById("preview-pane-container");
  if (!layout || !editorPane || !previewContainer) return;

  layout.dataset.viewMode = editorViewMode;
  layout.dataset.splitViewSubmode = splitViewSubmode;
  layout.style.setProperty("--split-raw-fraction", String(splitRawFraction));
  editorPane.hidden = !isRawPaneVisible();
  previewContainer.hidden = !isRenderedPreviewVisible();
  if (divider) divider.hidden = !(editorViewMode === "split" && splitViewSubmode === "split");
}

function clearRenderedPreviewTimer() {
  if (renderedPreviewTimer) {
    clearTimeout(renderedPreviewTimer);
    renderedPreviewTimer = null;
  }
}

function scheduleRenderedPreviewRender(delay = 250) {
  clearRenderedPreviewTimer();
  if (!isRenderedPreviewVisible()) return;
  const seq = ++renderedPreviewSeq;
  renderedPreviewTimer = setTimeout(async () => {
    renderedPreviewTimer = null;
    if (!editorView || !isRenderedPreviewVisible()) return;
    const pane = document.getElementById("preview-pane");
    if (!pane) return;
    const source = editorView.state.doc.toString();
    emitEditorDiagnostic("preview", "split-render", "start", { sequence: seq, sourceLength: source.length });
    try {
      const { html } = await renderAsciidoc(source);
      if (seq !== renderedPreviewSeq) return;
      pane.innerHTML = html;
      await resolveResources(source);
      for (const media of Array.from(pane.querySelectorAll<HTMLImageElement | HTMLMediaElement | HTMLSourceElement>("img[src], audio[src], video[src], source[src]"))) {
        const src = media.getAttribute("src") || "";
        const match = src.match(/^:\/?([a-f0-9]{32})/);
        if (match) {
          const cached = await requestResources([match[1]]);
          const dataUrl = cached.resources?.[0]?.dataUrl;
          if (dataUrl) media.setAttribute("src", dataUrl);
        }
      }
      emitEditorDiagnostic("preview", "split-render", "end", { sequence: seq, htmlLength: html.length });
    } catch (error) {
      if (seq !== renderedPreviewSeq) return;
      emitEditorDiagnostic("preview", "split-render", "error", { sequence: seq, message: String(error) });
      pane.innerHTML = `<div class="render-error"><h3>Render Error</h3><pre>${String(error).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch] || ch))}</pre></div>`;
    }
  }, delay);
}

function syncEditorPresentationMode(options: { restoreFocus?: boolean } = {}) {
  emitEditorDiagnostic("editor", "presentation-mode", "start", { editorViewMode, splitViewSubmode });
  updateEditorLayoutVisibility();
  if (editorView) {
    editorView.dispatch({
      effects: livePreviewCompartment.reconfigure(editorViewMode === "live-preview" ? [livePreview()] : []),
    });
    requestAnimationFrame(() => {
      editorView?.requestMeasure();
      if (editorViewMode === "live-preview" && editorView) {
        refreshLivePreview(editorView);
      }
      if (isRenderedPreviewVisible()) scheduleRenderedPreviewRender(0);
      if (options.restoreFocus !== false && isRawPaneVisible()) editorView?.focus();
      emitEditorDiagnostic("editor", "presentation-mode", "end", { editorViewMode, splitViewSubmode });
    });
  }
  if (!isRenderedPreviewVisible()) {
    clearRenderedPreviewTimer();
  }
}

function installSplitDivider() {
  const layout = document.getElementById("editor-layout");
  const divider = document.getElementById("editor-split-divider");
  if (!layout || !divider) return;

  let dragging = false;
  const move = (event: PointerEvent) => {
    if (!dragging) return;
    const rect = layout.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / Math.max(1, rect.width);
    splitRawFraction = Math.min(0.85, Math.max(0.15, fraction));
    localStorage.setItem("asciidoc-editor-split-fraction", String(splitRawFraction));
    layout.style.setProperty("--split-raw-fraction", String(splitRawFraction));
    editorView?.requestMeasure();
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove("is-dragging");
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", end, true);
    window.removeEventListener("pointercancel", end, true);
  };
  divider.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    divider.classList.add("is-dragging");
    divider.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    event.preventDefault();
  });
}

// =====================================================
// Create CM6 editor
// =====================================================

function createEditor(container: HTMLElement, content: string) {
  emitEditorDiagnostic("editor", "create", "start", { contentLength: content.length });
  if (editorView) {
    editorView.destroy();
    editorView = null;
  }

  const state = EditorState.create({
    doc: content,
    extensions: [
      lineNumbersCompartment.of(showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
      searchMatchLineField,
      searchScopeField,
      highlightActiveLine(),
      drawSelection(),
      bracketMatching(),
      history(),
      highlightSelectionMatches(),
      search({ top: true, createPanel: createFindReplacePanel }),
      EditorState.phrases.of({ regexp: "RegExp" }),
      placeholder("Write AsciiDoc here..."),
      asciidocLanguage(),
      spellcheckCompartment.of(currentSpellcheckExtension()),
      wikiLinkCompletion([includeCompletionSource, snippetCompletionSource, attributeCompletionSource]),
      includeCompletionTrigger,
      EditorView.inputHandler.of((view, from, _to, text) => {
        if (text === "@" && snippets.length > 0) {
          const charBefore = from > 0 ? view.state.sliceDoc(from - 1, from) : "";
          if (charBefore === "@") {
            snippetCompletionActive = true;
            snippetTriggerIsInline = true;
            snippetTriggerPos = from - 1;
            setTimeout(() => startCompletion(view), 0);
          }
        }
        return false;
      }),
      keymap.of([
        ...asciidocKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      // High-priority Mod-f/Mod-h to ensure CM6 search opens even if host app tries to intercept
      Prec.highest(keymap.of([
        { key: "Mod-f", run: (view) => { armScopeFromSelection(view); return openSearchPanel(view); }, scope: "editor search-panel" },
        { key: "Mod-Shift-f", run: (view) => { saveSearchExpanded(true); armScopeFromSelection(view); return openSearchPanel(view); }, scope: "editor search-panel" },
        { key: "Mod-h", run: (view) => { saveSearchExpanded(true); armScopeFromSelection(view); return openSearchPanel(view); }, scope: "editor search-panel" },
        { key: "Escape", run: closeSearchPanelAndClearScope },
        // Emacs-style line navigation
        { key: "Mod-Shift-a", run: (view) => {
          const line = view.state.doc.lineAt(view.state.selection.main.head);
          view.dispatch({ selection: { anchor: line.from } });
          return true;
        }},
        { key: "Mod-Shift-e", run: (view) => {
          const line = view.state.doc.lineAt(view.state.selection.main.head);
          view.dispatch({ selection: { anchor: line.to } });
          return true;
        }},
        // Kill to end of line
        { key: "Mod-Shift-k", run: (view) => {
          const head = view.state.selection.main.head;
          const line = view.state.doc.lineAt(head);
          if (head < line.to) {
            view.dispatch({ changes: { from: head, to: line.to } });
          }
          return true;
        }},
        // Forward-delete (delete character ahead of cursor)
        { key: "Mod-Shift-d", run: (view) => {
          const head = view.state.selection.main.head;
          if (head < view.state.doc.length) {
            view.dispatch({ changes: { from: head, to: head + 1 } });
          }
          return true;
        }},
        // Transpose characters around cursor
        { key: "Mod-Shift-t", run: (view) => {
          const head = view.state.selection.main.head;
          const line = view.state.doc.lineAt(head);
          if (head > line.from && head < line.to) {
            const before = view.state.doc.sliceString(head - 1, head);
            const after = view.state.doc.sliceString(head, head + 1);
            view.dispatch({
              changes: { from: head - 1, to: head + 1, insert: after + before },
              selection: { anchor: head + 1 },
            });
          } else if (head === line.to && head - 2 >= line.from) {
            // At end of line: swap the two characters before cursor
            const a = view.state.doc.sliceString(head - 2, head - 1);
            const b = view.state.doc.sliceString(head - 1, head);
            view.dispatch({
              changes: { from: head - 2, to: head, insert: b + a },
            });
          }
          return true;
        }},
        // Open new line below cursor
        { key: "Mod-Shift-o", run: (view) => {
          const line = view.state.doc.lineAt(view.state.selection.main.head);
          view.dispatch({
            changes: { from: line.to, insert: "\n" },
            selection: { anchor: line.to + 1 },
          });
          return true;
        }},
        // Snippet Templates: save selection as named snippet
        { key: "Mod-Shift-c", run: (view) => {
          const sel = view.state.selection.main;
          if (sel.from === sel.to) return false;
          const text = view.state.sliceDoc(sel.from, sel.to);
          navigator.clipboard.writeText(text).catch(() => {});
          showSnippetNamePrompt(view, text);
          return true;
        }},
        // Snippet Templates: insert from list
        { key: "Mod-Shift-v", run: (view) => {
          if (snippets.length === 0) return false;
          snippetCompletionActive = true;
          snippetTriggerIsInline = false;
          snippetTriggerPos = view.state.selection.main.head;
          startCompletion(view);
          return true;
        }},
      ])),
      // Clear snippet autocomplete flag when completion closes
      EditorView.updateListener.of((update) => {
        if (snippetCompletionActive && completionStatus(update.state) === null) {
          snippetCompletionActive = false;
        }
      }),
      // Prevent right-click from losing selection (so context menu works on raw text)
      EditorView.domEventHandlers({
        mousedown(event: MouseEvent, view: EditorView) {
          if (event.button === 2) {
            const sel = view.state.selection.main;
            if (sel.from !== sel.to) {
              // Right-click with active selection — prevent CM6 from moving cursor
              event.preventDefault();
              return true;
            }
          }
          return false;
        },
      }),
      livePreviewCompartment.of(editorViewMode === "live-preview" ? [livePreview()] : []),
      // Enhance CM6 search panel with match counter and remove "all" button
      ViewPlugin.fromClass(class {
        private counterEl: HTMLElement | null = null;
        private panelOpen = false;
        private boundInputHandler: (() => void) | null = null;

        constructor(private view: EditorView) {}

        update() {
          const panel = this.view.dom.querySelector(".cm-panel.cm-search") as HTMLElement | null;
          if (!panel) {
            this.counterEl = null;
            this.panelOpen = false;
            this.boundInputHandler = null;
            return;
          }

          // One-time setup when panel first appears
          if (!this.panelOpen) {
            this.panelOpen = true;

            // Remove "all" button
            for (const btn of panel.querySelectorAll<HTMLButtonElement>(".cm-button")) {
              if (btn.textContent?.trim().toLowerCase() === "all") {
                btn.remove();
                break;
              }
            }

            // Create and inject counter element
            const searchInput = panel.querySelector<HTMLInputElement>(".cm-textfield");
            if (searchInput) {
              this.counterEl = document.createElement("span");
              this.counterEl.className = "cm-search-match-counter";
              searchInput.parentNode!.insertBefore(this.counterEl, searchInput.nextSibling);

              this.boundInputHandler = () => this.updateCounter();
              searchInput.addEventListener("input", this.boundInputHandler);
              // Also listen for checkbox changes (case, regex, by word)
              for (const cb of panel.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) {
                cb.addEventListener("change", this.boundInputHandler);
              }
            }
          }

          this.updateCounter();
        }

        updateCounter() {
          if (!this.counterEl) return;
          const panel = this.view.dom.querySelector(".cm-panel.cm-search");
          if (!panel) return;
          const searchInput = panel.querySelector<HTMLInputElement>(".cm-textfield");
          const query = searchInput?.value || "";

          if (!query) {
            this.counterEl.textContent = "";
            return;
          }

          // Read checkbox states
          let caseSensitive = false;
          let isRegex = false;
          for (const label of panel.querySelectorAll("label")) {
            const text = label.textContent?.toLowerCase() || "";
            const cb = label.querySelector<HTMLInputElement>("input[type=checkbox]");
            if (!cb) continue;
            if (text.includes("case")) caseSensitive = cb.checked;
            if (text.includes("regexp") || text.includes("regex")) isRegex = cb.checked;
          }

          // Count matches
          const doc = this.view.state.doc.toString();
          let matchPositions: number[] = [];
          try {
            if (isRegex) {
              const re = new RegExp(query, caseSensitive ? "g" : "gi");
              let m;
              while ((m = re.exec(doc)) !== null) {
                matchPositions.push(m.index);
                if (m[0].length === 0) re.lastIndex++;
              }
            } else {
              const searchDoc = caseSensitive ? doc : doc.toLowerCase();
              const searchQuery = caseSensitive ? query : query.toLowerCase();
              let pos = 0;
              while ((pos = searchDoc.indexOf(searchQuery, pos)) !== -1) {
                matchPositions.push(pos);
                pos += searchQuery.length || 1;
              }
            }
          } catch {
            matchPositions = [];
          }

          const count = matchPositions.length;
          const cursor = this.view.state.selection.main.from;
          let idx = 0;
          if (count > 0) {
            for (let i = 0; i < count; i++) {
              if (matchPositions[i] <= cursor) idx = i + 1;
            }
            if (idx === 0) idx = 1;
          }

          this.counterEl.textContent = count > 0 ? `${idx} / ${count}` : "0 / 0";
        }

        destroy() {}
      }),
      // Smart Quotes: convert straight quotes to curly quotes, with prime/double-prime support
      EditorView.inputHandler.of((view, from, _to, text) => {
        if (!isSmartQuotesEnabled()) return false;
        if (text !== '"' && text !== "'") return false;
        const sel = view.state.selection.main;
        if (sel.from !== sel.to) return false; // don't interfere with selection wrapping

        const before = from > 0 ? view.state.doc.sliceString(from - 1, from) : "";
        const after = from < view.state.doc.length ? view.state.doc.sliceString(from, from + 1) : "";

        // Override: pressing quote right after a prime/double-prime reverts it
        if (text === "'" && before === "\u2032") {
          view.dispatch({
            changes: { from: from - 1, to: from, insert: "'" },
          });
          return true;
        }
        if (text === '"' && before === "\u2033") {
          view.dispatch({
            changes: { from: from - 1, to: from, insert: '"' },
          });
          return true;
        }

        // Single prime: ' after a digit, with no letter immediately following
        if (text === "'" && /\d/.test(before) && (after === "" || !/[a-zA-Z]/.test(after))) {
          view.dispatch({
            changes: { from, to: from, insert: "\u2032" },
            selection: { anchor: from + 1 },
          });
          return true;
        }

        // Double prime: " after a digit, only if a prime precedes the digits
        if (text === '"' && /\d/.test(before)) {
          const lookback = view.state.doc.sliceString(Math.max(0, from - 20), from);
          if (/\u2032\d+$/.test(lookback)) {
            view.dispatch({
              changes: { from, to: from, insert: "\u2033" },
              selection: { anchor: from + 1 },
            });
            return true;
          }
        }

        // Standard curly quotes: open vs close based on preceding character
        const isOpen = !before || /[\s(\[{]/.test(before);
        let replacement: string;
        if (text === '"') {
          replacement = isOpen ? "\u201C" : "\u201D";
        } else {
          replacement = isOpen ? "\u2018" : "\u2019";
        }

        view.dispatch({
          changes: { from, to: from, insert: replacement },
          selection: { anchor: from + replacement.length },
        });
        return true;
      }),
      // Auto-pair quotes/brackets around selections
      EditorView.inputHandler.of((view, from, _to, text) => {
        const pairs: Record<string, string> = { '"': '"', "'": "'", '(': ')', '[': ']', '{': '}' };
        const closing = pairs[text];
        if (!closing) return false;
        const sel = view.state.selection.main;
        if (sel.from === sel.to) return false;
        const selected = view.state.sliceDoc(sel.from, sel.to);
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text + selected + closing },
          selection: { anchor: sel.from + 1, head: sel.from + 1 + selected.length },
        });
        return true;
      }),
      EditorView.lineWrapping,
      // Hard line break workaround: {empty} + acts as "split line here"
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        const doc = update.state.doc;
        const changes: Array<{ from: number; to: number; insert: string }> = [];
        update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
          const startLine = doc.lineAt(fromB).number;
          const endLine = doc.lineAt(Math.min(toB, doc.length)).number;
          for (let ln = startLine; ln <= endLine; ln++) {
            const line = doc.line(ln);
            const idx = line.text.indexOf("{empty} +");
            if (idx !== -1) {
              const before = line.text.substring(0, idx);
              const after = line.text.substring(idx + "{empty} +".length);
              const insert = after.trimStart() ? before + "\n" + after.trimStart() : before;
              changes.push({ from: line.from, to: line.to, insert });
            }
          }
        });
        if (changes.length > 0) {
          requestAnimationFrame(() => update.view.dispatch({ changes }));
        }
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          if (suppressNextDocChange) {
            suppressNextDocChange = false;
            return;
          }
          scheduleSave();
          scheduleRenderedPreviewRender();
        }
      }),
      EditorView.theme({
        ".cm-scroller": {
          overflow: "auto",
          position: "relative",
        },
      }),
    ],
  });

  editorView = new EditorView({
    state,
    parent: container,
  });
  emitEditorDiagnostic("editor", "create", "end", { contentLength: content.length });

  updateBlockShading();
  updateCompactSpacing();
}

// =====================================================
// Message handling from plugin sandbox
// =====================================================

function handleMessage(msg: any) {
  if (!msg || !msg.type) return;
  emitEditorDiagnostic("transport", msg.type, "start", { direction: "push-apply" });

  if (msg.type === "updateNote") {
    const { id, body } = msg.value || {};
    if (!id || body == null) return;

    // Close any open floating section preview from the previous note
    closeFloatingPreview();

    // Force save current note before switching
    if (isDirty && currentNoteId && currentNoteId !== id) {
      forceSave();
    }

    const { content, sentinel } = stripSentinel(body || "");
    currentNoteId = id;
    setCurrentNoteId(id);
    currentSentinel = sentinel;
    isDirty = false;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    if (editorView) {
      const currentContent = editorView.state.doc.toString();

      // Skip replacement if content is identical (no-op)
      if (content === currentContent) {
        resolveResources(content);
        return;
      }

      // Skip if this is our own save echoing back via onUpdate but the user
      // has continued typing since — replacing with stale content would crash
      // CodeMirror (position out of range for changeset).
      if (id === currentNoteId && (content === lastSavedContent || isDirty || saveTimer)) {
        lastSavedContent = null;
        resolveResources(content);
        return;
      }
      lastSavedContent = null;

      suppressNextDocChange = true; // Don't trigger save for this programmatic update
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: content },
      });
      scheduleRenderedPreviewRender(0);
    }

    // Resolve Joplin resource URLs
    resolveResources(content);
    scheduleRenderedPreviewRender(0);
  }

  if (msg.type === "updateTheme") {
    hostDarkTheme = msg.value === "dark";
    applyEditorTheme();
  }

  if (msg.type === "updateEditorTheme") {
    hostDarkTheme = msg.isDark === true ? true : hostDarkTheme;
    editorThemeName = typeof msg.editorTheme === "string" ? msg.editorTheme : editorThemeName;
    mermaidThemeVariablesRaw = typeof msg.mermaidThemeVariables === "string" ? msg.mermaidThemeVariables : mermaidThemeVariablesRaw;
    applyEditorTheme();
  }

  if (msg.type === "updateCompactSpacing") {
    compactSpacingEnabled = msg.value === true;
    updateCompactSpacing();
  }

  if (msg.type === "updateAttributeAutocomplete") {
    attributeAutocompleteEnabled = msg.enabled !== false;
  }
  if (msg.type === "updateSpellCheck") {
    spellcheckEnabled = msg.enabled !== false;
    spellcheckMode = normalizeSpellcheckMode(msg.mode);
    localStorage.setItem("asciidoc-spellcheck-mode", spellcheckMode);
    updateSpellcheck();
    localStorage.setItem("asciidoc-spellcheck", String(spellcheckEnabled));
  }
  emitEditorDiagnostic("transport", msg.type, "end", { direction: "push-apply" });
}

// =====================================================
// Initialization
// =====================================================

function applyZoom(percent: number) {
  if (!editorView) return;
  const scroller = editorView.scrollDOM;
  const scrollRatio = scroller.scrollHeight > 0 ? scroller.scrollTop / scroller.scrollHeight : 0;

  editorView.dom.style.setProperty("--editor-scale", String(percent / 100));
  requestAnimationFrame(() => {
    if (!editorView) return;
    editorView.scrollDOM.scrollTop = scrollRatio * editorView.scrollDOM.scrollHeight;
    editorView.requestMeasure();
    refreshLivePreview(editorView);
  });
}

// =====================================================
// Custom right-click context menu
// =====================================================

let clipboardMenu: HTMLElement | null = null;

function dismissClipboardMenu() {
  if (clipboardMenu) {
    clipboardMenu.remove();
    clipboardMenu = null;
  }
}

function stripHtmlToPlainText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || div.innerText || "").trim();
}

async function copyRenderedAsciidoc(rawAsciiDoc: string): Promise<void> {
  const { html } = await renderAsciidoc(rawAsciiDoc);
  const plainText = stripHtmlToPlainText(html);
  try {
    const htmlBlob = new Blob([html], { type: "text/html" });
    const textBlob = new Blob([plainText], { type: "text/plain" });
    await navigator.clipboard.write([
      new ClipboardItem({ "text/html": htmlBlob, "text/plain": textBlob }),
    ]);
  } catch {
    await navigator.clipboard.writeText(plainText);
  }
}

async function pasteAsConverted(view: EditorView) {
  const clipText = await navigator.clipboard.readText();
  if (!clipText) return;
  const { asciidoc } = await convertMarkdownPaste(clipText);
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: asciidoc } });
}

function showClipboardContextMenu(view: EditorView, event: MouseEvent) {
  dismissClipboardMenu();

  // Capture selection state NOW — before any focus changes can lose it
  const sel = view.state.selection.main;
  const hasSelection = sel.from !== sel.to;
  const selFrom = sel.from;
  const selTo = sel.to;
  const selectedText = hasSelection ? view.state.sliceDoc(selFrom, selTo) : "";

  const menu = document.createElement("div");
  menu.className = "spell-context-menu";

  function addItem(label: string, enabled: boolean, action: () => void) {
    const el = document.createElement("div");
    el.className = "spell-context-menu-item";
    el.textContent = label;
    if (!enabled) {
      el.style.opacity = "0.4";
      el.style.pointerEvents = "none";
    }
    el.addEventListener("mousedown", (e) => {
      e.preventDefault(); e.stopPropagation();
      action();
      dismissClipboardMenu();
      view.focus();
    });
    menu.appendChild(el);
  }

  function addSeparator() {
    const sep = document.createElement("div");
    sep.className = "spell-context-menu-separator";
    menu.appendChild(sep);
  }

  // ── Cut section ──
  addItem("Cut", hasSelection, () => {
    navigator.clipboard.writeText(selectedText);
    view.dispatch({ changes: { from: selFrom, to: selTo, insert: "" } });
  });
  addItem("Cut as AsciiDoc Text", hasSelection, async () => {
    await copyRenderedAsciidoc(selectedText);
    view.dispatch({ changes: { from: selFrom, to: selTo, insert: "" } });
  });

  addSeparator();

  // ── Copy section ──
  addItem("Copy", hasSelection, () => {
    navigator.clipboard.writeText(selectedText);
  });
  addItem("Copy as AsciiDoc Text", hasSelection, () => {
    copyRenderedAsciidoc(selectedText);
  });
  addItem("Copy as Snippet Template", hasSelection, () => {
    showSnippetNamePrompt(view, selectedText);
  });

  addSeparator();

  // ── Paste section ──
  addItem("Paste", true, async () => {
    const text = await navigator.clipboard.readText();
    if (text) {
      const pos = view.state.selection.main;
      view.dispatch({ changes: { from: pos.from, to: pos.to, insert: text } });
    }
  });
  addItem("Paste as Raw Text", true, async () => {
    const text = await navigator.clipboard.readText();
    if (text) {
      const pos = view.state.selection.main;
      view.dispatch({ changes: { from: pos.from, to: pos.to, insert: `++${text}++` } });
    }
  });
  addItem("Convert from Markdown & Paste", true, () => pasteAsConverted(view));

  addSeparator();

  // ── Select All ──
  addItem("Select All", true, () => {
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  });

  // Position menu
  menu.style.position = "fixed";
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  document.body.appendChild(menu);
  clipboardMenu = menu;

  // Adjust position if menu overflows viewport
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;
  });

  // Dismiss on click outside or Escape
  const dismissHandler = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      dismissClipboardMenu();
      document.removeEventListener("mousedown", dismissHandler, true);
      document.removeEventListener("keydown", escHandler, true);
    }
  };
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      dismissClipboardMenu();
      document.removeEventListener("mousedown", dismissHandler, true);
      document.removeEventListener("keydown", escHandler, true);
    }
  };
  setTimeout(() => {
    document.addEventListener("mousedown", dismissHandler, true);
    document.addEventListener("keydown", escHandler, true);
  }, 0);
}

function init() {
  const root = document.getElementById("asciidoc-editor-root");
  if (!root) return;

  // Restore persisted auto-hide toolbar
  if (autoHideToolbar) setAutoHideToolbar(true);

  // Restore persisted margin
  const savedMargin = parseInt(localStorage.getItem("asciidoc-editor-margin") || "0", 10);
  if (savedMargin > 0) {
    document.documentElement.style.setProperty("--content-margin", `${savedMargin}px`);
  }
  installSplitDivider();
  updateEditorLayoutVisibility();

  // Build ribbon
  const ribbonContainer = document.getElementById("ribbon-container");
  if (ribbonContainer) {
    buildRibbon(ribbonContainer, {
      initialViewMode: editorViewMode,
      initialSplitViewSubmode: splitViewSubmode,
      onViewModeChange(mode: EditorViewMode) {
        editorViewMode = mode;
        localStorage.setItem("asciidoc-editor-view-mode", mode);
        syncEditorPresentationMode();
      },
      onSplitViewSubmodeChange(mode: SplitViewSubmode) {
        splitViewSubmode = mode;
        localStorage.setItem("asciidoc-editor-split-submode", mode);
        syncEditorPresentationMode();
      },
      onToggleLineNumbers(show: boolean) {
        showLineNumbers = show;
        updateLineNumbers();
      },
      onToggleBlockShading(show: boolean) {
        specialBlockShading = show;
        updateBlockShading();
      },
      onToggleOverlayEditing(enabled: boolean) {
        overlayEditingEnabled = enabled;
        setOverlayEditingEnabled(enabled);
      },
      onToggleDocAttributes(show: boolean) {
        setDocAttributesVisible(show);
        refreshLivePreview(editorView!);
      },
      onToggleFullscreen(enabled: boolean) {
        setFullscreen(enabled);
      },
      onToggleAutoHide(enabled: boolean) {
        setAutoHideToolbar(enabled);
      },
      onMarginChange(px: number) {
        document.documentElement.style.setProperty("--content-margin", `${px}px`);
        localStorage.setItem("asciidoc-editor-margin", String(px));
      },
      onZoomChange(percent: number) {
        currentZoom = percent;
        localStorage.setItem("asciidoc-editor-zoom", String(percent));
        applyZoom(percent);
      },
    }, savedMargin, currentZoom);
  }

  // Wire spell-check dictionary persistence
  onDictionaryChange((word: string) => {
    addWordToPersonalDictionary(word).catch((e) =>
      console.error("[panel] Failed to persist dictionary word:", e)
    );
  });

  // Create editor
  const editorPane = document.getElementById("editor-pane");
  if (editorPane) {
    createEditor(editorPane, "");
    syncEditorPresentationMode({ restoreFocus: false });
  }

  // Apply persisted zoom level
  if (currentZoom !== 100) {
    applyZoom(currentZoom);
  }

  // Prevent ribbon clicks from stealing editor focus — the ribbon is part of the editor UI
  const ribbonEl = document.getElementById("ribbon-container");
  if (ribbonEl) {
    ribbonEl.addEventListener("mousedown", (e) => {
      // Only prevent default if the target isn't an input/textarea/select (those need focus)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
      }
    });
  }

  // Intercept Cmd/Ctrl+F in capture phase to open CM6 search instead of Joplin's
  document.addEventListener("keydown", (e) => {
    if (!editorView) return;
    const isMod = e.metaKey || e.ctrlKey;
    if (isMod && (e.key === "f" || e.key === "h") && !e.altKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "h" || e.shiftKey) saveSearchExpanded(true);
      armScopeFromSelection(editorView);
      openSearchPanel(editorView);
    }
  }, true);

  // Escape key exits fullscreen mode (only when nothing else consumed the Escape)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isFullscreen || e.defaultPrevented) return;
    // Don't exit fullscreen if a block editor modal is open (it has its own Escape handler)
    const hasModal = editorView?.dom.querySelector(".cm-lp-block-editor-overlay") != null;
    if (!hasModal) {
      setFullscreen(false);
    }
  });

  // Open CM6 search panel from toolbar button
  window.addEventListener("open-search", () => {
    if (editorView) {
      armScopeFromSelection(editorView);
      openSearchPanel(editorView);
    }
  });

  // Custom right-click context menu
  const editorPaneEl = document.getElementById("editor-pane");
  if (editorPaneEl) {
    editorPaneEl.addEventListener("contextmenu", (e) => {
      if (e.defaultPrevented) return; // let spellcheck handle its own menu
      if (effectiveSpellcheckMode() === "native") return; // let Joplin/Electron native spellcheck handle the menu
      e.preventDefault();
      if (editorView) showClipboardContextMenu(editorView, e);
    });

    editorPaneEl.addEventListener("paste", (e) => {
      const files = e.clipboardData?.files;
      if (!files || files.length === 0) return;
      const hasMedia = Array.from(files).some((file) => getMediaMacroKind(file));
      if (!hasMedia) return;
      e.preventDefault();
      insertMediaFiles(files).catch((error) => console.error("[panel] Failed to paste media:", error));
    });

    editorPaneEl.addEventListener("dragover", (e) => {
      const files = e.dataTransfer?.items;
      if (!files || files.length === 0) return;
      const hasMedia = Array.from(files).some((item) => {
        if (item.kind !== "file") return false;
        const probe = new File([], "probe", { type: item.type });
        return getMediaMacroKind(probe) !== null;
      });
      if (!hasMedia) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });

    editorPaneEl.addEventListener("drop", (e) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const hasMedia = Array.from(files).some((file) => getMediaMacroKind(file));
      if (!hasMedia) return;
      e.preventDefault();
      insertMediaFiles(files).catch((error) => console.error("[panel] Failed to drop media:", error));
    });
  }

  // Event listeners
  window.addEventListener("editor-command", handleEditorCommand);
  window.addEventListener("force-save", forceSave);

  // Close dropdowns on resize
  window.addEventListener("resize", () => {
    document.querySelectorAll(".split-dropdown.open").forEach(el => el.classList.remove("open"));
  });

  // Listen for validated host pushes through the selected transport.
  subscribeToHostPush(handleMessage);

  // Notify plugin sandbox we're ready and process the response
  getEditorTransport().request({ type: "ready" }).then((response) => {
    if (!response) return;

    // Apply theme from response
    if (response.isDark != null) {
      hostDarkTheme = response.isDark === true;
      editorThemeName = typeof response.editorTheme === "string" ? response.editorTheme : "follow";
      mermaidThemeVariablesRaw = typeof response.mermaidThemeVariables === "string" ? response.mermaidThemeVariables : "{}";
      applyEditorTheme();
    }

    // Apply compact spacing setting from Joplin settings
    if (response.compactSpacing != null) {
      compactSpacingEnabled = response.compactSpacing === true;
      updateCompactSpacing();
    }

    if (response.attributeAutocomplete != null) {
      attributeAutocompleteEnabled = response.attributeAutocomplete !== false;
    }
    if (response.spellCheck != null) {
      spellcheckEnabled = response.spellCheck !== false;
      spellcheckMode = normalizeSpellcheckMode(response.spellcheckMode);
      localStorage.setItem("asciidoc-spellcheck-mode", spellcheckMode);
      localStorage.setItem("asciidoc-spellcheck", String(spellcheckEnabled));
      updateSpellcheck();
    }

    // Load initial note if available
    if (response.note) {
      handleMessage({ type: "updateNote", value: response.note });
    }

    // Load spell-checker settings and personal dictionary
    getSpellcheckSettings().then((settings) => {
      setShowPluralSingular(settings.pluralSingular);
      spellcheckMode = normalizeSpellcheckMode(settings.mode);
      localStorage.setItem("asciidoc-spellcheck-mode", spellcheckMode);
      updateSpellcheck();
    }).catch((e) => console.error("[panel] Failed to load spellcheck settings:", e));

    getPersonalDictionary().then((result) => {
      if (result.words && result.words.length > 0) {
        loadPersonalDictionary(result.words);
        if (effectiveSpellcheckMode() === "nspell" && editorView) {
          refreshSpellcheck(editorView);
        }
      }
    }).catch((e) => console.error("[panel] Failed to load personal dictionary:", e));

    getSnippets().then((result) => {
      if (result.snippets) snippets = result.snippets;
    }).catch((e) => console.error("[panel] Failed to load snippets:", e));

    window.addEventListener("snippets-changed", () => {
      getSnippets().then((result) => {
        if (result.snippets) snippets = result.snippets;
      }).catch(() => {});
    });
  }).catch((e: any) => {
    console.error("[panel] Ready handshake failed:", e);
  });
}

// Start when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
