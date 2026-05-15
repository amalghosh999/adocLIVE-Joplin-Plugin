import {
  collectDocumentSections,
  extractDocumentAnchorOptions,
  type AnchorOptions,
} from "./asciidoc-sections";

export type AsciiDocXrefSyntax = "xref" | "shorthand";

export type DocumentAnchorKind = "section" | "explicit" | "block" | "bibliography";

export interface DocumentAnchor {
  anchor: string;
  kind: DocumentAnchorKind;
  title?: string;
  line: number;
  level?: number;
}

export interface AsciiDocXref {
  syntax: AsciiDocXrefSyntax;
  rawTarget: string;
  noteRef?: string;
  anchor?: string;
  displayText?: string;
  line: number;
  column: number;
}

const XREF_MACRO_RE = /\bxref:([^\s\[]+)\[([^\]]*)\]/g;
const SHORTHAND_XREF_RE = /<<([^<>\n]+?)>>/g;
const INLINE_ANCHOR_RE = /\[\[([^\[\],]+)(?:,([^\]]*))?\]\]/g;
const BIBLIOGRAPHY_ANCHOR_RE = /\[\[\[([^\]\[]+)\]\]\]/g;
const BLOCK_ATTRIBUTE_RE = /^\[([^\]]+)\]\s*$/;
const ID_ATTRIBUTE_RE = /(?:^|,)\s*id\s*=\s*(?:"([^"]+)"|'([^']+)'|([^,\s\]]+))/i;

export function extractAsciiDocXrefs(content: string): AsciiDocXref[] {
  const lineStarts = computeLineStarts(content);
  const links: AsciiDocXref[] = [];

  let match: RegExpExecArray | null;
  XREF_MACRO_RE.lastIndex = 0;
  while ((match = XREF_MACRO_RE.exec(content)) !== null) {
    const rawTarget = match[1].trim();
    if (!rawTarget || isExternalTarget(rawTarget)) continue;
    links.push({
      syntax: "xref",
      rawTarget,
      displayText: normalizeOptionalText(match[2]),
      ...parseXrefTarget(rawTarget),
      ...lineColumnForOffset(lineStarts, match.index),
    });
  }

  SHORTHAND_XREF_RE.lastIndex = 0;
  while ((match = SHORTHAND_XREF_RE.exec(content)) !== null) {
    const shorthand = splitShorthandXref(match[1]);
    if (!shorthand.rawTarget || isExternalTarget(shorthand.rawTarget)) continue;
    links.push({
      syntax: "shorthand",
      rawTarget: shorthand.rawTarget,
      displayText: shorthand.displayText,
      ...parseXrefTarget(shorthand.rawTarget),
      ...lineColumnForOffset(lineStarts, match.index),
    });
  }

  links.sort((a, b) => a.line - b.line || a.column - b.column || a.rawTarget.localeCompare(b.rawTarget));
  return links;
}

export function parseXrefTarget(rawTarget: string): { noteRef?: string; anchor?: string } {
  const target = rawTarget.trim();
  if (!target) return {};
  const normalizedTarget = normalizeBibliographyShorthandTarget(target);

  if (normalizedTarget.startsWith("#")) {
    const anchor = normalizedTarget.slice(1).trim();
    return anchor ? { anchor } : {};
  }

  const hashIndex = normalizedTarget.indexOf("#");
  if (hashIndex >= 0) {
    const noteRef = normalizedTarget.slice(0, hashIndex).trim();
    const anchor = normalizedTarget.slice(hashIndex + 1).trim();
    return {
      ...(noteRef ? { noteRef } : {}),
      ...(anchor ? { anchor } : {}),
    };
  }

  if (looksLikeNoteReference(normalizedTarget)) {
    return { noteRef: normalizedTarget };
  }

  return { anchor: normalizedTarget };
}

