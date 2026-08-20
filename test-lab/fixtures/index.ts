import type { LabScenarioV1 } from "../shared/scenario";

export const NOTE_IDS = {
  primary: "00000000000000000000000000000001",
  linked: "00000000000000000000000000000002",
  template: "00000000000000000000000000000003",
} as const;

const SETTINGS = {
  compactSpacing: false,
  attributeAutocomplete: true,
  spellCheck: false,
  spellcheckMode: "native" as const,
  editorTheme: "follow",
  mermaidThemeVariables: "{}",
};

function baseScenario(id: string, title: string, body: string, tags: string[] = []): LabScenarioV1 {
  return {
    schemaVersion: 1,
    id,
    title,
    description: `${title} deterministic Test Lab fixture.`,
    tags,
    sessions: [
      { id: "editor-1", selectedNoteId: NOTE_IDS.primary, localStorage: { "adoclab-session-seed": "editor-1" } },
      { id: "editor-2", selectedNoteId: NOTE_IDS.primary, localStorage: { "adoclab-session-seed": "editor-2" } },
    ],
    notes: [
      { id: NOTE_IDS.primary, parentId: "root", title, body, revision: 1, updatedAt: 0 },
      { id: NOTE_IDS.linked, parentId: "root", title: "Linked note", body: "= Linked note\n\n== Target section\n\nLinked content.", revision: 1, updatedAt: 0 },
      { id: NOTE_IDS.template, parentId: "root", title: "Template", body: "= Template\n\nTemplate body", revision: 1, updatedAt: 0 },
    ],
    folders: [{ id: "root", title: "Test notes", parentId: null }],
    resources: [],
    templates: [{ noteId: NOTE_IDS.template }],
    snippets: [{ id: "snippet-1", name: "warning", content: "[WARNING]\n====\nImportant\n====" }],
    dictionary: ["adocLIVE"],
    settings: { ...SETTINGS },
    theme: { hostDark: false, name: "follow" },
    faults: { latencyMs: 0, deferRequests: [], failRequests: {}, duplicateRequests: [], ordering: "fifo", saveEcho: "others", notifyExternalMutations: true },
    timeline: [],
    expectedKnownIssues: [],
    stabilization: { mutationQuietMs: 100, timeoutMs: 10_000, animationFrames: 2 },
  };
}

const inline = baseScenario("inline-sections", "Inline syntax and sections", `= Document title
Ada Contributor
:sectnums:
:toc:
:custom: attribute value

Intro with *bold*, _italic_, #highlight#, [.underline]#underline#, +monospace+, [.line-through]#strike#, {custom}, footnote:[A synthetic footnote], and https://example.invalid[an offline link].

== First section

See <<second,Second section>> and xref:${NOTE_IDS.linked}#target-section[linked target].

* item
** nested item
* [x] checked
* [ ] unchecked

. ordered
.. nested ordered

Term:: description
+
continued paragraph

[[second]]
== Second section

bibliography::[]
`, ["inline", "toc", "lists"]);

const blocks = baseScenario("block-gallery", "Block and overlay gallery", `= Block gallery

.Example
====
Example body
====

[NOTE]
====
Note body
====

[quote, Test Author, Synthetic Source]
____
Quoted text.
____

[verse, Test Author]
____
First line
Second line
____

....
literal block
....

--
open block
--

'''

<<<
`, ["blocks", "overlays"]);

const tableCode = baseScenario("tables-code", "Tables, source, and callouts", `= Tables and code

.Simple table
|===
|Name |Value

|alpha
|1

|beta
|2
|===

[cols="1,2a",options="header"]
|===
|Kind |Nested
|Complex
|
* list in cell
* second line
|===

[source,typescript,linenums,highlight=2]
----
const one = 1; // <1>
console.log(one);
----
<1> A callout.

\`\`\`javascript
const fenced = true;
\`\`\`
`, ["tables", "code", "conversion"]);
tableCode.expectedKnownIssues = ["ADL-015"];

const mathMermaid = baseScenario("math-mermaid", "Math and Mermaid", `= Math and Mermaid

Inline stem:[sqrt(4) = 2].

[stem]
++++
E = mc^2
++++

[mermaid]
....
flowchart LR
  A[Start] --> B[Finish]
....

[mermaid]
....
this is deliberately invalid mermaid
....
`, ["math", "mermaid", "async"]);

