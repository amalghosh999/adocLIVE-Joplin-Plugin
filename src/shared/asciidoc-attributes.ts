export interface AsciiDocAttributeEntry {
  lineNumber: number;
  name: string;
  value: string;
  unset: boolean;
}

export interface AsciiDocAttributeState {
  attributes: Map<string, string>;
  unsetAttributes: Set<string>;
}

export interface AsciiDocAttributeTimeline {
  lineCount: number;
  headerEndLine: number;
  documentHeader: AsciiDocDocumentHeader;
  entries: AsciiDocAttributeEntry[];
}

export interface AsciiDocHeaderControlRange {
  startLine: number;
  endLine: number;
}

export interface AsciiDocDocumentHeader {
  titleLine: number;
  authorLine: number;
  titleRoles: string[];
  headerStartLine: number;
  headerEndLine: number;
  implicitEntries: AsciiDocAttributeEntry[];
  explicitEntries: AsciiDocAttributeEntry[];
  controlRanges: AsciiDocHeaderControlRange[];
}

export interface LivePreviewAsciiDocAttributeList {
  style?: string;
  id?: string;
  roles: string[];
  options: Set<string>;
  positional: string[];
  named: Map<string, string>;
}

const ATTRIBUTE_ENTRY_RE = /^:([^:]+):\s*(.*)$/;
const BLOCK_ATTRIBUTE_RE = /^\[([^\]]+)\]\s*$/;

export function normalizeAsciiDocAttributeName(name: string): string {
  return name.trim().toLowerCase();
}

export function parseAsciiDocAttributeEntry(line: string, lineNumber: number): AsciiDocAttributeEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("::")) return null;

  const match = trimmed.match(ATTRIBUTE_ENTRY_RE);
  if (!match) return null;

  const rawName = match[1].trim();
  const rawValue = match[2] ?? "";
  if (!rawName) return null;

  const leadingUnset = rawName.startsWith("!");
  const trailingUnset = rawName.endsWith("!");
  if ((leadingUnset || trailingUnset) && rawValue.trim() === "") {
    const unsetName = normalizeAsciiDocAttributeName(
      leadingUnset ? rawName.slice(1) : rawName.slice(0, -1),
    );
    if (!unsetName) return null;
    return {
      lineNumber,
      name: unsetName,
      value: "",
      unset: true,
    };
  }

  return {
    lineNumber,
    name: normalizeAsciiDocAttributeName(rawName),
    value: rawValue,
    unset: false,
  };
}

export function parseAsciiDocAttributeList(attributeText: string): LivePreviewAsciiDocAttributeList {
  const parsed: LivePreviewAsciiDocAttributeList = {
    roles: [],
    options: new Set<string>(),
    positional: [],
    named: new Map<string, string>(),
  };

  const attributes = splitAsciiDocAttributeList(attributeText);
  let sawFirstAttribute = false;

  for (const rawAttribute of attributes) {
    const trimmed = rawAttribute.trim();
    const named = parseNamedAttribute(trimmed);

    if (named) {
      parsed.named.set(named.name, named.value);

      if (named.name === "id") {
        parsed.id = named.value;
      } else if (named.name === "role") {
        parsed.roles.push(...splitRoleValues(named.value));
      } else if (named.name === "options" || named.name === "opts") {
        for (const option of splitOptionValues(named.value)) {
          parsed.options.add(option);
        }
      }

      sawFirstAttribute = true;
      continue;
    }

    if (!sawFirstAttribute) {
      const shorthand = parseAsciiDocShorthandAttribute(trimmed);
      if (shorthand.hasShorthand) {
        if (shorthand.style) {
          parsed.style = shorthand.style;
          parsed.positional.push(shorthand.style);
        }
        if (shorthand.id) parsed.id = shorthand.id;
        parsed.roles.push(...shorthand.roles);
        for (const option of shorthand.options) parsed.options.add(option);
      } else {
        const positional = stripAsciiDocAttributeQuotes(trimmed);
        parsed.positional.push(positional);
        if (positional) parsed.style = positional;
      }
      sawFirstAttribute = true;
      continue;
    }

    parsed.positional.push(stripAsciiDocAttributeQuotes(trimmed));
  }

  parsed.roles = uniqueRoleValues(parsed.roles);
  return parsed;
}

export function parseAsciiDocBlockAttributeLine(line: string): LivePreviewAsciiDocAttributeList | null {
  const attributeText = getBlockAttributeText(line);
  return attributeText == null ? null : parseAsciiDocAttributeList(attributeText);
}

