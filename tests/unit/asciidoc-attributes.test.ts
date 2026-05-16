import { describe, expect, it } from "vitest";

import {
  collectAsciiDocAttributeTimeline,
  getEffectiveAsciiDocAttributesAtLine,
  parseAsciiDocAttributeEntry,
  parseAsciiDocAttributeList,
  parseAsciiDocBlockAttributeLine,
  parseAsciiDocRoleAttribute,
  parseAsciiDocRoleOnlyAttribute,
  scanAsciiDocDocumentHeader,
} from "../../src/shared/asciidoc-attributes";

describe("parseAsciiDocAttributeEntry", () => {
  it("parses set, empty, and unset entries", () => {
    expect(parseAsciiDocAttributeEntry(":name: value", 1)).toEqual({
      lineNumber: 1,
      name: "name",
      value: "value",
      unset: false,
    });
    expect(parseAsciiDocAttributeEntry(":sectnums:", 2)).toEqual({
      lineNumber: 2,
      name: "sectnums",
      value: "",
      unset: false,
    });
    expect(parseAsciiDocAttributeEntry(":!sectnums:", 3)).toEqual({
      lineNumber: 3,
      name: "sectnums",
      value: "",
      unset: true,
    });
    expect(parseAsciiDocAttributeEntry(":sectnums!:", 4)).toEqual({
      lineNumber: 4,
      name: "sectnums",
      value: "",
      unset: true,
    });
  });

  it("ignores description-list continuation lines", () => {
    expect(parseAsciiDocAttributeEntry(":: value", 1)).toBeNull();
  });
});

describe("parseAsciiDocAttributeList", () => {
  it("parses style, id, roles, options, positional values, and named values", () => {
    const parsed = parseAsciiDocAttributeList('source#demo.wide.text-center%nowrap,javascript,linenums,start=3,role="lead prose",opts="autowidth,header",title="A, B"');

    expect(parsed.style).toBe("source");
    expect(parsed.id).toBe("demo");
    expect(parsed.roles).toEqual(["wide", "text-center", "lead", "prose"]);
    expect([...parsed.options]).toEqual(["nowrap", "autowidth", "header"]);
    expect(parsed.positional).toEqual(["source", "javascript", "linenums"]);
    expect(parsed.named.get("start")).toBe("3");
    expect(parsed.named.get("role")).toBe("lead prose");
    expect(parsed.named.get("opts")).toBe("autowidth,header");
    expect(parsed.named.get("title")).toBe("A, B");
  });

  it("supports shorthand without a style and keeps explicit empty positional slots", () => {
    const optionsOnly = parseAsciiDocAttributeList("%linenums,ruby");
    expect(optionsOnly.style).toBeUndefined();
    expect([...optionsOnly.options]).toEqual(["linenums"]);
    expect(optionsOnly.positional).toEqual(["ruby"]);

    const sourceLanguageOnly = parseAsciiDocAttributeList(",ruby");
    expect(sourceLanguageOnly.style).toBeUndefined();
    expect(sourceLanguageOnly.positional).toEqual(["", "ruby"]);
  });

  it("parses repeated shorthand options and mixed shorthand order", () => {
    const tableOptions = parseAsciiDocAttributeList("%header%footer%autowidth,cols=2*~");
    expect(tableOptions.style).toBeUndefined();
    expect([...tableOptions.options]).toEqual(["header", "footer", "autowidth"]);
    expect(tableOptions.named.get("cols")).toBe("2*~");

    const mixed = parseAsciiDocAttributeList("horizontal%step.properties#rules");
    expect(mixed.style).toBe("horizontal");
    expect(mixed.id).toBe("rules");
    expect(mixed.roles).toEqual(["properties"]);
    expect([...mixed.options]).toEqual(["step"]);
  });

  it("parses quoted values with escaped quote characters", () => {
    const parsed = parseAsciiDocAttributeList('quote,attribution="Doc \\"Brown\\"",citetitle=\'Back\\\'s Future\'');

    expect(parsed.style).toBe("quote");
    expect(parsed.named.get("attribution")).toBe('Doc "Brown"');
    expect(parsed.named.get("citetitle")).toBe("Back's Future");
  });

  it("parses a full block attribute line and rejects block anchors", () => {
    expect(parseAsciiDocBlockAttributeLine("[#demo.wide%nowrap]")).toMatchObject({
      id: "demo",
      roles: ["wide"],
      positional: [],
    });
    expect(parseAsciiDocBlockAttributeLine("[[demo]]")).toBeNull();
  });
});

