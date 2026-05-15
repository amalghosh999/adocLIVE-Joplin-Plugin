import { describe, expect, it } from "vitest";

import {
  filterJoplinNoteLinkCandidates,
  isAsciiDocNoteBody,
} from "../../src/shared/joplin-note-links";

const ADOC_SENTINEL = "\n```asciidoc-settings\n{}\n```\n";

describe("Joplin note link candidates", () => {
  it("recognizes AsciiDoc notes by the plugin sentinel", () => {
    expect(isAsciiDocNoteBody(`= Note${ADOC_SENTINEL}`)).toBe(true);
    expect(isAsciiDocNoteBody("# Markdown note")).toBe(false);
  });

  it("keeps other Joplin notes and never returns the current note", () => {
    const results = filterJoplinNoteLinkCandidates([
      { id: "current", title: "Current", body: `= Current${ADOC_SENTINEL}`, updated_time: 5 },
      { id: "adoc", title: "AsciiDoc", body: `= AsciiDoc${ADOC_SENTINEL}`, updated_time: 4 },
      { id: "markdown", title: "Markdown", body: "# Markdown", updated_time: 3 },
    ], { currentNoteId: "current" });

    expect(results).toEqual([
      { id: "adoc", title: "AsciiDoc", isAsciiDoc: true },
      { id: "markdown", title: "Markdown", isAsciiDoc: false },
    ]);
  });

  it("can restrict candidates to adocLIVE notes for include targets", () => {
    const results = filterJoplinNoteLinkCandidates([
      { id: "adoc", title: "AsciiDoc", body: `= AsciiDoc${ADOC_SENTINEL}`, updated_time: 4 },
      { id: "markdown", title: "Markdown", body: "# Markdown", updated_time: 3 },
    ], { asciiDocOnly: true });

    expect(results).toEqual([
      { id: "adoc", title: "AsciiDoc", isAsciiDoc: true },
    ]);
  });

  it("filters by title or note ID and prefers stronger title matches", () => {
    const results = filterJoplinNoteLinkCandidates([
      { id: "zzz", title: "Appendix Alpha", body: ADOC_SENTINEL, updated_time: 30 },
      { id: "alpha-id", title: "Reference", body: ADOC_SENTINEL, updated_time: 40 },
      { id: "aaa", title: "Alpha", body: ADOC_SENTINEL, updated_time: 10 },
      { id: "bbb", title: "Alpha Notes", body: ADOC_SENTINEL, updated_time: 20 },
    ], { query: "alpha" });

    expect(results.map(result => result.title)).toEqual([
      "Alpha",
      "Alpha Notes",
      "Appendix Alpha",
      "Reference",
    ]);
  });
});