export function parseAsciiDocRoleAttribute(line: string): string[] {
  return parseAsciiDocBlockAttributeLine(line)?.roles ?? [];
}

export function parseAsciiDocRoleOnlyAttribute(line: string): string[] {
  const parsed = parseAsciiDocBlockAttributeLine(line);
  if (!parsed || parsed.roles.length === 0) return [];
  if (parsed.style || parsed.options.size > 0) return [];
  if (parsed.positional.some(value => value.trim())) return [];

  const allowedNamed = new Set(["id", "role", "reftext"]);
  for (const key of parsed.named.keys()) {
    if (!allowedNamed.has(key)) return [];
  }

  return parsed.roles;
}

export function collectAsciiDocAttributeTimeline(content: string): AsciiDocAttributeTimeline {
  const lines = content.split(/\r?\n/);
  const header = scanAsciiDocDocumentHeader(lines);
  const entries: Array<AsciiDocAttributeEntry & { order: number }> = [];
  let order = 0;

  for (const entry of header.implicitEntries) {
    entries.push({ ...entry, order: order++ });
  }

  let openDelimiter: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const trimmed = lines[index].trim();

    if (openDelimiter) {
      if (getDelimitedBlockToken(trimmed) === openDelimiter) {
        openDelimiter = null;
      }
      continue;
    }

    const entry = parseAsciiDocAttributeEntry(lines[index], lineNumber);
    if (entry) {
      entries.push({ ...entry, order: order++ });
    }

    const delimiter = getDelimitedBlockToken(trimmed);
    if (delimiter) {
      openDelimiter = delimiter;
    }
  }

  entries.sort((a, b) => a.lineNumber - b.lineNumber || a.order - b.order);

  return {
    lineCount: lines.length,
    headerEndLine: header.headerEndLine,
    documentHeader: header,
    entries: entries.map(({ order: _order, ...entry }) => entry),
  };
}

export function getEffectiveAsciiDocAttributesAtLine(
  timeline: AsciiDocAttributeTimeline,
  lineNumber: number,
  options: { includeLine?: boolean } = {},
): AsciiDocAttributeState {
  const attributes = new Map<string, string>();
  const unsetAttributes = new Set<string>();
  const includeLine = options.includeLine === true;

  for (const entry of timeline.entries) {
    const applies = includeLine ? entry.lineNumber <= lineNumber : entry.lineNumber < lineNumber;
    if (!applies) break;

    if (entry.unset) {
      attributes.delete(entry.name);
      unsetAttributes.add(entry.name);
    } else {
      attributes.set(entry.name, entry.value);
      unsetAttributes.delete(entry.name);
    }
  }

  return { attributes, unsetAttributes };
}

export function getEffectiveAsciiDocAttributeMapAtLine(
  timeline: AsciiDocAttributeTimeline,
  lineNumber: number,
  options: { includeLine?: boolean } = {},
): Map<string, string> {
  return getEffectiveAsciiDocAttributesAtLine(timeline, lineNumber, options).attributes;
}

