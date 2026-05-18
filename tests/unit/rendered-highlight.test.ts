import { describe, expect, it } from "vitest";

import { highlightRenderedSourceBlocksInHtml } from "../../src/lib/utils/rendered-highlight";

const Asciidoctor = require("asciidoctor");
const asciidoctor = Asciidoctor();

function convertAsciiDoc(source: string): string {
  return String(asciidoctor.convert(source, {
    safe: "safe",
    backend: "html5",
    standalone: false,
  }));
}

describe("highlightRenderedSourceBlocksInHtml", () => {
  it("highlights known TypeScript source blocks without auto-detection", () => {
    const html = convertAsciiDoc([
      "[source,typescript]",
      "----",
      "type Annotation = { id: string; page: number };",
      "----",
    ].join("\n"));

    const rendered = highlightRenderedSourceBlocksInHtml(html);

    expect(rendered).toContain("language-typescript hljs");
    expect(rendered).toContain("hljs-keyword");
    expect(rendered).toContain("hljs-title");
  });

  it("highlights known Bash source blocks", () => {
    const html = convertAsciiDoc([
      "[source,bash]",
      "----",
      "if [ -f package.json ]; then echo \"ok\"; fi",
      "----",
    ].join("\n"));

    const rendered = highlightRenderedSourceBlocksInHtml(html);

    expect(rendered).toContain("language-bash hljs");
    expect(rendered).toContain("hljs-keyword");
    expect(rendered).toContain("hljs-string");
  });

  it("leaves unknown source languages unchanged", () => {
    const html = convertAsciiDoc([
      "[source,definitely-not-a-language]",
      "----",
      "some unknown syntax",
      "----",
    ].join("\n"));

    expect(highlightRenderedSourceBlocksInHtml(html)).toBe(html);
  });

  it("keeps escaped HTML escaped while highlighting known languages", () => {
    const html = convertAsciiDoc([
      "[source,javascript]",
      "----",
      "const tag = \"<script>alert(1)</script>\";",
      "----",
    ].join("\n"));

    const rendered = highlightRenderedSourceBlocksInHtml(html);

    expect(rendered).toContain("hljs-string");
    expect(rendered).toContain("&lt;script&gt;");
    expect(rendered).not.toContain("<script>alert");
    expect(rendered).not.toContain("</script>");
  });

  it("does not flatten existing source-block markup such as callout markers", () => {
    const html = [
      '<pre class="highlight">',
      '<code class="language-javascript" data-lang="javascript">const x = 1; <i class="conum" data-value="1"></i><b>(1)</b></code>',
      "</pre>",
    ].join("");

    expect(highlightRenderedSourceBlocksInHtml(html)).toBe(html);
  });
});
