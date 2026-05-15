import { describe, expect, it } from "vitest";

import { normalizeNoteIdsFromCommandArgs } from "../../src/shared/joplin-command-args";

describe("normalizeNoteIdsFromCommandArgs", () => {
  it("reads Joplin note-list context menu note ID arrays", () => {
    expect(normalizeNoteIdsFromCommandArgs([["note-a", "note-b"]])).toEqual(["note-a", "note-b"]);
  });

  it("deduplicates and drops blank note IDs", () => {
    expect(normalizeNoteIdsFromCommandArgs([["note-a", "", "note-a", " note-b "]])).toEqual(["note-a", "note-b"]);
  });

  it("accepts a single note ID as a defensive fallback", () => {
    expect(normalizeNoteIdsFromCommandArgs(["note-a"])).toEqual(["note-a"]);
  });

  it("accepts object-shaped note IDs defensively", () => {
    expect(normalizeNoteIdsFromCommandArgs([{ noteIds: ["note-a", "note-b"] }])).toEqual(["note-a", "note-b"]);
  });

  it("returns an empty array when no note IDs are present", () => {
    expect(normalizeNoteIdsFromCommandArgs([undefined])).toEqual([]);
  });
});