describe("parseAsciiDocRoleAttribute", () => {
  it("parses shorthand and longhand role syntax", () => {
    expect(parseAsciiDocRoleAttribute("[.text-center]")).toEqual(["text-center"]);
    expect(parseAsciiDocRoleAttribute("[.lead.text-center]")).toEqual(["lead", "text-center"]);
    expect(parseAsciiDocRoleAttribute("[role=text-center]")).toEqual(["text-center"]);
    expect(parseAsciiDocRoleAttribute("[role=\"lead text-center\"]")).toEqual(["lead", "text-center"]);
    expect(parseAsciiDocRoleAttribute("[role='text-right']")).toEqual(["text-right"]);
    expect(parseAsciiDocRoleAttribute("[#title.text-center]")).toEqual(["text-center"]);
    expect(parseAsciiDocRoleAttribute("[id=title,role=\"lead text-center\"]")).toEqual(["lead", "text-center"]);
  });

  it("separates role-only attributes from other block attributes", () => {
    expect(parseAsciiDocRoleOnlyAttribute("[role=text-center]")).toEqual(["text-center"]);
    expect(parseAsciiDocRoleOnlyAttribute("[id=title,role=text-center]")).toEqual(["text-center"]);
    expect(parseAsciiDocRoleOnlyAttribute("[.lead.text-center]")).toEqual(["lead", "text-center"]);
    expect(parseAsciiDocRoleOnlyAttribute("[source,role=text-center]")).toEqual([]);
    expect(parseAsciiDocRoleOnlyAttribute("[cols=2,role=text-center]")).toEqual([]);
  });
});

describe("collectAsciiDocAttributeTimeline", () => {
  it("tracks effective attributes by line", () => {
    const timeline = collectAsciiDocAttributeTimeline([
      "= Document",
      "Jane Writer <jane@example.com>",
      ":name: header",
      "",
      "{name}",
      ":name: body",
      "{name}",
      ":!name:",
      "{name}",
    ].join("\n"));

    expect(getEffectiveAsciiDocAttributesAtLine(timeline, 5).attributes.get("name")).toBe("header");
    expect(getEffectiveAsciiDocAttributesAtLine(timeline, 7).attributes.get("name")).toBe("body");

    const afterUnset = getEffectiveAsciiDocAttributesAtLine(timeline, 9);
    expect(afterUnset.attributes.has("name")).toBe(false);
    expect(afterUnset.unsetAttributes.has("name")).toBe(true);
    expect(getEffectiveAsciiDocAttributesAtLine(timeline, 5).attributes.get("author")).toBe("Jane Writer");
    expect(getEffectiveAsciiDocAttributesAtLine(timeline, 5).attributes.get("email")).toBe("jane@example.com");
  });

  it("ignores attribute-looking lines inside delimited blocks", () => {
    const timeline = collectAsciiDocAttributeTimeline([
      ":name: before",
      "",
      "----",
      ":name: inside",
      "----",
      "",
      "{name}",
    ].join("\n"));

    expect(getEffectiveAsciiDocAttributesAtLine(timeline, 7).attributes.get("name")).toBe("before");
  });
});

