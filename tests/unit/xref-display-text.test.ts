import { describe, expect, it } from "vitest";
import { resolveXrefDisplayText, renderInline } from "../../src/lib/editor/live-preview";

const titles = new Map<string, string>([
  ["_my_section", "My Section"],
  ["intro", "Introduction"],
]);

const reftexts = new Map<string, string>([
  ["_anchor_with_ref", "See This"],
]);

describe("resolveXrefDisplayText", () => {
  it("returns reftext when anchor has an explicit [[id,reftext]]", () => {
    expect(resolveXrefDisplayText("_anchor_with_ref", titles, reftexts)).toBe("See This");
  });

  it("falls back to the section title when no reftext", () => {
    expect(resolveXrefDisplayText("_my_section", titles, reftexts)).toBe("My Section");
  });

  it("strips .adoc extension for cross-file references with no title match", () => {
    expect(resolveXrefDisplayText("other-doc.adoc", titles, reftexts)).toBe("other-doc");
    expect(resolveXrefDisplayText("other-doc.asciidoc", titles, reftexts)).toBe("other-doc");
  });

  it("returns the raw target when nothing resolves", () => {
    expect(resolveXrefDisplayText("_unknown_anchor", titles, reftexts)).toBe("_unknown_anchor");
  });

  it("looks up the node ID part (before #) for section-within-file refs", () => {
    expect(resolveXrefDisplayText("intro", titles, reftexts)).toBe("Introduction");
  });
});

describe("resolveXrefDisplayText — reftext beats title", () => {
  it("prefers reftext over section title when both exist", () => {
    const titles = new Map([["my-id", "Actual Title"]]);
    const reftexts = new Map([["my-id", "Preferred Display"]]);
    expect(resolveXrefDisplayText("my-id", titles, reftexts)).toBe("Preferred Display");
  });
});

describe("renderInline — inline [[id]] anchor stripping", () => {
  it("strips [[id]] anchors that appear inline in text", () => {
    const result = renderInline("See [[my-anchor]] for details.");
    expect(result).not.toContain("[[my-anchor]]");
    expect(result).toContain("See");
    expect(result).toContain("for details.");
  });

  it("strips [[id,reftext]] inline anchors too", () => {
    const result = renderInline("Start [[ref,Ref Text]] end.");
    expect(result).not.toContain("[[ref");
    expect(result).toContain("Start");
    expect(result).toContain("end.");
  });
});
