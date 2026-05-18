import {
  collectAsciiDocAttributeTimeline,
  getEffectiveAsciiDocAttributeMapAtLine,
  parseAsciiDocBlockAttributeLine,
} from "../../shared/asciidoc-attributes";
import { renderMath, type MathNotation } from "./math-render";

type RawMathNotation = "stem" | MathNotation;

interface MathPlaceholder {
  token: string;
  expression: string;
  notation: MathNotation;
  displayMode: boolean;
}

export interface PrepareAsciiDocMathOptions {
  attributes?: Record<string, unknown>;
}

export interface PreparedAsciiDocMath {
  source: string;
  renderHtml(html: string): string;
}

interface InlineMathMatch {
  start: number;
  end: number;
  rawNotation: RawMathNotation;
  expression: string;
}

const INLINE_MATH_NAMES = new Set(["stem", "latexmath", "asciimath"]);
const SKIPPED_DELIMITED_BLOCKS = new Set(["----", "....", "++++"]);

/**
 * Asciidoctor.js emits STEM as text delimiters and expects the host page to run
 * a math renderer. Mark explicit AsciiDoc math before conversion so we only
 * render math that came from STEM macros/blocks, not arbitrary escaped dollars
 * or TeX-looking prose that happens to appear in the generated HTML.
 */
export function prepareAsciiDocMathForRendering(
  source: string,
  options: PrepareAsciiDocMathOptions = {},
): PreparedAsciiDocMath {
  const normalizedSource = normalizeLineEndings(source);
  const timeline = collectAsciiDocAttributeTimeline(normalizedSource);
  const optionStemNotation = getConfiguredStemNotation(options.attributes);
  const tokenPrefix = createPlaceholderTokenPrefix(normalizedSource);
  const placeholders: MathPlaceholder[] = [];
  const lines = normalizedSource.split("\n");
  const outputLines: string[] = [];
  let skippedBlockDelimiter: string | null = null;

  const addPlaceholder = (
    expression: string,
    rawNotation: RawMathNotation,
    lineNumber: number,
    displayMode: boolean,
  ): string => {
    const token = `${tokenPrefix}${placeholders.length}_TOKEN`;
    placeholders.push({
      token,
      expression,
      notation: resolveMathNotation(rawNotation, lineNumber, timeline, optionStemNotation),
      displayMode,
    });
    return token;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (skippedBlockDelimiter) {
      outputLines.push(line);
      if (trimmed === skippedBlockDelimiter) skippedBlockDelimiter = null;
      continue;
    }

    const mathBlock = getMathBlockStart(line);
    if (mathBlock && lines[index + 1]?.trim() === "++++") {
      const closeIndex = findClosingBlockDelimiter(lines, index + 2, "++++");
      if (closeIndex >= 0) {
        const expression = lines.slice(index + 2, closeIndex).join("\n");
        outputLines.push(line);
        outputLines.push(lines[index + 1]);
        outputLines.push(addPlaceholder(expression, mathBlock, lineNumber, true));
        outputLines.push(lines[closeIndex]);
        index = closeIndex;
        continue;
      }
    }

    if (SKIPPED_DELIMITED_BLOCKS.has(trimmed)) {
      skippedBlockDelimiter = trimmed;
      outputLines.push(line);
      continue;
    }

    outputLines.push(replaceInlineMathMacros(line, lineNumber, addPlaceholder));
  }

  return {
    source: outputLines.join("\n"),
    renderHtml: (html: string) => renderMathPlaceholdersInHtml(html, placeholders),
  };
}

function replaceInlineMathMacros(
  line: string,
  lineNumber: number,
  addPlaceholder: (
    expression: string,
    rawNotation: RawMathNotation,
    lineNumber: number,
    displayMode: boolean,
  ) => string,
): string {
  let output = "";
  let index = 0;

  while (index < line.length) {
    const match = findNextInlineMathMacro(line, index);
    if (!match) {
      output += line.slice(index);
      break;
    }

    output += line.slice(index, match.start);
    output += `${match.rawNotation}:[${addPlaceholder(match.expression, match.rawNotation, lineNumber, false)}]`;
    index = match.end;
  }

  return output;
}

