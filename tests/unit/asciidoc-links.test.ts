import { describe, expect, it } from "vitest";

import {
  collectDocumentAnchors,
  extractAsciiDocXrefs,
  parseXrefTarget,
} from "../../src/shared/asciidoc-links";

describe("extractAsciiDocXrefs", () => {
  it("extracts xref macros with target metadata and display text", () => {
    const links = extractAsciiDocXrefs("See xref:note.adoc#intro[Intro].");

    expect(links).toMatchObject([
      {
        syntax: "xref",
        rawTarget: "note.adoc#intro",
        noteRef: "note.adoc",
        anchor: "intro",
        displayText: "Intro",
        line: 1,
        column: 5,
      },
    ]);
  });

  it("extracts shorthand xrefs", () => {
    const links = extractAsciiDocXrefs("See <<target-id,Target Text>>.");

    expect(links).toMatchObject([
      {
        syntax: "shorthand",
        rawTarget: "target-id",
        anchor: "target-id",
        displayText: "Target Text",
      },
    ]);
  });

  it("parses note, same-document, and relative targets", () => {
    expect(parseXrefTarget("note.adoc#anchor")).toEqual({ noteRef: "note.adoc", anchor: "anchor" });
    expect(parseXrefTarget("#anchor")).toEqual({ anchor: "anchor" });
    expect(parseXrefTarget("../notes/chapter#anchor")).toEqual({
      noteRef: "../notes/chapter",
      anchor: "anchor",
    });
    expect(parseXrefTarget("./local.adoc")).toEqual({ noteRef: "./local.adoc" });
  });

  it("calculates 1-based source line and column", () => {
    const links = extractAsciiDocXrefs(["first line", "  xref:#target[]"].join("\n"));
    expect(links[0]).toMatchObject({ line: 2, column: 3 });
  });

  it("normalizes bibliography-style shorthand targets", () => {
    const links = extractAsciiDocXrefs("See <<[knuth84]>>.");
    expect(links[0]).toMatchObject({
      rawTarget: "[knuth84]",
      anchor: "knuth84",
    });
  });
});

describe("collectDocumentAnchors", () => {
  it("collects generated sections, explicit sections, inline anchors, block IDs, and bibliography anchors", () => {
    const anchors = collectDocumentAnchors(
      [
        "= Document",
        "",
        "== Generated Section",
        "",
        "[[explicit-section]]",
        "== Explicit Section",
        "",
        "Paragraph with [[inline-anchor]] in it.",
        "",
        "[#block-anchor]",
        "----",
        "block",
        "----",
        "",
        "[[[bib-anchor]]]",
        "* Book entry",
      ].join("\n")
    );

    const byId = new Map(anchors.map((anchor) => [anchor.anchor, anchor]));
    expect(byId.get("_generated_section")).toMatchObject({
      kind: "section",
      title: "Generated Section",
      line: 3,
      level: 2,
    });
    expect(byId.get("explicit-section")).toMatchObject({
      kind: "section",
      title: "Explicit Section",
      line: 6,
      level: 2,
    });
    expect(byId.get("inline-anchor")).toMatchObject({ kind: "explicit", line: 8 });
    expect(byId.get("block-anchor")).toMatchObject({ kind: "block", line: 11 });
    expect(byId.get("bib-anchor")).toMatchObject({ kind: "bibliography", line: 15 });
  });

  it("collects id attribute block anchors", () => {
    const anchors = collectDocumentAnchors(["[id=table-one]", "|===", "| A", "|==="].join("\n"));
    expect(anchors.find((anchor) => anchor.anchor === "table-one")).toMatchObject({
      kind: "block",
      line: 2,
    });
  });
});