const media = baseScenario("media", "Local media and delayed resources", `= Media

image::${":/10000000000000000000000000000001"}[Tiny local image]

audio::${":/10000000000000000000000000000002"}[]

video::${":/10000000000000000000000000000003"}[]

image::${":/10000000000000000000000000000004"}[Broken resource]
`, ["media", "resources"]);
media.resources = [
  { id: "10000000000000000000000000000001", title: "tiny.svg", mime: "image/svg+xml", fixturePath: "assets/tiny.svg", delayMs: 0 },
  { id: "10000000000000000000000000000002", title: "silence.wav", mime: "audio/wav", dataUrl: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=", delayMs: 25 },
  { id: "10000000000000000000000000000003", title: "empty.webm", mime: "video/webm", dataUrl: "data:video/webm;base64,GkXfo0AgQoaBAULygQRC84EIQoKEd2VibQ==", delayMs: 50 },
  { id: "10000000000000000000000000000004", title: "broken.png", mime: "image/png", dataUrl: "data:image/png;base64,", delayMs: 10, failure: "Synthetic missing resource" },
];

const includes = baseScenario("includes", "Includes, cycles, and missing targets", `= Include fixture

include::joplin:${NOTE_IDS.linked}[leveloffset=+1]

include::joplin:ffffffffffffffffffffffffffffffff[opts=optional]

include::joplin:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee[]

include::resource:20000000000000000000000000000001[tag=sample]
`, ["includes", "resources"]);
includes.notes.find(note => note.id === NOTE_IDS.linked)!.body = `= Linked include

== Nested target

Nested note content.

include::joplin:${NOTE_IDS.primary}[]`;
includes.resources = [{
  id: "20000000000000000000000000000001",
  title: "included.adoc",
  mime: "text/asciidoc",
  dataUrl: "data:text/plain;base64,Ly8gdGFnOjpzYW1wbGVbXQpJbmNsdWRlZCByZXNvdXJjZSBsaW5lLgovLyBlbmQ6OnNhbXBsZVtd",
  delayMs: 0,
}];

const unicode = baseScenario("unicode", "Unicode, wrapping, and directionality", `= Unicode

Emoji: 🧪 ✨ 🧭. Combining: é å. CJK: 日本語の長い文章です。 العربية: مرحبا بالعالم. עברית: שלום עולם.

Tabs:\tone\ttwo

Long token: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

الفقرة ذات اتجاه من اليمين إلى اليسار لاختبار المؤشر والاختيار.
`, ["unicode", "cjk", "rtl", "wrapping"]);

const hostile = baseScenario("hostile", "Hostile inert content", `= Hostile content

<script>globalThis.__ADOC_INJECTION__ = true</script>

xref:${NOTE_IDS.linked}[<img src=x onerror="globalThis.__ADOC_INJECTION__=true">]

link:javascript:globalThis.__ADOC_INJECTION__=true[Dangerous URL]

&#60;img src=x onerror=globalThis.__ADOC_INJECTION__=true&#62;

[pass]
++++
<button onclick="globalThis.__ADOC_INJECTION__=true">inert test payload</button>
++++

[bibliography]
== References

- [[[evil,<img src=x onerror="globalThis.__ADOC_INJECTION__=true">]]] Synthetic bibliography entry.
`, ["security", "hostile"]);
hostile.snippets = [{
  id: "snippet-hostile",
  name: '<img src=x onerror="globalThis.__ADOC_INJECTION__=true">',
  content: '<svg onload="globalThis.__ADOC_INJECTION__=true"></svg>',
}];
hostile.expectedKnownIssues = ["ADL-008", "ADL-009", "ADL-010", "ADL-011", "ADL-012", "ADL-013"];

const scroll = baseScenario("scroll-characterization", "Scroll and layout characterization", `= Scroll characterization

${Array.from({ length: 120 }, (_, index) => `== Section ${index + 1}\n\nA wrapped paragraph ${index + 1}: ${"deterministic text ".repeat(8)}\n\n${index % 7 === 0 ? `[source]\n----\n${"tall code line\n".repeat(8)}----\n` : ""}`).join("\n")}
`, ["scroll", "wrapped", "clamps", "characterization"]);
scroll.expectedKnownIssues = ["ADL-022", "ADL-023"];

function scaleFixture(lines: number): LabScenarioV1 {
  const body = `= ${lines.toLocaleString("en-US")} line performance fixture\n\n${Array.from({ length: lines - 2 }, (_, index) => `${index % 25 === 0 ? `== Section ${Math.floor(index / 25) + 1}` : `Line ${index + 1} deterministic payload with *inline* syntax.`}`).join("\n")}`;
  return baseScenario(`scale-${lines}`, `${lines / 1000}k lines`, body, ["performance", "scale", String(lines)]);
}

export const fixtureLibrary: readonly LabScenarioV1[] = [
  inline,
  blocks,
  tableCode,
  mathMermaid,
  media,
  includes,
  unicode,
  hostile,
  scroll,
  scaleFixture(1_000),
  scaleFixture(5_000),
  scaleFixture(10_000),
  scaleFixture(20_000),
];

export function getFixture(id: string): LabScenarioV1 {
  const fixture = fixtureLibrary.find(candidate => candidate.id === id);
  if (!fixture) throw new Error(`Unknown Test Lab fixture: ${id}`);
  return structuredClone(fixture);
}