export function collectDocumentAnchors(content: string, opts?: AnchorOptions): DocumentAnchor[] {
  const effectiveOptions = opts ?? extractDocumentAnchorOptions(content);
  const sections = collectDocumentSections(content, effectiveOptions);
  const sectionsByLine = new Map<number, typeof sections>();
  for (const section of sections) {
    const lineSections = sectionsByLine.get(section.lineNumber) ?? [];
    lineSections.push(section);
    sectionsByLine.set(section.lineNumber, lineSections);
  }

  const anchors: DocumentAnchor[] = [];
  const byAnchor = new Map<string, DocumentAnchor>();
  const lines = content.split("\n");

  const addAnchor = (anchor: DocumentAnchor): void => {
    const id = anchor.anchor.trim();
    if (!id) return;
    const normalized = { ...anchor, anchor: id };
    const existing = byAnchor.get(id);
    if (!existing) {
      byAnchor.set(id, normalized);
      anchors.push(normalized);
      return;
    }
    if (
      existing.line === normalized.line &&
      normalized.kind === "section" &&
      existing.kind !== "section"
    ) {
      Object.assign(existing, normalized);
    }
  };

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = lines[index];

    let bibliographyMatch: RegExpExecArray | null;
    BIBLIOGRAPHY_ANCHOR_RE.lastIndex = 0;
    while ((bibliographyMatch = BIBLIOGRAPHY_ANCHOR_RE.exec(line)) !== null) {
      const id = bibliographyMatch[1]?.trim();
      if (id) addAnchor({ anchor: id, kind: "bibliography", line: lineNumber });
    }

    let inlineMatch: RegExpExecArray | null;
    INLINE_ANCHOR_RE.lastIndex = 0;
    while ((inlineMatch = INLINE_ANCHOR_RE.exec(line)) !== null) {
      const id = inlineMatch[1]?.trim();
      if (!id) continue;
      const standalone = line.trim() === inlineMatch[0];
      addAnchor({
        anchor: id,
        kind: "explicit",
        title: inlineMatch[2]?.trim() || undefined,
        line: standalone ? Math.min(lineNumber + 1, lines.length) : lineNumber,
      });
    }

    const blockId = parseBlockAttributeAnchor(line.trim());
    if (blockId) {
      addAnchor({
        anchor: blockId,
        kind: "block",
        line: Math.min(lineNumber + 1, lines.length),
      });
    }

    for (const section of sectionsByLine.get(lineNumber) ?? []) {
      addAnchor({
        anchor: section.anchor,
        kind: "section",
        title: section.reftext || section.title,
        line: section.lineNumber,
        level: section.level,
      });
    }
  }

  return anchors;
}

function splitShorthandXref(inner: string): { rawTarget: string; displayText?: string } {
  const commaIndex = inner.indexOf(",");
  if (commaIndex === -1) {
    return { rawTarget: inner.trim() };
  }
  return {
    rawTarget: inner.slice(0, commaIndex).trim(),
    displayText: normalizeOptionalText(inner.slice(commaIndex + 1)),
  };
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : undefined;
}

function normalizeBibliographyShorthandTarget(target: string): string {
  const match = target.match(/^\[([^\]\[]+)\]$/);
  return match?.[1]?.trim() || target;
}

function looksLikeNoteReference(target: string): boolean {
  if (target.startsWith("/") || target.startsWith("./") || target.startsWith("../")) return true;
  if (target.includes("/")) return true;
  return /\.(?:adoc|asciidoc|html?|txt|md)$/i.test(target);
}

function isExternalTarget(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function parseBlockAttributeAnchor(trimmedLine: string): string | null {
  const blockAttributeMatch = trimmedLine.match(BLOCK_ATTRIBUTE_RE);
  if (!blockAttributeMatch) return null;

  const attributeText = blockAttributeMatch[1];
  const idAttributeMatch = attributeText.match(ID_ATTRIBUTE_RE);
  const idAttribute = idAttributeMatch?.[1] ?? idAttributeMatch?.[2] ?? idAttributeMatch?.[3];
  if (idAttribute?.trim()) return idAttribute.trim();

  const compactAttribute = attributeText.split(",")[0]?.trim() || "";
  const shorthandIdStart = compactAttribute.indexOf("#");
  if (shorthandIdStart === -1) return null;

  const shorthandId = compactAttribute
    .slice(shorthandIdStart + 1)
    .match(/^[^.,%\s\]]+/)?.[0];
  return shorthandId?.trim() || null;
}

function computeLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function lineColumnForOffset(lineStarts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIndex = Math.max(0, high);
  return {
    line: lineIndex + 1,
    column: offset - lineStarts[lineIndex] + 1,
  };
}