export function scanAsciiDocDocumentHeader(contentOrLines: string | string[]): AsciiDocDocumentHeader {
  const lines = Array.isArray(contentOrLines)
    ? contentOrLines
    : contentOrLines.split(/\r?\n/);
  let index = 0;
  let titleLine = -1;
  let authorLine = -1;
  let headerStartLine = 0;
  let headerEndLine = 0;
  const implicitEntries: AsciiDocAttributeEntry[] = [];
  const preTitleEntries: AsciiDocAttributeEntry[] = [];
  const topHeaderEntries: AsciiDocAttributeEntry[] = [];
  const preTitleControlLines: number[] = [];
  const topHeaderControlLines: number[] = [];
  const titleRoles: string[] = [];
  let topHeaderOpen = true;
  let sawTopHeaderAttribute = false;
  let sawPreTitleControl = false;

  while (index < lines.length && !lines[index].trim()) index++;

  while (index < lines.length) {
    const lineNumber = index + 1;
    const trimmed = lines[index].trim();
    const delimiter = getDelimitedBlockToken(trimmed);
    if (delimiter) break;

    const entry = parseAsciiDocAttributeEntry(lines[index], lineNumber);
    if (entry) {
      preTitleEntries.push(entry);
      preTitleControlLines.push(lineNumber);
      sawPreTitleControl = true;

      if (topHeaderOpen) {
        topHeaderEntries.push(entry);
        topHeaderControlLines.push(lineNumber);
        sawTopHeaderAttribute = true;
      }

      index++;
      continue;
    }

    if (!trimmed || isAsciiDocLineComment(trimmed)) {
      if (sawPreTitleControl || isAsciiDocLineComment(trimmed)) {
        preTitleControlLines.push(lineNumber);
      }
      if (topHeaderOpen && isAsciiDocLineComment(trimmed)) {
        topHeaderControlLines.push(lineNumber);
      }
      if (!trimmed && sawTopHeaderAttribute) {
        topHeaderOpen = false;
      }
      index++;
      continue;
    }

    if (isTitleAdjacentBlockAttribute(trimmed)) {
      titleRoles.push(...parseAsciiDocRoleAttribute(trimmed));
      preTitleControlLines.push(lineNumber);
      sawPreTitleControl = true;
      topHeaderOpen = false;
      index++;
      continue;
    }

    if (/^=\s+/.test(trimmed)) {
      titleLine = lineNumber;
      headerStartLine = preTitleControlLines.length > 0
        ? Math.min(...preTitleControlLines)
        : titleLine;
      headerEndLine = titleLine;
      index++;
      break;
    }

    break;
  }

  if (titleLine < 0) {
    if (!sawTopHeaderAttribute || topHeaderEntries.length === 0) {
      return createEmptyDocumentHeader();
    }

    return {
      titleLine: -1,
      authorLine: -1,
      titleRoles: [],
      headerStartLine: Math.min(...topHeaderControlLines),
      headerEndLine: Math.max(...topHeaderEntries.map(entry => entry.lineNumber)),
      implicitEntries,
      explicitEntries: topHeaderEntries,
      controlRanges: lineNumbersToRanges(
        topHeaderControlLines.filter(lineNumber => lineNumber <= Math.max(...topHeaderEntries.map(entry => entry.lineNumber))),
      ),
    };
  }

  const explicitEntries = [...preTitleEntries];
  const controlLines = [...preTitleControlLines];

  if (index < lines.length) {
    const candidate = lines[index].trim();
    if (
      candidate
      && !candidate.startsWith(":")
      && !candidate.startsWith("[")
      && !candidate.startsWith("=")
      && !isAsciiDocLineComment(candidate)
      && !getDelimitedBlockToken(candidate)
    ) {
      const authorMatch = candidate.match(/^([^<;]+?)(?:\s+<([^>]+)>)?$/);
      if (authorMatch) {
        authorLine = index + 1;
        headerEndLine = authorLine;
        controlLines.push(authorLine);
        const namePart = authorMatch[1].trim();
        const email = authorMatch[2] || "";
        const nameParts = namePart.split(/\s+/).filter(Boolean);
        const firstname = nameParts[0] || "";
        const lastname = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
        const middlename = nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : "";
        const initials = nameParts.map((name) => name[0]?.toUpperCase() || "").join("");

        pushImplicitAttribute(implicitEntries, authorLine, "author", namePart);
        if (firstname) pushImplicitAttribute(implicitEntries, authorLine, "firstname", firstname);
        if (middlename) pushImplicitAttribute(implicitEntries, authorLine, "middlename", middlename);
        if (lastname) pushImplicitAttribute(implicitEntries, authorLine, "lastname", lastname);
        if (initials) pushImplicitAttribute(implicitEntries, authorLine, "authorinitials", initials);
        if (email) pushImplicitAttribute(implicitEntries, authorLine, "email", email);
        index++;
      }
    }
  }

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) break;
    const entry = parseAsciiDocAttributeEntry(lines[index], index + 1);
    if (!entry) break;
    explicitEntries.push(entry);
    controlLines.push(index + 1);
    headerEndLine = index + 1;
    index++;
  }

  return {
    titleLine,
    authorLine,
    titleRoles,
    headerStartLine,
    headerEndLine,
    implicitEntries,
    explicitEntries,
    controlRanges: lineNumbersToRanges(controlLines.filter(lineNumber => lineNumber !== titleLine)),
  };
}

function pushImplicitAttribute(
  entries: AsciiDocAttributeEntry[],
  lineNumber: number,
  name: string,
  value: string,
): void {
  entries.push({
    lineNumber,
    name,
    value,
    unset: false,
  });
}

function getDelimitedBlockToken(trimmed: string): string | null {
  if (!trimmed) return null;
  if (trimmed === "|===" || trimmed === ",===" || trimmed === ":===" || trimmed === "--") {
    return trimmed;
  }

  const match = trimmed.match(/^([\-.*_+=/])\1{3,}$/);
  return match ? match[1] : null;
}

