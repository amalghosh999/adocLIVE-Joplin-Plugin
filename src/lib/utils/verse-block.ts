/**
 * Verse block parsing and serialization.
 *
 * Per https://docs.asciidoctor.org/asciidoc/latest/blocks/verses/, an AsciiDoc
 * verse block uses the `verse` block style with optional positional `author`
 * and `citetitle` attributes. The block content can be either a paragraph (no
 * blank lines) following the attribute line, or an excerpt block delimited by
 * four underscores (`____`) which permits blank lines.
 *
 * These helpers cover the attribute-line parse and the source-text serializer.
 * Block detection (deciding paragraph vs. delimited form, finding boundaries)
 * lives in the live-preview decoration engine where document context is
 * already available.
 */

export interface VerseAttrs {
  author: string;
  citetitle: string;
}

/**
 * Parse a `[verse, author, citetitle]` attribute line. Returns `null` if the
 * line is not a verse attribute line. Whitespace surrounding each positional
 * value is trimmed; whitespace inside the value is preserved.
 *
 * Mirrors the simple positional parsing used by the existing `[quote, …]`
 * branch in `live-preview.ts` — quoted/escaped commas are not handled because
 * the spec's positional `author` and `citetitle` values are bare text.
 */
export function parseVerseAttrLine(line: string): VerseAttrs | null {
  const match = line.match(/^\[verse(?:,\s*([^,\]]*?)\s*(?:,\s*(.*?)\s*)?)?\]$/);
  if (!match) return null;
  return {
    author: match[1] ?? "",
    citetitle: match[2] ?? "",
  };
}

/**
 * Serialize a verse block back to AsciiDoc source.
 *
 * Always emits the `____` delimited form on round-trip — matches the
 * existing `serializeBlockquote` choice in `live-preview.ts`. Trailing
 * commas are dropped when citetitle is empty. The whole `[verse]` line is
 * dropped only when both fields are empty AND the source had no attribute
 * line to begin with.
 */
export function serializeVerse(
  author: string,
  citetitle: string,
  content: string,
  hadAttributeLine: boolean,
): string {
  const a = author.trim();
  const c = citetitle.trim();
  const normalizedContent = content.replace(/\r\n?/g, "\n");
  const lines: string[] = [];

  if (hadAttributeLine || a || c) {
    let attr = "[verse";
    if (a || c) attr += `, ${a}`;
    if (c) attr += `, ${c}`;
    attr += "]";
    lines.push(attr);
  }

  lines.push("____", normalizedContent, "____");
  return lines.join("\n");
}
