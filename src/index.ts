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

async function searchJoplinAsciiDocNotesInActiveFolder(fromNoteId: string, query: string, limit: number) {
  const folderId = await getActiveJoplinFolderId(fromNoteId);
  if (!folderId) return [];
  const notes = await fetchJoplinFolderNotes(folderId);
  return filterJoplinNoteLinkCandidates(notes, {
    currentNoteId: fromNoteId,
    query,
    limit,
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

interface ParsedIncludeDirective {
  rawDirective: string;
  target: string;
  optional: boolean;
  lines?: string;
  tag?: string;
  tags?: string;
  levelOffset?: string;
  indent?: string;
}

interface ResolvedJoplinInclude {
  id: string;
  key: string;
  title: string;
  content: string;
  asciidoc: boolean;
}

const TAG_DIRECTIVE_PATTERN = /\b(tag|end)::([^\s\[]+)\[\](?=\s|$)/g;

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

function splitQuoted(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  for (const char of value) {
    if ((char === "\"" || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      current += char;
      continue;
    }
    if (!quote && char === separator) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function stripQuotedValue(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseIncludeDirective(line: string): ParsedIncludeDirective | null {
  const match = line.match(/^\s*include::([^\[]+)\[(.*)\]\s*$/);
  if (!match) return null;
  const attributes = new Map<string, string>();
  for (const part of splitQuoted(match[2] || "", ",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      attributes.set(trimmed.toLowerCase(), "");
    } else {
      attributes.set(trimmed.slice(0, eq).trim().toLowerCase(), stripQuotedValue(trimmed.slice(eq + 1).trim()));
    }
  }
  const opts = (attributes.get("opts") || "")
    .split(/[;,]/)
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);
  return {
    rawDirective: line.trim(),
    target: stripQuotedValue(match[1].trim()),
    optional: opts.includes("optional"),
    lines: attributes.get("lines"),
    tag: attributes.get("tag"),
    tags: attributes.get("tags"),
    levelOffset: attributes.get("leveloffset"),
    indent: attributes.get("indent"),
  };
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

function effectiveLevelOffset(currentOffset: number, rawValue?: string): number {
  const value = (rawValue || "").trim();
  if (!value) return currentOffset;
  if (/^[+-]\d+$/.test(value)) return currentOffset + Number.parseInt(value, 10);
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  return currentOffset;
}

function applyLevelOffsetToHeading(line: string, levelOffset: number): string {
  if (!levelOffset) return line;
  const match = line.match(/^(\s*)(={1,6})(\s+.*)$/);
  if (!match) return line;
  const currentLevel = match[2].length;
  const nextLevel = Math.max(1, Math.min(6, currentLevel + levelOffset));
  return `${match[1]}${"=".repeat(nextLevel)}${match[3]}`;
}

function extractTagDirectives(line: string): Array<{ kind: "tag" | "end"; name: string }> {
  const directives: Array<{ kind: "tag" | "end"; name: string }> = [];
  TAG_DIRECTIVE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_DIRECTIVE_PATTERN.exec(line)) !== null) {
    directives.push({ kind: match[1] as "tag" | "end", name: match[2] });
  }
  return directives;
}

function hasTagDirective(line: string): boolean {
  TAG_DIRECTIVE_PATTERN.lastIndex = 0;
  return TAG_DIRECTIVE_PATTERN.test(line);
}

function applyTagFilter(source: string, tagSpec: string): string {
  const lines = normalizeLineEndings(source).split("\n");
  const selectedTags = tagSpec.split(/[;,]/).map(tag => tag.trim()).filter(Boolean);
  if (selectedTags.length === 0) return source;
  if (selectedTags.includes("**")) return lines.filter(line => !hasTagDirective(line)).join("\n");

  const activeTags = new Map<string, number>();
  const wanted = new Set(selectedTags);
  const filtered: string[] = [];
  for (const line of lines) {
    const directives = extractTagDirectives(line);
    if (directives.length > 0) {
      for (const directive of directives) {
        const count = activeTags.get(directive.name) || 0;
        if (directive.kind === "tag") activeTags.set(directive.name, count + 1);
        else if (count <= 1) activeTags.delete(directive.name);
        else activeTags.set(directive.name, count - 1);
      }
      continue;
    }
    if (Array.from(wanted).some(tag => (activeTags.get(tag) || 0) > 0)) filtered.push(line);
  }
  return filtered.join("\n");
}

function normalizeLineIndex(value: string | undefined, totalLines: number, defaultValue: number): number {
  if (value == null || value === "") return defaultValue;
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return defaultValue;
  if (numeric === -1) return totalLines;
  return Math.max(1, Math.min(totalLines, numeric));
}

function applyLineFilter(source: string, lineSpec: string): string {
  const lines = normalizeLineEndings(source).split("\n");
  const selected = new Set<number>();
  for (const spec of lineSpec.split(/[;,]/).map(part => part.trim()).filter(Boolean)) {
    const rangeMatch = spec.match(/^(-?\d+)?\.\.(-?\d+)?$/);
    if (rangeMatch) {
      const start = normalizeLineIndex(rangeMatch[1], lines.length, 1);
      const end = normalizeLineIndex(rangeMatch[2], lines.length, lines.length);
      for (let lineNumber = start; lineNumber <= end; lineNumber++) selected.add(lineNumber);
      continue;
    }
    if (/^-?\d+$/.test(spec)) selected.add(normalizeLineIndex(spec, lines.length, 1));
  }
  return lines.filter((_line, index) => selected.has(index + 1)).join("\n");
}

function applyIndent(source: string, indentSpec: string): string {
  const indent = Number.parseInt(indentSpec, 10);
  if (!Number.isFinite(indent) || indent < 0) return source;
  const lines = normalizeLineEndings(source).split("\n");
  let minimumIndent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^[ \t]+/);
    if (!match) return source;
    minimumIndent = Math.min(minimumIndent, match[0].length);
  }
  if (!Number.isFinite(minimumIndent)) return source;
  return lines
    .map(line => {
      if (!line) return line;
      const stripped = line.startsWith(" ") || line.startsWith("\t")
        ? line.slice(Math.min(minimumIndent, line.length))
        : line;
      return `${" ".repeat(indent)}${stripped}`;
    })
    .join("\n");
}

function applyIncludeTransforms(source: string, directive: ParsedIncludeDirective, levelOffset: number): { source: string; levelOffset: number } {
  let selectedSource = normalizeLineEndings(source);
  const tagSpec = (directive.tags || directive.tag || "").trim();
  if (tagSpec) selectedSource = applyTagFilter(selectedSource, tagSpec);
  if (directive.lines?.trim()) selectedSource = applyLineFilter(selectedSource, directive.lines.trim());
  if (directive.indent?.trim()) selectedSource = applyIndent(selectedSource, directive.indent.trim());
  const childLevelOffset = effectiveLevelOffset(levelOffset, directive.levelOffset);
  return { source: selectedSource, levelOffset: childLevelOffset };
}

async function expandJoplinIncludes(source: string, fromNoteId: string, seen: Set<string> = new Set(), levelOffset = 0): Promise<string> {
  const activeSeen = seen.size === 0 && NOTE_ID_RE.test(fromNoteId)
    ? new Set([...seen, `note:${fromNoteId}`])
    : seen;
  const lines = source.split("\n");
  const output: string[] = [];

  for (const line of lines) {
    const directive = parseIncludeDirective(line);
    if (!directive) {
      output.push(applyLevelOffsetToHeading(line, levelOffset));
      continue;
    }

    const indent = line.match(/^(\s*)/)?.[1] || "";
    const rawTarget = directive.target.trim();
    const target = await resolveIncludeTarget(fromNoteId, rawTarget);
    if (!target) {
      if (!directive.optional) {
        output.push(`${indent}[WARNING]`, `${indent}====`, `${indent}Missing include: ${rawTarget}`, `${indent}====`);
      }
      continue;
    }
    if (activeSeen.has(target.key)) {
      output.push(`${indent}[WARNING]`, `${indent}====`, `${indent}Cyclic include skipped: ${target.title}`, `${indent}====`);
      continue;
    }

    const nextSeen = new Set(activeSeen);
    nextSeen.add(target.key);
    const transformed = applyIncludeTransforms(target.content, directive, levelOffset);
    const expanded = target.asciidoc
      ? await expandJoplinIncludes(transformed.source, target.id, nextSeen, transformed.levelOffset)
      : transformed.source;
    for (const includedLine of expanded.split("\n")) {
      output.push(indent ? indent + includedLine : includedLine);
    }
  }

  return output.join("\n");
}

// =====================================================
// Markdown → AsciiDoc conversion helpers
// =====================================================

/**
 * Convert Markdown headings (# ... ######) to AsciiDoc headings (= ... ======).
 * Only converts lines where # is a heading marker:
 * - Must be at the start of the line (after optional whitespace)
 * - Must be followed by a space
 * - Skips lines inside fenced code blocks (``` or ~~~)
 */
function convertMarkdownHeadings(text: string): string {
  const lines = text.split("\n");
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    // Track fenced code blocks to avoid converting inside them
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Match Markdown heading: 1-6 # chars at start of line, followed by a space
    const match = lines[i].match(/^(\s*)(#{1,6})\s+(.*)$/);
    if (match) {
      const [, leadingSpace, hashes, content] = match;
      const level = hashes.length;
      const equals = "=".repeat(level);
      lines[i] = `${leadingSpace}${equals} ${content}`;
    }
  }

  return lines.join("\n");
}

/**
 * Convert Markdown unordered lists using `-` markers to AsciiDoc `*` markers.
 *
 * Matches lines where `-` is a list marker:
 * - At the start of the line (after optional whitespace used for nesting)
 * - Followed by a space and then list content
 * - Indent level determines nesting depth (every 2 spaces = one extra level)
 *
 * Does NOT convert:
 * - Hyphens inside words (e.g., "side-effect")
 * - Lines inside fenced code blocks
 * - Horizontal rules (---, ----, etc.)
 * - Lines where `-` is not followed by a space (not a list marker)
 */
function convertMarkdownLists(text: string): string {
  const lines = text.split("\n");
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    // Track fenced code blocks to avoid converting inside them
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Match a markdown list item: optional leading whitespace, then "- " followed by content
    const match = lines[i].match(/^(\s*)- (.+)$/);
    if (!match) continue;

    const [, indent, content] = match;

    // Skip horizontal rules (lines that are only dashes, possibly with spaces)
    if (/^-[\s-]*$/.test(trimmed)) continue;

    // Calculate nesting depth: base level is 1 star, each 2 spaces of indent adds a level
    const depth = Math.floor(indent.length / 2) + 1;
    const stars = "*".repeat(depth);
    lines[i] = `${stars} ${content}`;
  }

  return lines.join("\n");
}

/**
 * Convert Markdown inline links [text](url) to AsciiDoc link:url[text].
 * Also converts images ![alt](url) to image::url[alt].
 * Always uses the link: macro to prevent Asciidoctor from misinterpreting
 * special characters (commas, percent-encoding, fragments) in URLs.
 * Skips lines inside fenced code blocks.
 * Must run BEFORE convertMarkdownCodeBlocks so code block tracking still uses ```.
 */
function convertMarkdownLinks(text: string): string {
  const lines = text.split("\n");
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Convert images: ![alt](url "title")
    // Markdown titles are stripped.
    // If image is alone on line → block image (image::) with trailing text as caption
    // If image is inline with other content → inline image (image:)
    if (/!\[([^\]]*)\]\(/.test(lines[i])) {
      const imageOnlyMatch = lines[i].match(/^\s*!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)\s*$/);
      if (imageOnlyMatch) {
        // Standalone image → block macro
        lines[i] = `image::${imageOnlyMatch[2]}[${imageOnlyMatch[1]}]`;
      } else {
        const imageWithCaptionMatch = lines[i].match(/^\s*!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)\s*(.+)$/);
        if (imageWithCaptionMatch && !/!\[/.test(imageWithCaptionMatch[3])) {
          // Single image at start with trailing text (no other images) → block with caption
          const caption = imageWithCaptionMatch[3].trim();
          lines[i] = `${caption ? `.${caption}\n` : ""}image::${imageWithCaptionMatch[2]}[${imageWithCaptionMatch[1]}]`;
        } else {
          // Multiple images or image inline with text → inline image (image:)
          lines[i] = lines[i].replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g, "image:$2[$1]");
        }
      }
    }

    // Convert links: [text](url "title") → link:url[text]
    // Markdown titles are stripped
    lines[i] = lines[i].replace(/(.?)\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g, (_match, before, linkText, url) => {
      // Ensure a space before link: when preceded by text (AsciiDoc requires word boundary)
      const needsSpace = before && !/\s/.test(before);
      return `${before}${needsSpace ? " " : ""}link:${url}[${linkText}]`;
    });
  }

  return lines.join("\n");
}

/**
 * Convert Markdown inline formatting to AsciiDoc equivalents.
 * - ***text*** (MD bold+italic) → *_text_* (AD bold+italic)
 * - **text**  (MD bold)         → *text* (AD constrained strong)
 * - ~~text~~  (MD strikethrough) → [line-through]#text# (AD)
 *
 * Note: single *text* (MD italic) is NOT converted because it conflicts
 * with AsciiDoc list markers and with the bold conversion output.
 * In AsciiDoc, *text* renders as bold which is acceptable.
 *
 * Processes outside of code blocks and inline code spans.
 */
function convertMarkdownInlineFormatting(text: string): string {
  const lines = text.split("\n");
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Split line into code spans and non-code segments to avoid
    // converting formatting inside inline code (`...`)
    const segments = lines[i].split(/(`[^`]+`)/);
    for (let j = 0; j < segments.length; j++) {
      // Skip inline code segments (odd indices from the split)
      if (segments[j].startsWith("`")) continue;

      // Bold+italic: ***text*** → *_text_* (must run before bold)
      segments[j] = segments[j].replace(/\*\*\*(.+?)\*\*\*/g, "*_$1_*");

      // Bold: **text** → *text*
      segments[j] = segments[j].replace(/\*\*(.+?)\*\*/g, "*$1*");

      // Strikethrough: ~~text~~ → [.line-through]#text#
      segments[j] = segments[j].replace(/~~(.+?)~~/g, "[.line-through]#$1#");
    }
    lines[i] = segments.join("");
  }

  return lines.join("\n");
}

/**
 * Convert Markdown fenced code blocks to AsciiDoc listing blocks.
 *   ```lang  →  [source,lang]\n----
 *   ```      →  ----
 *   ~~~lang  →  [source,lang]\n----
 * Must run AFTER all other line-based converters since it changes the
 * fence markers that those converters use for code-block tracking.
 */
function convertMarkdownCodeBlocks(text: string): string {
  const lines = text.split("\n");
  let inCodeBlock = false;
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (!inCodeBlock) {
      const openMatch = trimmed.match(/^(`{3,}|~{3,})\s*(\S*)\s*$/);
      if (openMatch) {
        inCodeBlock = true;
        const lang = openMatch[2];
        if (lang) {
          result.push(`[source,${lang}]`);
        }
        result.push("----");
        continue;
      }
    } else {
      if (/^(`{3,}|~{3,})\s*$/.test(trimmed)) {
        inCodeBlock = false;
        result.push("----");
        continue;
      }
    }

    result.push(lines[i]);
  }

  return result.join("\n");
}