function createEmptyDocumentHeader(): AsciiDocDocumentHeader {
  return {
    titleLine: -1,
    authorLine: -1,
    titleRoles: [],
    headerStartLine: 0,
    headerEndLine: 0,
    implicitEntries: [],
    explicitEntries: [],
    controlRanges: [],
  };
}

function isAsciiDocLineComment(trimmed: string): boolean {
  return trimmed.startsWith("//") && !getDelimitedBlockToken(trimmed);
}

function isTitleAdjacentBlockAttribute(trimmed: string): boolean {
  return /^\[\[([^\],\[]+)(?:,[^\]]*)?\]\]\s*$/.test(trimmed)
    || /^\[[^\]]+\]\s*$/.test(trimmed);
}

function lineNumbersToRanges(lineNumbers: number[]): AsciiDocHeaderControlRange[] {
  const sorted = [...new Set(lineNumbers)]
    .filter(lineNumber => lineNumber > 0)
    .sort((a, b) => a - b);
  const ranges: AsciiDocHeaderControlRange[] = [];
  for (const lineNumber of sorted) {
    const current = ranges[ranges.length - 1];
    if (current && current.endLine + 1 === lineNumber) {
      current.endLine = lineNumber;
    } else {
      ranges.push({ startLine: lineNumber, endLine: lineNumber });
    }
  }
  return ranges;
}

function getBlockAttributeText(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.startsWith("[[")) return null;
  return trimmed.match(BLOCK_ATTRIBUTE_RE)?.[1] ?? null;
}

function splitAsciiDocAttributeList(attributeText: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (const char of attributeText) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote != null) {
      current += char;
      escaped = true;
      continue;
    }
    if ((char === "\"" || char === "'") && quote == null) {
      quote = char;
      current += char;
      continue;
    }
    if (char === quote) {
      quote = null;
      current += char;
      continue;
    }
    if (char === "," && quote == null) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  result.push(current);
  return result;
}

function parseNamedAttribute(attribute: string): { name: string; value: string } | null {
  const eqIndex = attribute.indexOf("=");
  if (eqIndex < 0) return null;

  const rawName = attribute.slice(0, eqIndex).trim();
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(rawName)) return null;

  return {
    name: rawName.toLowerCase(),
    value: stripAsciiDocAttributeQuotes(attribute.slice(eqIndex + 1).trim()),
  };
}

function stripAsciiDocAttributeQuotes(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== "\"" && quote !== "'") || value[value.length - 1] !== quote) return value;
  const unquoted = value.slice(1, -1);
  const escapedQuote = new RegExp(`\\\\${quote}`, "g");
  return unquoted.replace(escapedQuote, quote);
}

function splitOptionValues(value: string): string[] {
  return value
    .split(",")
    .map(option => option.trim())
    .filter(Boolean);
}

function parseAsciiDocShorthandAttribute(attribute: string): {
  hasShorthand: boolean;
  style: string;
  id: string;
  roles: string[];
  options: string[];
} {
  const result = {
    hasShorthand: false,
    style: "",
    id: "",
    roles: [] as string[],
    options: [] as string[],
  };

  const firstMarkerIndex = attribute.search(/[.#%]/);
  if (firstMarkerIndex < 0) return result;

  result.hasShorthand = true;
  result.style = attribute.slice(0, firstMarkerIndex).trim();

  let index = firstMarkerIndex;
  while (index < attribute.length) {
    const marker = attribute[index];
    const nextMarkerIndex = findNextShorthandMarker(attribute, index + 1);
    const value = attribute.slice(index + 1, nextMarkerIndex).trim();

    if (value) {
      if (marker === "#") {
        result.id = value;
      } else if (marker === ".") {
        result.roles.push(...splitRoleValues(value));
      } else if (marker === "%") {
        result.options.push(value);
      }
    }

    index = nextMarkerIndex;
  }

  return result;
}

function findNextShorthandMarker(value: string, startIndex: number): number {
  for (let index = startIndex; index < value.length; index++) {
    if (value[index] === "." || value[index] === "#" || value[index] === "%") {
      return index;
    }
  }
  return value.length;
}

function splitRoleValues(value: string): string[] {
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .split(/\s+/)
    .map(role => role.trim())
    .filter(Boolean);
}

function uniqueRoleValues(roles: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const role of roles) {
    if (seen.has(role)) continue;
    seen.add(role);
    result.push(role);
  }
  return result;
}
