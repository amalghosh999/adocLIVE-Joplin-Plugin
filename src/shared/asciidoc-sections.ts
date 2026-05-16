import {
  type AsciiDocAttributeTimeline,
  collectAsciiDocAttributeTimeline,
  getEffectiveAsciiDocAttributeMapAtLine,
} from "./asciidoc-attributes";

export interface DocumentSection {
  anchor: string;
  explicitAnchor?: string;
  reftext?: string;
  lineNumber: number;
  level: number;
  title: string;
}

const HEADING_REGEX = /^(={1,6})\s+(.+)$/;
const EXPLICIT_ANCHOR_REGEX = /^\[\[([^\],\[]+)(?:,([^\]]*))?\]\]\s*$/;
const BLOCK_ATTRIBUTE_REGEX = /^\[([^\]]+)\]\s*$/;
const ID_ATTRIBUTE_REGEX = /(?:^|,)\s*id\s*=\s*(?:"([^"]+)"|'([^']+)'|([^,\s\]]+))/i;

// Strips AsciiDoc inline formatting delimiters from a title before ID normalization.
function stripInlineMarkupForId(title: string): string {
  return title
    .replace(/\*\*(.+?)\*\*/g, "$1")           // **unconstrained bold**
    .replace(/__(.+?)__/g, "$1")                // __unconstrained italic__
    .replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "$1")  // *constrained bold*
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1")    // _constrained italic_
    .replace(/`([^`]+)`/g, "$1")               // `monospace`
    .replace(/\^([^^]+)\^/g, "$1")             // ^superscript^
    .replace(/~([^~]+)~/g, "$1")               // ~subscript~
    .replace(/\[[^\]]*\]#([^#]+)#/g, "$1")    // [.role]#text# (must precede bare #highlight#)
    .replace(/(?<!\w)#([^#]+)#(?!\w)/g, "$1") // #highlight#
    .replace(/pass:\[[^\]]*\]/g, "");           // pass:[...]
}

export interface AnchorOptions {
  idprefix?: string;
  idseparator?: string;
  attributeTimeline?: AsciiDocAttributeTimeline;
}

export function extractDocumentAnchorOptions(content: string): AnchorOptions {
  const timeline = collectAsciiDocAttributeTimeline(content);
  const attributes = getEffectiveAsciiDocAttributeMapAtLine(
    timeline,
    timeline.headerEndLine > 0 ? timeline.headerEndLine + 1 : 1,
  );
  const opts: AnchorOptions = {};
  if (attributes.has("idprefix")) opts.idprefix = attributes.get("idprefix") ?? "";
  if (attributes.has("idseparator")) opts.idseparator = attributes.get("idseparator") ?? "";
  return opts;
}

export function generateSectionAnchor(title: string, opts?: AnchorOptions): string {
  const prefix = opts?.idprefix !== undefined ? opts.idprefix : "_";
  const sep = opts?.idseparator !== undefined ? opts.idseparator : "_";
  const plain = stripInlineMarkupForId(title);
  let normalized = plain
    .toLowerCase()
    .replace(/[^a-z0-9\s._-]/g, "");           // keep alpha, digit, space, dot, hyphen, underscore
  if (sep === "") {
    normalized = normalized.replace(/[\s._-]+/g, "");
  } else {
    const escapedSep = sep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    normalized = normalized
      .replace(/[\s._-]+/g, sep)                  // word delimiters (including dots) → separator
      .replace(new RegExp(`^${escapedSep}+|${escapedSep}+$`, "g"), ""); // trim leading/trailing sep
  }
  return normalized ? `${prefix}${normalized}` : (prefix || sep || "_");
}

export function collectDocumentSections(content: string, opts?: AnchorOptions): DocumentSection[] {
  const sections: DocumentSection[] = [];
  let pendingExplicitAnchor: { id: string; reftext?: string } | undefined;
  const usedAnchors = new Set<string>();
  const timeline = opts?.attributeTimeline;

  for (const [index, line] of content.split("\n").entries()) {
    const trimmed = line.trim();
    const parsed = parseExplicitAnchor(trimmed);
    if (parsed) {
      pendingExplicitAnchor = parsed;
      continue;
    }

    const headingMatch = line.match(HEADING_REGEX);
    if (!headingMatch) {
      if (trimmed !== "") pendingExplicitAnchor = undefined;
      continue;
    }

    const title = headingMatch[2].trim();
    const lineOptions = getAnchorOptionsForLine(index + 1, opts, timeline);
    const generatedAnchor = generateUniqueGeneratedAnchor(title, usedAnchors, lineOptions);
    const anchor = pendingExplicitAnchor?.id || generatedAnchor;
    sections.push({
      anchor,
      explicitAnchor: pendingExplicitAnchor?.id,
      reftext: pendingExplicitAnchor?.reftext,
      lineNumber: index + 1,
      level: headingMatch[1].length,
      title,
    });
    usedAnchors.add(anchor);
    pendingExplicitAnchor = undefined;
  }

  return sections;
}

export function findSectionLineNumber(content: string, anchor: string): number | null {
  const targetAnchor = anchor.trim();
  if (!targetAnchor) return null;

  const timeline = collectAsciiDocAttributeTimeline(content);
  const section = collectDocumentSections(content, {
    ...extractDocumentAnchorOptions(content),
    attributeTimeline: timeline,
  })
    .find((candidate) => candidate.anchor === targetAnchor);
  if (section) return section.lineNumber;

  const lines = content.split("\n");

  // Pass 2: standalone explicit anchor on its own line (non-heading)
  for (let index = 0; index < lines.length; index++) {
    if (parseExplicitAnchor(lines[index].trim())?.id === targetAnchor) {
      return Math.min(index + 2, lines.length);
    }
  }

  // Pass 3: inline [[id]] or [[id,reftext]] within a line
  const inlineAnchorRe = /\[\[([^\[\],]+)(?:,[^\]]*)?\]\]/g;
  for (let index = 0; index < lines.length; index++) {
    let m: RegExpExecArray | null;
    inlineAnchorRe.lastIndex = 0;
    while ((m = inlineAnchorRe.exec(lines[index])) !== null) {
      if (m[1].trim() === targetAnchor) return index + 1;
    }
  }

  return null;
}

function parseExplicitAnchor(trimmedLine: string): { id: string; reftext?: string } | undefined {
  const explicitAnchorMatch = trimmedLine.match(EXPLICIT_ANCHOR_REGEX);
  if (explicitAnchorMatch?.[1].trim()) {
    return {
      id: explicitAnchorMatch[1].trim(),
      reftext: explicitAnchorMatch[2]?.trim() || undefined,
    };
  }

  const blockAttributeMatch = trimmedLine.match(BLOCK_ATTRIBUTE_REGEX);
  if (!blockAttributeMatch) return undefined;

  const attributeText = blockAttributeMatch[1];
  const idAttributeMatch = attributeText.match(ID_ATTRIBUTE_REGEX);
  const idAttribute = idAttributeMatch?.[1] ?? idAttributeMatch?.[2] ?? idAttributeMatch?.[3];
  if (idAttribute?.trim()) return { id: idAttribute.trim() };

  const compactAttribute = attributeText.split(",")[0]?.trim() || "";
  const shorthandIdStart = compactAttribute.indexOf("#");
  if (shorthandIdStart === -1) return undefined;

  const shorthandId = compactAttribute
    .slice(shorthandIdStart + 1)
    .match(/^[^.,%\s\]]+/)?.[0];
  return shorthandId?.trim() ? { id: shorthandId.trim() } : undefined;
}

function generateUniqueGeneratedAnchor(title: string, usedAnchors: Set<string>, opts?: AnchorOptions): string {
  const sep = opts?.idseparator !== undefined ? opts.idseparator : "_";
  const anchor = generateSectionAnchor(title, opts);
  if (!usedAnchors.has(anchor)) return anchor;

  let suffix = 2;
  while (usedAnchors.has(`${anchor}${sep}${suffix}`)) {
    suffix += 1;
  }
  return `${anchor}${sep}${suffix}`;
}

export function extractSectionContent(content: string, anchor: string, opts?: AnchorOptions): string {
  const targetAnchor = anchor.trim();
  if (!targetAnchor) return "";

  const lines = content.split("\n");
  const timeline = opts?.attributeTimeline ?? collectAsciiDocAttributeTimeline(content);
  const sections = collectDocumentSections(content, {
    ...(opts ?? extractDocumentAnchorOptions(content)),
    attributeTimeline: timeline,
  });
  const sectionIndex = sections.findIndex((candidate) => candidate.anchor === targetAnchor);
  if (sectionIndex === -1) return "";

  const section = sections[sectionIndex];
  let endLineNumber = lines.length + 1;
  for (let index = sectionIndex + 1; index < sections.length; index++) {
    if (sections[index].level <= section.level) {
      endLineNumber = sections[index].lineNumber;
      break;
    }
  }

  return lines.slice(section.lineNumber - 1, endLineNumber - 1).join("\n").trim();
}

function getAnchorOptionsForLine(
  lineNumber: number,
  opts?: AnchorOptions,
  timeline?: AsciiDocAttributeTimeline,
): AnchorOptions | undefined {
  if (!timeline) return opts;

  const attributes = getEffectiveAsciiDocAttributeMapAtLine(timeline, lineNumber);
  return {
    idprefix: attributes.has("idprefix") ? attributes.get("idprefix") ?? "" : undefined,
    idseparator: attributes.has("idseparator") ? attributes.get("idseparator") ?? "" : undefined,
  };
}
