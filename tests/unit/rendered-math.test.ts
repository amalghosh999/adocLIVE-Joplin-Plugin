import { describe, expect, it } from "vitest";

import { prepareAsciiDocMathForRendering } from "../../src/lib/utils/rendered-math";

const Asciidoctor = require("asciidoctor");
const asciidoctor = Asciidoctor();

function renderAsciiDoc(source: string, attributes: Record<string, string> = {}): string {
  const prepared = prepareAsciiDocMathForRendering(source, { attributes });
  const html = asciidoctor.convert(prepared.source, {
    safe: "safe",
    backend: "html5",
    standalone: false,
    attributes: {
      showtitle: "true",
      icons: "font",
      ...attributes,
    },
  });
  return prepared.renderHtml(String(html));
}

describe("prepareAsciiDocMathForRendering", () => {
  it("renders explicit inline AsciiMath macros with KaTeX", () => {
    const rendered = renderAsciiDoc("Inline math: asciimath:[sqrt(4)=2]");

    expect(rendered).toContain("katex");
    expect(rendered).toContain("cm-rendered-math--inline");
    expect(rendered).not.toContain("ADOC_LIVE_RENDERED_MATH");
    expect(rendered).not.toContain("\\$ADOC_LIVE");
  });

  it("renders stem macros as AsciiMath by default", () => {
    const rendered = renderAsciiDoc("Inline math: stem:[sqrt(4)=2]");

    expect(rendered).toContain("katex");
    expect(rendered).toContain("cm-rendered-math--inline");
    expect(rendered).not.toContain("cm-lp-math-error");
  });

  it("uses effective source stem attributes for stem notation", () => {
    const rendered = renderAsciiDoc([
      ":stem: latexmath",
      "",
      "Inline math: stem:[\\frac{1}{2}]",
    ].join("\n"));

    expect(rendered).toContain("katex");
    expect(rendered).toContain("mfrac");
    expect(rendered).not.toContain("cm-lp-math-error");
  });

  it("prefers API stem attributes over source stem attributes", () => {
    const rendered = renderAsciiDoc([
      ":stem: asciimath",
      "",
      "Inline math: stem:[\\frac{1}{2}]",
    ].join("\n"), { stem: "latexmath" });

    expect(rendered).toContain("katex");
    expect(rendered).toContain("mfrac");
    expect(rendered).not.toContain("cm-lp-math-error");
  });

  it("renders AsciiMath passthrough stem blocks while preserving Asciidoctor wrappers", () => {
    const rendered = renderAsciiDoc([
      ".Equation",
      "[asciimath,width=200%]",
      "++++",
      "sqrt(4)=2",
      "++++",
    ].join("\n"));

    expect(rendered).toContain("stemblock");
    expect(rendered).toContain("Equation");
    expect(rendered).toContain("katex-display");
    expect(rendered).toContain("cm-rendered-math--block");
    expect(rendered).not.toContain("ADOC_LIVE_RENDERED_MATH");
  });

  it("does not render escaped dollar text near explicit AsciiMath", () => {
    const rendered = renderAsciiDoc("Math asciimath:[sqrt(4)=2]. Cost is \\$5 and \\$6.");

    expect(rendered).toContain("katex");
    expect(rendered).toMatch(/Cost is \\\$5 and \\\$6|Cost is \$5 and \$6/);
    expect(rendered).not.toContain("cm-lp-math-error");
  });

  it("does not render math-looking macros inside source blocks", () => {
    const rendered = renderAsciiDoc([
      "[source]",
      "----",
      "stem:[sqrt(4)=2]",
      "----",
      "",
      "Cost is \\$5 and \\$6.",
    ].join("\n"));

    expect(rendered).not.toContain("katex");
    expect(rendered).toContain("stem:[sqrt(4)=2]");
    expect(rendered).toMatch(/Cost is \\\$5 and \\\$6|Cost is \$5 and \$6/);
  });

  it("leaves raw TeX-looking prose alone without explicit AsciiDoc math syntax", () => {
    const rendered = renderAsciiDoc("Raw delimiters: \\(x+y\\) and \\[x+y\\].");

    expect(rendered).not.toContain("katex");
    expect(rendered).toContain("\\(x+y\\)");
    expect(rendered).toContain("\\[x+y\\]");
  });
});
