import { describe, expect, it } from "vitest";

import {
  collectDocumentSections,
  extractDocumentAnchorOptions,
  extractSectionContent,
  findSectionLineNumber,
  generateSectionAnchor,
} from "../../src/shared/asciidoc-sections";
import { collectAsciiDocAttributeTimeline } from "../../src/shared/asciidoc-attributes";

describe("generateSectionAnchor", () => {
  it("normalizes section titles into AsciiDoc-style anchors", () => {
    expect(generateSectionAnchor(" API - Section 2! ")).toBe("_api_section_2");
  });

  it("falls back to a bare underscore when nothing remains after normalization", () => {
    expect(generateSectionAnchor("!!!")).toBe("_");
  });

  it("converts dots to the separator (not strips them)", () => {
    expect(generateSectionAnchor("v1.2.3 Release")).toBe("_v1_2_3_release");
    expect(generateSectionAnchor("A.B.C")).toBe("_a_b_c");
  });

  it("strips inline formatting markup before generating the ID", () => {
    expect(generateSectionAnchor("_Hello_ World")).toBe("_hello_world");
    expect(generateSectionAnchor("*Bold* Title")).toBe("_bold_title");
    expect(generateSectionAnchor("`mono` code")).toBe("_mono_code");
    expect(generateSectionAnchor("^super^ and ~sub~")).toBe("_super_and_sub");
    expect(generateSectionAnchor("#Highlighted# text")).toBe("_highlighted_text");
    expect(generateSectionAnchor("[.red]#colored text#")).toBe("_colored_text");
  });
});

describe("collectDocumentSections", () => {
  it("collects headings with generated and explicit anchors", () => {
    const content = [
      "[[intro]]",
      "== Intro Section",
      "Opening paragraph.",
      "",
      "=== Deep Dive",
      "Nested details.",
      "",
      "[[ignored]]",
      "Not a heading",
      "",
      "== Wrap Up",
      "Closing paragraph.",
    ].join("\n");

    expect(collectDocumentSections(content)).toEqual([
      {
        anchor: "intro",
        explicitAnchor: "intro",
        lineNumber: 2,
        level: 2,
        title: "Intro Section",
      },
      {
        anchor: "_deep_dive",
        explicitAnchor: undefined,
        lineNumber: 5,
        level: 3,
        title: "Deep Dive",
      },
      {
        anchor: "_wrap_up",
        explicitAnchor: undefined,
        lineNumber: 11,
        level: 2,
        title: "Wrap Up",
      },
    ]);
  });

  it("matches Asciidoctor duplicate generated section anchors", () => {
    const content = [
      "== Section Two",
      "",
      "== Section Two",
      "",
      "=== Section Two",
    ].join("\n");

    expect(collectDocumentSections(content).map((section) => section.anchor)).toEqual([
      "_section_two",
      "_section_two_2",
      "_section_two_3",
    ]);
  });

  it("avoids explicit anchors when generating duplicate section anchors", () => {
    const content = [
      "[[_same]]",
      "== Explicit Same",
      "",
      "== Same",
      "",
      "[[_same_2]]",
      "== Duplicate Explicit Same",
      "",
      "== Same",
    ].join("\n");

    expect(collectDocumentSections(content).map((section) => section.anchor)).toEqual([
      "_same",
      "_same_2",
      "_same_2",
      "_same_3",
    ]);
  });

  it("collects shorthand and id attribute anchors", () => {
    const content = [
      "[.lead#short-id]",
      "== Short ID",
      "",
      "[id=\"attr-id\"]",
      "== Attribute ID",
    ].join("\n");

    expect(collectDocumentSections(content).map((section) => section.anchor)).toEqual([
      "short-id",
      "attr-id",
    ]);
  });
});

describe("findSectionLineNumber", () => {
  const content = [
    "[[intro]]",
    "== Intro Section",
    "Opening paragraph.",
    "",
    "=== Deep Dive",
    "Nested details.",
    "",
    "[[jump]]",
    "Standalone paragraph.",
  ].join("\n");

  it("finds line numbers for explicit and generated section anchors", () => {
    expect(findSectionLineNumber(content, "intro")).toBe(2);
    expect(findSectionLineNumber(content, " _deep_dive ")).toBe(5);
  });

  it("finds duplicate generated anchors using Asciidoctor's suffix format", () => {
    const duplicateContent = [
      "== Repeated",
      "",
      "== Repeated",
    ].join("\n");

    expect(findSectionLineNumber(duplicateContent, "_repeated")).toBe(1);
    expect(findSectionLineNumber(duplicateContent, "_repeated_2")).toBe(3);
  });

  it("finds generated anchors that skip explicit anchor collisions", () => {
    const collisionContent = [
      "[[_same]]",
      "== Explicit Same",
      "",
      "== Same",
    ].join("\n");

    expect(findSectionLineNumber(collisionContent, "_same")).toBe(2);
    expect(findSectionLineNumber(collisionContent, "_same_2")).toBe(4);
  });

  it("falls back to the line after a standalone explicit anchor", () => {
    expect(findSectionLineNumber(content, "jump")).toBe(9);
  });

  it("returns null for blank or missing anchors", () => {
    expect(findSectionLineNumber(content, "")).toBeNull();
    expect(findSectionLineNumber(content, "_missing")).toBeNull();
  });

  it("finds inline [[id]] anchors within paragraph text", () => {
    const content = [
      "== Section One",
      "",
      "This paragraph has [[inline-anchor]] inside it.",
      "",
      "== Section Two",
    ].join("\n");

    expect(findSectionLineNumber(content, "inline-anchor")).toBe(3);
  });
});

