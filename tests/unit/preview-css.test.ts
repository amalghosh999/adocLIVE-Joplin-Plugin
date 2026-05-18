import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("preview.css", () => {
  it("provides local glyph fallbacks for font-mode admonition icons", () => {
    const css = readFileSync("src/styles/preview.css", "utf8");

    for (const icon of ["note", "tip", "warning", "caution", "important", "question"]) {
      expect(css).toContain(`.icon-${icon}::before`);
    }
  });

  it("scopes Highlight.js token styles to the rendered preview pane", () => {
    const css = readFileSync("src/styles/preview.css", "utf8");

    expect(css).toContain("#preview-pane pre code.hljs");
    expect(css).toContain("#preview-pane .hljs-keyword");
    expect(css).toContain("#preview-pane .hljs-string");
    expect(css).toContain("#preview-pane .hljs-comment");
  });
});