/**
 * Convert HTML elements commonly found in Markdown notes.
 * - <br/>, <br>, <br /> → newline
 * - Strip inline HTML tags (<a>, <span>, <div>, etc.) preserving content
 * Must run BEFORE other converters so they see clean text.
 */
function convertHtmlElements(text: string): string {
  let result = text;
  // Convert <br> variants to newlines
  result = result.replace(/<br\s*\/?>/gi, "\n");
  // Strip common HTML tags, preserving their content
  result = result.replace(/<\/?(?:a|span|div|p|em|strong|b|i|u|s|del|ins|sup|sub|small|big|center|font|mark|abbr)(?:\s[^>]*)?>/gi, "");
  return result;
}

/**
 * Remove Markdown backslash escapes that have no meaning in AsciiDoc.
 * \* → *, \$ → $, \[ → [, \] → ], \- → -, \_ → _, \\ → \
 * Skips lines inside fenced code blocks.
 */
function convertMarkdownEscapes(text: string): string {
  const lines = text.split("\n");
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Split on inline code to avoid processing inside backticks
    const segments = lines[i].split(/(`[^`]+`)/);
    for (let j = 0; j < segments.length; j++) {
      if (segments[j].startsWith("`")) continue;
      // Remove backslash before common escaped characters
      segments[j] = segments[j].replace(/\\([*$\[\]\\_.!#\-+`~{}>])/g, "$1");
    }
    lines[i] = segments.join("");
  }

  return lines.join("\n");
}

/**
 * Convert Markdown linked images [![alt](imgUrl)](linkUrl)
 * to AsciiDoc image::imgUrl[alt, link=linkUrl].
 * Must run BEFORE convertMarkdownLinks to avoid nested bracket issues.
 */
function convertMarkdownLinkedImages(text: string): string {
  const lines = text.split("\n");
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // [![alt](imgUrl "title")](linkUrl "title") → image macro with link
    // Markdown titles are stripped from both image and link URLs
    // If it's the only thing on the line → block (image::), otherwise inline (image:)
    const linkedImgRegex = /\[!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
    const linkedImgOnlyMatch = lines[i].match(/^\s*\[!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)\s*$/);
    if (linkedImgOnlyMatch) {
      // Single linked image alone on line → block macro
      lines[i] = `image::${linkedImgOnlyMatch[2]}[${linkedImgOnlyMatch[1]}, link=${linkedImgOnlyMatch[3]}]`;
    } else {
      // Inline with other content → inline macro (image:)
      lines[i] = lines[i].replace(linkedImgRegex, (_, alt, imgUrl, linkUrl) => {
        return `image:${imgUrl}[${alt}${linkUrl ? ", link=" + linkUrl : ""}]`;
      });
    }
  }

  return lines.join("\n");
}

/**
 * Apply all Markdown → AsciiDoc conversions.
 */
/**
 * Convert Markdown horizontal rules (---, ***, ___) to AsciiDoc (''').
 * Skips lines inside fenced code blocks.
 */
function convertMarkdownHorizontalRules(text: string): string {
  const lines = text.split("\n");
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      lines[i] = "'''";
    }
  }

  return lines.join("\n");
}