describe("scanAsciiDocDocumentHeader", () => {
  it("detects document attributes before the document title", () => {
    const timeline = collectAsciiDocAttributeTimeline([
      ":toc:",
      ":sectnums:",
      "= Title",
      "",
      "== Section",
    ].join("\n"));

    expect(timeline.headerEndLine).toBe(3);
    expect(timeline.documentHeader).toMatchObject({
      titleLine: 3,
      authorLine: -1,
      headerStartLine: 1,
      headerEndLine: 3,
      controlRanges: [{ startLine: 1, endLine: 2 }],
    });
    expect(getEffectiveAsciiDocAttributesAtLine(timeline, 4).attributes.has("toc")).toBe(true);
    expect(getEffectiveAsciiDocAttributesAtLine(timeline, 5).attributes.has("sectnums")).toBe(true);
  });

  it("allows blank and comment separators before the document title", () => {
    const header = scanAsciiDocDocumentHeader([
      ":toc:",
      "",
      "// header comment",
      "= Title",
      "",
      "== Section",
    ]);

    expect(header).toMatchObject({
      titleLine: 4,
      headerStartLine: 1,
      headerEndLine: 4,
      controlRanges: [{ startLine: 1, endLine: 3 }],
    });
  });

  it("keeps post-title author and document attributes in the same header", () => {
    const timeline = collectAsciiDocAttributeTimeline([
      ":toc:",
      "= Title",
      "Jane Writer <jane@example.com>",
      ":toclevels: 5",
      "",
      "== Section",
    ].join("\n"));

    expect(timeline.documentHeader.controlRanges).toEqual([
      { startLine: 1, endLine: 1 },
      { startLine: 3, endLine: 4 },
    ]);
    expect(timeline.documentHeader).toMatchObject({
      titleLine: 2,
      authorLine: 3,
      headerEndLine: 4,
    });
    const attrs = getEffectiveAsciiDocAttributesAtLine(timeline, 5).attributes;
    expect(attrs.get("author")).toBe("Jane Writer");
    expect(attrs.get("email")).toBe("jane@example.com");
    expect(attrs.get("toclevels")).toBe("5");
  });

  it("does not promote a later title after body content", () => {
    const timeline = collectAsciiDocAttributeTimeline([
      ":toc:",
      "A paragraph",
      "= Not Document Title",
      "",
      "== Section",
    ].join("\n"));

    expect(timeline.documentHeader.titleLine).toBe(-1);
    expect(timeline.headerEndLine).toBe(1);
    expect(timeline.documentHeader.controlRanges).toEqual([{ startLine: 1, endLine: 1 }]);
  });

  it("does not swallow top delimited blocks as document headers", () => {
    const header = scanAsciiDocDocumentHeader([
      "[source]",
      "----",
      "= Not title",
      "----",
      "",
      "= Later Title",
    ]);

    expect(header.titleLine).toBe(-1);
    expect(header.controlRanges).toEqual([]);
  });

  it("treats title-adjacent block attributes as hidden header control lines only when a title follows", () => {
    expect(scanAsciiDocDocumentHeader([
      "[#custom-title]",
      "= Title",
      "",
      "== Section",
    ])).toMatchObject({
      titleLine: 2,
      titleRoles: [],
      headerEndLine: 2,
      controlRanges: [{ startLine: 1, endLine: 1 }],
    });
  });

  it("captures title-adjacent role shorthand for Live Preview title styling", () => {
    expect(scanAsciiDocDocumentHeader([
      "[.text-center]",
      "= Title",
      ":toc:",
      "",
      "== Section",
    ])).toMatchObject({
      titleLine: 2,
      titleRoles: ["text-center"],
      headerEndLine: 3,
      controlRanges: [
        { startLine: 1, endLine: 1 },
        { startLine: 3, endLine: 3 },
      ],
    });
  });

  it("captures title-adjacent longhand roles for Live Preview title styling", () => {
    expect(scanAsciiDocDocumentHeader([
      "[role=\"lead text-center\"]",
      "= Title",
      ":toc:",
      "",
      "== Section",
    ])).toMatchObject({
      titleLine: 2,
      titleRoles: ["lead", "text-center"],
      headerEndLine: 3,
      controlRanges: [
        { startLine: 1, endLine: 1 },
        { startLine: 3, endLine: 3 },
      ],
    });
  });
});