describe("collectDocumentSections — reftext capture", () => {
  it("captures reftext from [[id,reftext]] anchors", () => {
    const content = [
      "[[my-ref,Custom Display Text]]",
      "== My Section",
      "",
      "[[plain-ref]]",
      "== Plain Section",
    ].join("\n");

    const sections = collectDocumentSections(content);
    expect(sections[0].reftext).toBe("Custom Display Text");
    expect(sections[1].reftext).toBeUndefined();
  });
});

describe("extractSectionContent", () => {
  const content = [
    "[[intro]]",
    "== Intro Section",
    "Opening paragraph.",
    "",
    "=== Deep Dive",
    "Nested details.",
    "",
    "[[bookmark]]",
    "Standalone paragraph.",
    "",
    "== Wrap Up",
    "Closing paragraph.",
  ].join("\n");

  it("returns a section through the next sibling section", () => {
    expect(extractSectionContent(content, "intro")).toBe(
      [
        "== Intro Section",
        "Opening paragraph.",
        "",
        "=== Deep Dive",
        "Nested details.",
        "",
        "[[bookmark]]",
        "Standalone paragraph.",
      ].join("\n")
    );
  });

  it("returns nested section content without crossing into the next sibling", () => {
    expect(extractSectionContent(content, "_deep_dive")).toBe(
      [
        "=== Deep Dive",
        "Nested details.",
        "",
        "[[bookmark]]",
        "Standalone paragraph.",
      ].join("\n")
    );
  });

  it("returns an empty string when the anchor cannot be resolved", () => {
    expect(extractSectionContent(content, "")).toBe("");
    expect(extractSectionContent(content, "_missing")).toBe("");
  });
});

describe("generateSectionAnchor — idprefix/idseparator", () => {
  it("uses empty idprefix when opts.idprefix is empty string", () => {
    expect(generateSectionAnchor("Hello World", { idprefix: "" })).toBe("hello_world");
  });

  it("uses hyphen separator when opts.idseparator is '-'", () => {
    expect(generateSectionAnchor("Hello World", { idseparator: "-" })).toBe("_hello-world");
  });

  it("combines custom prefix and separator", () => {
    expect(generateSectionAnchor("My Section", { idprefix: "sec-", idseparator: "-" })).toBe("sec-my-section");
  });

  it("uses an empty idseparator when opts.idseparator is empty string", () => {
    expect(generateSectionAnchor("Hello World", { idseparator: "" })).toBe("_helloworld");
  });
});

describe("collectDocumentSections — opts forwarded", () => {
  it("generates correct anchors when idseparator is '-'", () => {
    const content = "== Hello World\n\n== Hello World";
    const sections = collectDocumentSections(content, { idseparator: "-" });
    expect(sections[0].anchor).toBe("_hello-world");
    expect(sections[1].anchor).toBe("_hello-world-2");
  });

  it("uses line-effective idprefix and idseparator values", () => {
    const content = [
      "= Document",
      ":idprefix: sec-",
      ":idseparator: -",
      "",
      "== Hello World",
      "",
      ":idprefix:",
      ":idseparator:",
      "== No Separator",
      "",
      ":!idprefix:",
      ":!idseparator:",
      "== Back To Default",
    ].join("\n");
    const timeline = collectAsciiDocAttributeTimeline(content);
    const sections = collectDocumentSections(content, { attributeTimeline: timeline });

    expect(sections.map((section) => section.anchor)).toEqual([
      "_document",
      "sec-hello-world",
      "noseparator",
      "_back_to_default",
    ]);
  });

  it("collects level-6 headings", () => {
    const content = "====== Deep Heading";
    expect(collectDocumentSections(content)[0]).toMatchObject({
      level: 6,
      title: "Deep Heading",
      anchor: "_deep_heading",
    });
  });
});

describe("extractDocumentAnchorOptions", () => {
  it("reads idprefix and idseparator from the document header", () => {
    const content = [
      "= Document",
      "Jane Writer <jane@example.com>",
      ":idprefix:",
      ":idseparator: -",
      "",
      "== Hello World",
    ].join("\n");

    expect(extractDocumentAnchorOptions(content)).toEqual({
      idprefix: "",
      idseparator: "-",
    });
    expect(collectDocumentSections(content, extractDocumentAnchorOptions(content))[1].anchor).toBe("hello-world");
  });

  it("is used by section lookup helpers by default", () => {
    const content = [
      "= Document",
      ":idprefix:",
      ":idseparator: -",
      "",
      "== Hello World",
      "Body.",
    ].join("\n");

    expect(findSectionLineNumber(content, "hello-world")).toBe(5);
    expect(extractSectionContent(content, "hello-world")).toBe("== Hello World\nBody.");
  });

  it("reads idprefix and idseparator from pre-title document attributes", () => {
    const content = [
      ":idprefix:",
      ":idseparator: -",
      "",
      "= Document",
      "",
      "== Hello World",
      "Body.",
    ].join("\n");

    expect(extractDocumentAnchorOptions(content)).toEqual({
      idprefix: "",
      idseparator: "-",
    });
    expect(findSectionLineNumber(content, "hello-world")).toBe(6);
  });
});
