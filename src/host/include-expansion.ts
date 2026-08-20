export interface ResolvedEditorInclude {
  id: string;
  key: string;
  title: string;
  content: string;
  asciidoc: boolean;
}

export type AsyncIncludeResolver = (fromDocumentId: string, rawTarget: string) => Promise<ResolvedEditorInclude | null>;
export type SyncIncludeResolver = (fromDocumentId: string, rawTarget: string) => ResolvedEditorInclude | null;

interface ParsedIncludeDirective {
  target: string;
  optional: boolean;
  lines?: string;
  tag?: string;
  tags?: string;
  levelOffset?: string;
  indent?: string;
}

const TAG_DIRECTIVE_PATTERN = /\b(tag|end)::([^\s\[]+)\[\](?=\s|$)/g;

function splitQuoted(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  for (const character of value) {
    if ((character === "\"" || character === "'") && (!quote || quote === character)) {
      quote = quote ? null : character;
      current += character;
    } else if (!quote && character === separator) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts;
}

function stripQuoted(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

function parseDirective(line: string): ParsedIncludeDirective | null {
  const match = line.match(/^\s*include::([^\[]+)\[(.*)\]\s*$/);
  if (!match) return null;
  const attributes = new Map<string, string>();
  for (const rawPart of splitQuoted(match[2] || "", ",")) {
    const part = rawPart.trim();
    if (!part) continue;
    const equals = part.indexOf("=");
    if (equals < 0) attributes.set(part.toLocaleLowerCase(), "");
    else attributes.set(part.slice(0, equals).trim().toLocaleLowerCase(), stripQuoted(part.slice(equals + 1).trim()));
  }
  const options = (attributes.get("opts") || "").split(/[;,]/).map(value => value.trim().toLocaleLowerCase()).filter(Boolean);
  return {
    target: stripQuoted(match[1].trim()),
    optional: attributes.has("optional") || options.includes("optional"),
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

function effectiveLevelOffset(current: number, rawValue?: string): number {
  const value = (rawValue || "").trim();
  if (!value) return current;
  if (/^[+-]\d+$/.test(value)) return current + Number.parseInt(value, 10);
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  return current;
}

function offsetHeading(line: string, levelOffset: number): string {
  if (!levelOffset) return line;
  const match = line.match(/^(\s*)(={1,6})(\s+.*)$/);
  if (!match) return line;
  const nextLevel = Math.max(1, Math.min(6, match[2].length + levelOffset));
  return `${match[1]}${"=".repeat(nextLevel)}${match[3]}`;
}

function tagDirectives(line: string): Array<{ kind: "tag" | "end"; name: string }> {
  const result: Array<{ kind: "tag" | "end"; name: string }> = [];
  TAG_DIRECTIVE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_DIRECTIVE_PATTERN.exec(line)) !== null) result.push({ kind: match[1] as "tag" | "end", name: match[2] });
  return result;
}

function hasTagDirective(line: string): boolean {
  TAG_DIRECTIVE_PATTERN.lastIndex = 0;
  return TAG_DIRECTIVE_PATTERN.test(line);
}

function filterTags(source: string, specification: string): string {
  const lines = normalizeLineEndings(source).split("\n");
  const selected = specification.split(/[;,]/).map(tag => tag.trim()).filter(Boolean);
  if (selected.length === 0) return source;
  if (selected.includes("**")) return lines.filter(line => !hasTagDirective(line)).join("\n");
  const active = new Map<string, number>();
  const wanted = new Set(selected);
  const output: string[] = [];
  for (const line of lines) {
    const directives = tagDirectives(line);
    if (directives.length > 0) {
      for (const directive of directives) {
        const count = active.get(directive.name) || 0;
        if (directive.kind === "tag") active.set(directive.name, count + 1);
        else if (count <= 1) active.delete(directive.name);
        else active.set(directive.name, count - 1);
      }
    } else if ([...wanted].some(tag => (active.get(tag) || 0) > 0)) {
      output.push(line);
    }
  }
  return output.join("\n");
}

function normalizedLine(value: string | undefined, total: number, fallback: number): number {
  if (value == null || value === "") return fallback;
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric === -1) return total;
  return Math.max(1, Math.min(total, numeric));
}

function filterLines(source: string, specification: string): string {
  const lines = normalizeLineEndings(source).split("\n");
  const selected = new Set<number>();
  for (const part of specification.split(/[;,]/).map(value => value.trim()).filter(Boolean)) {
    const range = part.match(/^(-?\d+)?\.\.(-?\d+)?$/);
    if (range) {
      const start = normalizedLine(range[1], lines.length, 1);
      const end = normalizedLine(range[2], lines.length, lines.length);
      for (let line = start; line <= end; line += 1) selected.add(line);
    } else if (/^-?\d+$/.test(part)) {
      selected.add(normalizedLine(part, lines.length, 1));
    }
  }
  return lines.filter((_line, index) => selected.has(index + 1)).join("\n");
}

function applyIndent(source: string, specification: string): string {
  const indent = Number.parseInt(specification, 10);
  if (!Number.isFinite(indent) || indent < 0) return source;
  const lines = normalizeLineEndings(source).split("\n");
  let minimum = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (!line.trim()) continue;
    const leading = line.match(/^[ \t]+/);
    if (!leading) return source;
    minimum = Math.min(minimum, leading[0].length);
  }
  if (!Number.isFinite(minimum)) return source;
  return lines.map(line => `${" ".repeat(indent)}${line ? line.slice(Math.min(minimum, line.length)) : ""}`).join("\n");
}

function transform(source: string, directive: ParsedIncludeDirective, levelOffset: number): { source: string; levelOffset: number } {
  let result = normalizeLineEndings(source);
  const tagSpecification = (directive.tags || directive.tag || "").trim();
  if (tagSpecification) result = filterTags(result, tagSpecification);
  if (directive.lines?.trim()) result = filterLines(result, directive.lines.trim());
  if (directive.indent?.trim()) result = applyIndent(result, directive.indent.trim());
  return { source: result, levelOffset: effectiveLevelOffset(levelOffset, directive.levelOffset) };
}

function missingInclude(indent: string, target: string): string[] {
  return [`${indent}[WARNING]`, `${indent}====`, `${indent}Missing include: ${target}`, `${indent}====`];
}

function cyclicInclude(indent: string, title: string): string[] {
  return [`${indent}[WARNING]`, `${indent}====`, `${indent}Cyclic include skipped: ${title}`, `${indent}====`];
}

export async function expandEditorIncludes(
  source: string,
  fromDocumentId: string,
  resolve: AsyncIncludeResolver,
  seen = new Set<string>(),
  levelOffset = 0,
): Promise<string> {
  const output: string[] = [];
  for (const line of normalizeLineEndings(source).split("\n")) {
    const directive = parseDirective(line);
    if (!directive) {
      output.push(offsetHeading(line, levelOffset));
      continue;
    }
    const indent = line.match(/^(\s*)/)?.[1] || "";
    const target = await resolve(fromDocumentId, directive.target);
    if (!target) {
      if (!directive.optional) output.push(...missingInclude(indent, directive.target));
      continue;
    }
    if (seen.has(target.key)) {
      output.push(...cyclicInclude(indent, target.title));
      continue;
    }
    const nextSeen = new Set(seen).add(target.key);
    const transformed = transform(target.content, directive, levelOffset);
    const expanded = target.asciidoc
      ? await expandEditorIncludes(transformed.source, target.id, resolve, nextSeen, transformed.levelOffset)
      : transformed.source;
    output.push(...expanded.split("\n").map(included => indent ? indent + included : included));
  }
  return output.join("\n");
}

export function expandEditorIncludesSync(
  source: string,
  fromDocumentId: string,
  resolve: SyncIncludeResolver,
  seen = new Set<string>(),
  levelOffset = 0,
): string {
  const output: string[] = [];
  for (const line of normalizeLineEndings(source).split("\n")) {
    const directive = parseDirective(line);
    if (!directive) {
      output.push(offsetHeading(line, levelOffset));
      continue;
    }
    const indent = line.match(/^(\s*)/)?.[1] || "";
    const target = resolve(fromDocumentId, directive.target);
    if (!target) {
      if (!directive.optional) output.push(...missingInclude(indent, directive.target));
      continue;
    }
    if (seen.has(target.key)) {
      output.push(...cyclicInclude(indent, target.title));
      continue;
    }
    const transformed = transform(target.content, directive, levelOffset);
    const expanded = target.asciidoc
      ? expandEditorIncludesSync(transformed.source, target.id, resolve, new Set(seen).add(target.key), transformed.levelOffset)
      : transformed.source;
    output.push(...expanded.split("\n").map(included => indent ? indent + included : included));
  }
  return output.join("\n");
}