function convertMarkdownToAsciidoc(text: string): string {
  let result = text;
  // HTML cleanup first so other converters see clean text
  result = convertHtmlElements(result);
  result = convertMarkdownEscapes(result);
  result = convertMarkdownHeadings(result);
  result = convertMarkdownLists(result);
  result = convertMarkdownHorizontalRules(result);
  result = convertMarkdownInlineFormatting(result);
  // Linked images before regular images/links (nested brackets)
  result = convertMarkdownLinkedImages(result);
  result = convertMarkdownLinks(result);
  // Code blocks last — changes fence markers that other converters rely on
  result = convertMarkdownCodeBlocks(result);
  return result;
}

// =====================================================
// Asciidoctor.js rendering
// =====================================================

let asciidoctorInstance: any = null;

function getAsciidoctor() {
  if (!asciidoctorInstance) {
    const Asciidoctor = require("asciidoctor");
    asciidoctorInstance = Asciidoctor();
  }
  return asciidoctorInstance;
}

function renderAsciidoc(source: string, settings: Record<string, any> = {}): string {
  try {
    const asciidoctor = getAsciidoctor();
    const attributes: Record<string, string> = {
      showtitle: "true",
      icons: "font",
      ...(settings.attributes || {}),
    };
    return asciidoctor.convert(source, {
      safe: "safe",
      backend: "html5",
      standalone: false,
      attributes,
    });
  } catch (e: any) {
    return `<div class="render-error"><h3>AsciiDoc Render Error</h3><pre>${
      (e.message || String(e)).replace(/</g, "&lt;").replace(/>/g, "&gt;")
    }</pre></div>`;
  }
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
      : appendSentinel(convertMarkdownToAsciidoc(note.body), {});
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
    const converted = convertMarkdownToAsciidoc(note.body);
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

async function registerCommands() {
  await joplin.commands.register({
    name: "asciidoc.createNote",
    label: "New AsciiDoc Note",
    iconName: "fas fa-file-alt",
    execute: async () => {
      const folder = await joplin.workspace.selectedFolder();
      const note = await joplin.data.post(["notes"], null, {
        parent_id: folder.id,
        title: "New AsciiDoc Note",
        body: "= New AsciiDoc Note\n\nStart writing here...\n\n```asciidoc-settings\n{}\n```\n",
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
    label: "Convert to AsciiDoc Note",
    iconName: "fas fa-exchange-alt",
    execute: async () => {
      const selected = await joplin.workspace.selectedNote();
      if (!selected) return;
      const note = await joplin.data.get(["notes", selected.id], {
        fields: ["id", "body", "parent_id"],
      });
      if (!note || isAsciiDocNote(note.body)) return;
      const converted = convertMarkdownToAsciidoc(note.body);
      const newBody = appendSentinel(converted, {});
      await joplin.data.put(["notes", note.id], null, { body: newBody });
      // Force refresh by navigating away and back
      const tmp = await joplin.data.post(["notes"], null, {
        parent_id: note.parent_id,
        title: ".tmp-asciidoc-convert",
        body: "",
      });
      await joplin.commands.execute("openNote", tmp.id);
      await joplin.data.delete(["notes", tmp.id]);
      await joplin.commands.execute("openNote", note.id);
    },
  });

  await joplin.commands.register({
    name: "asciidoc.convertCurrentNoteCopy",
    label: "Convert to AsciiDoc Note (new file)",
    iconName: "fas fa-copy",
    execute: async () => {
      const selected = await joplin.workspace.selectedNote();
      if (!selected) return;
      const note = await joplin.data.get(["notes", selected.id], {
        fields: ["id", "title", "body", "parent_id"],
      });
      if (!note) return;
      const body = isAsciiDocNote(note.body)
        ? note.body
        : appendSentinel(convertMarkdownToAsciidoc(note.body), {});
      const copy = await joplin.data.post(["notes"], null, {
        parent_id: note.parent_id,
        title: note.title + " (AsciiDoc)",
        body,
      });
      setTimeout(async () => {
        await joplin.commands.execute("openNote", copy.id);
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

  // "Create AsciiDoc Copy" — available in note list right-click menu
  await joplin.commands.register({
    name: "asciidoc.createAsciiDocCopy",
    label: "Create AsciiDoc Copy",
    iconName: "fas fa-copy",
    execute: async () => {
      const selected = await joplin.workspace.selectedNote();
      if (!selected) return;
      const note = await joplin.data.get(["notes", selected.id], {
        fields: ["id", "title", "body", "parent_id"],
      });
      if (!note) return;
      // Already an AsciiDoc note — just open it
      if (isAsciiDocNote(note.body)) {
        await joplin.commands.execute("openNote", note.id);
        return;
      }
      // Create a new AsciiDoc copy with converted headings and sentinel
      const converted = convertMarkdownToAsciidoc(note.body);
      const body = appendSentinel(converted, {});
      const copy = await joplin.data.post(["notes"], null, {
        parent_id: note.parent_id,
        title: note.title + " (AsciiDoc)",
        body,
      });
      setTimeout(async () => {
        await joplin.commands.execute("openNote", copy.id);
      }, 100);
    },
  });

  // "Replace with AsciiDoc File" — converts note in-place from note list right-click menu
  await joplin.commands.register({
    name: "asciidoc.replaceWithAsciiDoc",
    label: "Replace with AsciiDoc File",
    iconName: "fas fa-exchange-alt",
    execute: async () => {
      const selected = await joplin.workspace.selectedNote();
      if (!selected) return;
      const note = await joplin.data.get(["notes", selected.id], {
        fields: ["id", "body", "parent_id"],
      });
      if (!note) return;
      if (isAsciiDocNote(note.body)) return;
      const converted = convertMarkdownToAsciidoc(note.body);
      const newBody = appendSentinel(converted, {});
      await joplin.data.put(["notes", note.id], null, { body: newBody });
      // Force refresh by navigating away and back
      const tmp = await joplin.data.post(["notes"], null, {
        parent_id: note.parent_id,
        title: ".tmp-asciidoc-convert",
        body: "",
      });
      await joplin.commands.execute("openNote", tmp.id);
      await joplin.data.delete(["notes", tmp.id]);
      await joplin.commands.execute("openNote", note.id);
    },
  });

  // "Make this note AsciiDoc" — converts current note in-place, shown as toolbar button
  await joplin.commands.register({
    name: "asciidoc.makeCurrentNoteAsciiDoc",
    label: "Make AsciiDoc",
    iconName: "fas fa-file-alt",
    execute: async () => {
      const selected = await joplin.workspace.selectedNote();
      if (!selected) return;
      const note = await joplin.data.get(["notes", selected.id], {
        fields: ["id", "body", "parent_id"],
      });
      if (!note) return;
      if (isAsciiDocNote(note.body)) return; // Already AsciiDoc
      const converted = convertMarkdownToAsciidoc(note.body);
      const newBody = appendSentinel(converted, {});
      await joplin.data.put(["notes", note.id], null, { body: newBody });
      // Force Joplin to reload the note with the custom editor
      const tmp = await joplin.data.post(["notes"], null, {
        parent_id: note.parent_id,
        title: ".tmp-asciidoc-convert",
        body: "",
      });
      await joplin.commands.execute("openNote", tmp.id);
      await joplin.data.delete(["notes", tmp.id]);
      await joplin.commands.execute("openNote", note.id);
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
    label: "Create AsciiDoc Copy of Notebook",
    iconName: "fas fa-copy",
    execute: async (...args: any[]) => {
      try {
        // Folder ID may be passed as argument from context menu, or fall back to selected folder
        const folderId = args[0] || (await joplin.workspace.selectedFolder())?.id;
        if (!folderId) {
          console.error("[AsciiDoc] copyNotebook: no folder ID available");
          return;
        }
        const folderData = await joplin.data.get(["folders", folderId], {
          fields: ["id", "title", "parent_id"],
        });
        if (!folderData) {
          console.error("[AsciiDoc] copyNotebook: folder not found:", folderId);
          return;
        }
        console.info("[AsciiDoc] Creating AsciiDoc copy of notebook:", folderData.title);
        await copyNotebookAsAsciiDoc(folderData.id, folderData.parent_id || "", folderData.title + " (AsciiDoc)");
        console.info("[AsciiDoc] Notebook copy complete");
      } catch (e) {
        console.error("[AsciiDoc] copyNotebook failed:", e);
      }
    },
  });

  await joplin.commands.register({
    name: "asciidoc.replaceNotebookWithAsciiDoc",
    label: "Replace with AsciiDoc Notebook",
    iconName: "fas fa-exchange-alt",
    execute: async (...args: any[]) => {
      try {
        const folderId = args[0] || (await joplin.workspace.selectedFolder())?.id;
        if (!folderId) {
          console.error("[AsciiDoc] replaceNotebook: no folder ID available");
          return;
        }
        console.info("[AsciiDoc] Replacing notebook with AsciiDoc:", folderId);
        await replaceNotebookWithAsciiDoc(folderId);
        console.info("[AsciiDoc] Notebook replacement complete");
      } catch (e) {
        console.error("[AsciiDoc] replaceNotebook failed:", e);
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
      label: "Create new notes as AsciiDoc",
      description: "When enabled, new notes will automatically be created as AsciiDoc notes with the Live Preview editor.",
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
    console.info("[AsciiDoc] Plugin onStart called");
    try {
    await registerSettings();
    await registerCommands();
    console.info("[AsciiDoc] Commands and settings registered");

    let templateTagId: string;
    try {
      templateTagId = await ensureTemplateTag();
    } catch (e) {
      console.error("[AsciiDoc] Failed to ensure template tag:", e);
      templateTagId = "";
    }

    const editors = (joplin.views as any).editors;
    if (!editors) {
      console.error("[AsciiDoc] joplin.views.editors not available — custom editor requires Joplin 3.1+");
      return;
    }
    let currentNoteId: string | null = null;
    let lastNote: { id: string; body: string; html: string } | null = null;

    async function renderNote(body: string): Promise<string> {
      const { content, settings } = stripSentinel(body);
      const expanded = await expandJoplinIncludes(content, currentNoteId || "");
      return renderAsciidoc(expanded, settings);
    }

    try {
    await editors.register("asciidoc-editor", {
      async onSetup(handle: any) {
        const isDark = await joplin.shouldUseDarkColors();
        const themeClass = isDark ? "dark-theme" : "light-theme";

        // Ribbon + editor layout. The webview owns split/raw/preview mode state.
        await editors.setHtml(
          handle,
          `<div id="asciidoc-editor-root" class="${themeClass}">
            <div id="ribbon-container"></div>
            <div id="editor-layout" class="editor-layout" data-view-mode="live-preview" data-split-view-submode="split">
              <div id="editor-pane" class="editor-surface editor-surface--raw"></div>
              <div id="editor-split-divider" class="editor-split-divider" hidden></div>
              <div id="preview-pane-container" class="editor-surface editor-surface--preview" hidden>
                <div id="preview-pane"></div>
              </div>
            </div>
          </div>`
        );

        await editors.addScript(handle, "./panel.js");
        await editors.addScript(handle, "./styles/editor.css");
        await editors.addScript(handle, "./styles/preview.css");
        await editors.addScript(handle, "./styles/katex.min.css");

        // Handle note updates from Joplin
        await editors.onUpdate(handle, async (update: any) => {
          if (!isAsciiDocNote(update.newBody)) return;
          currentNoteId = update.noteId;
          const html = await renderNote(update.newBody);
          lastNote = { id: update.noteId, body: update.newBody, html };
          editors.postMessage(handle, {
            type: "updateNote",
            value: lastNote,
          });
        });

        // Handle messages from webview
        await editors.onMessage(handle, async (msg: any) => {
          if (msg.kind === "ReturnValueResponse") return;

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
            await editors.saveNote(handle, { noteId, body });
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
              const notes = await searchJoplinAsciiDocNotesInActiveFolder(fromNoteId, query, 20);
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
              const noteTargets = (await searchJoplinAsciiDocNotesInActiveFolder(fromNoteId, query, 25))
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

          // Unmark template
          if (msg.type === "unmarkTemplate" && currentNoteId) {
            try {
              await joplin.data.delete(["tags", templateTagId, "notes", currentNoteId]);
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
              console.error("[AsciiDoc] Failed to save dictionary word:", e);
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
              console.error("[AsciiDoc] Failed to save snippet:", e);
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
              console.error("[AsciiDoc] Failed to update snippet:", e);
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
              console.error("[AsciiDoc] Failed to remove snippet:", e);
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
              console.error("[AsciiDoc] Failed to toggle fullscreen:", e);
              return { status: "error" };
            }
          }

          // Convert Markdown to AsciiDoc (for paste conversion)
          if (msg.type === "convertMarkdownPaste") {
            return { asciidoc: convertMarkdownToAsciidoc(msg.markdown || "") };
          }
        });

        // Push setting changes to the webview
        await (joplin.settings as any).onChange(async (event: any) => {
          if (event.keys.includes("asciidoc.compactSpacing")) {
            const value = await joplin.settings.value("asciidoc.compactSpacing");
            editors.postMessage(handle, {
              type: "updateCompactSpacing",
              value: value === true,
            });
          }
          if (event.keys.includes("asciidoc.attributeAutocomplete")) {
            editors.postMessage(handle, {
              type: "updateAttributeAutocomplete",
              enabled: await joplin.settings.value("asciidoc.attributeAutocomplete") !== false,
            });
          }
          if (event.keys.includes("asciidoc.spellCheck")) {
            const nspellSpellcheckEnabled = await joplin.settings.value("asciidoc.spellCheck") !== false;
            editors.postMessage(handle, {
              type: "updateSpellCheck",
              enabled: nspellSpellcheckEnabled,
              mode: nspellSpellcheckEnabled ? "nspell" : "native",
            });
          }
          if (event.keys.includes("asciidoc.editorTheme") || event.keys.includes("asciidoc.mermaidThemeVariables")) {
            editors.postMessage(handle, {
              type: "updateEditorTheme",
              editorTheme: await joplin.settings.value("asciidoc.editorTheme"),
              mermaidThemeVariables: await joplin.settings.value("asciidoc.mermaidThemeVariables"),
              isDark: await joplin.shouldUseDarkColors(),
            });
          }
        });
      },

      async onActivationCheck(event: any) {
        if (!event.noteId) return false;
        const note = await joplin.data.get(["notes", event.noteId], {
          fields: ["body"],
        });
        return isAsciiDocNote(note?.body ?? "");
      },
    } as any);
    } catch (e) {
      console.error("[AsciiDoc] Failed to register custom editor:", e);
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
        console.error("[AsciiDoc] Auto-convert failed:", e);
      } finally {
        // Release lock after a delay to let Joplin settle
        setTimeout(() => { autoConvertLock = false; }, 1000);
      }
    });

    } catch (e) {
      console.error("[AsciiDoc] Plugin onStart failed:", e);
    }
  },
});