function findNextInlineMathMacro(line: string, startIndex: number): InlineMathMatch | null {
  for (let index = startIndex; index < line.length; index++) {
    if (index > 0 && /[A-Za-z0-9_\\]/.test(line[index - 1])) continue;

    const nameMatch = line.slice(index).match(/^(stem|latexmath|asciimath):\[/);
    if (!nameMatch || !INLINE_MATH_NAMES.has(nameMatch[1])) continue;

    const contentStart = index + nameMatch[1].length + 2;
    const closeIndex = findMatchingBracket(line, contentStart);
    if (closeIndex < 0) return null;

    return {
      start: index,
      end: closeIndex + 1,
      rawNotation: nameMatch[1] as RawMathNotation,
      expression: line.slice(contentStart, closeIndex),
    };
  }

  return null;
}

function findMatchingBracket(line: string, contentStart: number): number {
  let depth = 1;

  for (let index = contentStart; index < line.length; index++) {
    const char = line[index];
    if (char === "\\") {
      index++;
      continue;
    }
    if (char === "[") {
      depth++;
      continue;
    }
    if (char === "]") {
      depth--;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function getMathBlockStart(line: string): RawMathNotation | null {
  const parsed = parseAsciiDocBlockAttributeLine(line);
  if (!parsed) return null;

  const candidates = [
    parsed.style,
    parsed.positional[0],
  ].filter((value): value is string => typeof value === "string");

  for (const value of candidates) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "stem" || normalized === "latexmath" || normalized === "asciimath") {
      return normalized;
    }
  }

  return null;
}

function findClosingBlockDelimiter(lines: string[], startIndex: number, delimiter: string): number {
  for (let index = startIndex; index < lines.length; index++) {
    if (lines[index].trim() === delimiter) return index;
  }
  return -1;
}

function renderMathPlaceholdersInHtml(html: string, placeholders: MathPlaceholder[]): string {
  let output = html;

  for (const placeholder of placeholders) {
    const rendered = renderDelimitedMath(
      placeholder.expression.trim(),
      placeholder.notation,
      placeholder.displayMode,
    );
    for (const delimiter of [
      { open: "\\(", close: "\\)" },
      { open: "\\[", close: "\\]" },
      { open: "\\$", close: "\\$" },
    ]) {
      output = output.replace(
        new RegExp(`${escapeRegExp(delimiter.open)}\\s*${escapeRegExp(placeholder.token)}\\s*${escapeRegExp(delimiter.close)}`, "g"),
        rendered,
      );
    }
  }

  return output;
}

function renderDelimitedMath(expression: string, notation: MathNotation, displayMode: boolean): string {
  const className = displayMode
    ? "cm-rendered-math cm-rendered-math--block"
    : "cm-rendered-math cm-rendered-math--inline";
  return `<span class="${className}">${renderMath(expression, notation, displayMode)}</span>`;
}

function resolveMathNotation(
  rawNotation: RawMathNotation,
  lineNumber: number,
  timeline: ReturnType<typeof collectAsciiDocAttributeTimeline>,
  optionStemNotation: MathNotation | null,
): MathNotation {
  if (rawNotation === "latexmath" || rawNotation === "asciimath") return rawNotation;
  if (optionStemNotation) return optionStemNotation;

  const attributes = getEffectiveAsciiDocAttributeMapAtLine(timeline, lineNumber, { includeLine: true });
  return normalizeStemNotationValue(attributes.get("stem"));
}

function getConfiguredStemNotation(attributes: Record<string, unknown> | undefined): MathNotation | null {
  if (!attributes || !Object.prototype.hasOwnProperty.call(attributes, "stem")) return null;
  return normalizeStemNotationValue(attributes.stem);
}

function normalizeStemNotationValue(value: unknown): MathNotation {
  return String(value ?? "").trim().toLowerCase() === "latexmath" ? "latexmath" : "asciimath";
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function createPlaceholderTokenPrefix(source: string): string {
  for (let index = 0; index < 1000; index++) {
    const prefix = `ADOC_LIVE_RENDERED_MATH_${index}_`;
    if (!source.includes(prefix)) return prefix;
  }
  return `ADOC_LIVE_RENDERED_MATH_${Date.now()}_`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
