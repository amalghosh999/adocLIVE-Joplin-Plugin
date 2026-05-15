import { describe, expect, it } from "vitest";
import { parseVerseAttrLine, serializeVerse } from "../../src/lib/utils/verse-block";

describe("parseVerseAttrLine", () => {
  it("returns null for non-verse attribute lines", () => {
    expect(parseVerseAttrLine("[quote, Sandburg]")).toBeNull();
    expect(parseVerseAttrLine("[source,js]")).toBeNull();
    expect(parseVerseAttrLine("paragraph text")).toBeNull();
    expect(parseVerseAttrLine("____")).toBeNull();
  });

  it("parses [verse] with no positional args", () => {
    expect(parseVerseAttrLine("[verse]")).toEqual({ author: "", citetitle: "" });
  });

  it("parses [verse, Author] with author only", () => {
    expect(parseVerseAttrLine("[verse, Carl Sandburg]")).toEqual({
      author: "Carl Sandburg",
      citetitle: "",
    });
  });

  it("parses [verse, Author, Citetitle] with both", () => {
    expect(parseVerseAttrLine("[verse, Carl Sandburg, Fog]")).toEqual({
      author: "Carl Sandburg",
      citetitle: "Fog",
    });
  });

  it("parses [verse,,Citetitle] (empty author)", () => {
    expect(parseVerseAttrLine("[verse,,Fog]")).toEqual({
      author: "",
      citetitle: "Fog",
    });
  });

  it("preserves spaces inside the citetitle field", () => {
    expect(parseVerseAttrLine("[verse,Carl Sandburg, two lines from the poem Fog]")).toEqual({
      author: "Carl Sandburg",
      citetitle: "two lines from the poem Fog",
    });
  });

  it("trims surrounding whitespace from author and citetitle", () => {
    expect(parseVerseAttrLine("[verse,   Carl Sandburg   ,   Fog   ]")).toEqual({
      author: "Carl Sandburg",
      citetitle: "Fog",
    });
  });

  it("returns null for [verse with missing closing bracket", () => {
    expect(parseVerseAttrLine("[verse,Sandburg")).toBeNull();
  });
});

describe("serializeVerse", () => {
  it("emits attribute line + delimiters with author + citetitle + content", () => {
    expect(serializeVerse("Carl Sandburg", "Fog", "The fog comes\non little cat feet.", true)).toBe(
      "[verse, Carl Sandburg, Fog]\n____\nThe fog comes\non little cat feet.\n____",
    );
  });

  it("drops trailing comma when citetitle is empty", () => {
    expect(serializeVerse("Carl Sandburg", "", "body", true)).toBe(
      "[verse, Carl Sandburg]\n____\nbody\n____",
    );
  });

  it("emits [verse] with empty author and only citetitle", () => {
    expect(serializeVerse("", "Fog", "body", true)).toBe(
      "[verse, , Fog]\n____\nbody\n____",
    );
  });

  it("drops the entire attribute line when both fields empty AND no original attr line", () => {
    expect(serializeVerse("", "", "body", false)).toBe(
      "____\nbody\n____",
    );
  });

  it("keeps an empty [verse] attribute line when the original block had one", () => {
    expect(serializeVerse("", "", "body", true)).toBe(
      "[verse]\n____\nbody\n____",
    );
  });

  it("trims whitespace around author and citetitle", () => {
    expect(serializeVerse("  Carl Sandburg  ", "  Fog  ", "body", true)).toBe(
      "[verse, Carl Sandburg, Fog]\n____\nbody\n____",
    );
  });

  it("normalizes CRLF line endings in the content to LF", () => {
    expect(serializeVerse("Sandburg", "", "line one\r\nline two", true)).toBe(
      "[verse, Sandburg]\n____\nline one\nline two\n____",
    );
  });

  it("preserves blank lines inside the content (multi-paragraph verse)", () => {
    const content = "stanza one\n\nstanza two";
    expect(serializeVerse("Sandburg", "Fog", content, true)).toBe(
      "[verse, Sandburg, Fog]\n____\nstanza one\n\nstanza two\n____",
    );
  });
});
