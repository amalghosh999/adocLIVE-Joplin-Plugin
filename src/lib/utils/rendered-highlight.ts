import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

type AttributeQuote = "\"" | "'";

interface AttributeMatch {
  full: string;
  value: string;
  quote: AttributeQuote | "";
  index: number;
}

const SOURCE_BLOCK_RE = /<pre\b([^>]*)>\s*<code\b([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi;
const HTML_TAG_RE = /<[a-z][\s\S]*?>/i;

const LANGUAGE_ALIASES = new Map<string, string>([
  ["html", "xml"],
  ["htm", "xml"],
  ["xhtml", "xml"],
  ["svg", "xml"],
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["py", "python"],
  ["rs", "rust"],
  ["sh", "bash"],
  ["shell", "bash"],
  ["zsh", "bash"],
  ["rb", "ruby"],
]);

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("java", java);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("go", go);
hljs.registerLanguage("ruby", ruby);

/**
 * Apply syntax highlighting to Asciidoctor source blocks that declare a known
 * language. This intentionally avoids auto-detection and skips code HTML that
 * already contains markup, so callout markup or pre-highlighted output is not
 * accidentally flattened.
 */
export function highlightRenderedSourceBlocksInHtml(html: string): string {
  return html.replace(SOURCE_BLOCK_RE, (match, preAttrs: string, codeAttrs: string, codeHtml: string) => {
    if (HTML_TAG_RE.test(codeHtml)) return match;

    const language = normalizeLanguage(
      getAttribute(codeAttrs, "data-lang")?.value
        || getLanguageFromClass(codeAttrs)
        || getAttribute(preAttrs, "data-lang")?.value
        || getLanguageFromClass(preAttrs),
    );
    if (!language || !hljs.getLanguage(language)) return match;

    try {
      const highlighted = hljs.highlight(decodeHtmlEntities(codeHtml), {
        language,
        ignoreIllegals: true,
      }).value;
      return `<pre${preAttrs}><code${addClass(codeAttrs, "hljs")}>${highlighted}</code></pre>`;
    } catch {
      return match;
    }
  });
}

function normalizeLanguage(value: string | undefined): string | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  return LANGUAGE_ALIASES.get(normalized) || normalized;
}

function getLanguageFromClass(attributes: string): string | undefined {
  const classValue = getAttribute(attributes, "class")?.value || "";
  for (const className of classValue.split(/\s+/)) {
    const match = className.match(/^language-(.+)$/);
    if (match) return match[1];
  }
  return undefined;
}

function addClass(attributes: string, className: string): string {
  const match = getAttribute(attributes, "class");
  if (!match) return `${attributes} class="${className}"`;

  const classNames = match.value.split(/\s+/).filter(Boolean);
  if (classNames.includes(className)) return attributes;

  const quote = match.quote || "\"";
  const nextValue = `${match.value}${match.value ? " " : ""}${className}`;
  const replacement = ` class=${quote}${escapeAttributeValue(nextValue, quote)}${quote}`;
  return `${attributes.slice(0, match.index)}${replacement}${attributes.slice(match.index + match.full.length)}`;
}

function getAttribute(attributes: string, name: string): AttributeMatch | null {
  const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(attributes);
  if (!match || match.index == null) return null;

  if (match[1] != null) {
    return { full: match[0], value: match[1], quote: "\"", index: match.index };
  }
  if (match[2] != null) {
    return { full: match[0], value: match[2], quote: "'", index: match.index };
  }
  return { full: match[0], value: match[3] || "", quote: "", index: match.index };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeAttributeValue(value: string, quote: AttributeQuote): string {
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return quote === "\"" ? escaped.replace(/"/g, "&quot;") : escaped.replace(/'/g, "&#39;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
