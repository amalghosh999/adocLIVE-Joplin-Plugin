import { describe, expect, it } from "vitest";
import { convertMarkdownToAsciiDoc } from "../../src/host/markdown-conversion";
import { renderAsciiDocHtml } from "../../src/host/rendering";
import { expandEditorIncludes, expandEditorIncludesSync, type ResolvedEditorInclude } from "../../src/host/include-expansion";

describe("shared production/lab host core goldens", () => {
  it("preserves representative Asciidoctor, math, and highlighting output", () => {
    const html = renderAsciiDocHtml(`= Golden

[source,javascript]
----
const value = 1;
----

Inline stem:[sqrt(4)=2].`);
    expect(html).toContain("<h1>Golden</h1>");
    expect(html).toContain("language-javascript");
    expect(html).toContain("katex");
  });

  it("converts headings, lists, links, images, formatting, rules, and fenced code", () => {
    expect(convertMarkdownToAsciiDoc(`# Heading

- item

**bold** and ~~removed~~ and [link](https://example.invalid)

![alt](local.png)

\`\`\`javascript
const value = 1;
\`\`\`

---`)).toBe(`= Heading

* item

*bold* and [.line-through]#removed# and link:https://example.invalid[link]

image::local.png[alt]

[source,javascript]
----
const value = 1;
----

'''`);
  });

  it("does not transform Markdown-like syntax inside fenced or inline code", () => {
    expect(convertMarkdownToAsciiDoc("```\n# not a heading\n- not a list\n```\n`**literal**`")).toBe("----\n# not a heading\n- not a list\n----\n`**literal**`");
  });

  it.fails("ADL-016 chooses a non-colliding AsciiDoc delimiter for fenced code content", () => {
    const converted = convertMarkdownToAsciiDoc("```text\nfirst\n----\nlast\n```");
    expect(converted).toBe("[source,text]\n....\nfirst\n----\nlast\n....");
  });

  it("shares include tags, lines, level offsets, optional targets, and cycle handling", async () => {
    const targets: Record<string, ResolvedEditorInclude> = {
      child: {
        id: "child", key: "note:child", title: "Child",
        content: "// tag::keep[]\n= Kept\n// end::keep[]\n= Dropped", asciidoc: true,
      },
      text: { id: "text", key: "resource:text", title: "text.txt", content: "one\ntwo\nthree\nfour", asciidoc: false },
      root: { id: "root", key: "note:root", title: "Root", content: "include::root[]", asciidoc: true },
    };
    const source = "include::child[tag=keep,leveloffset=+1]\ninclude::text[lines=2..3]\ninclude::missing[opts=optional]\ninclude::root[]";
    const expected = "== Kept\ntwo\nthree\n[WARNING]\n====\nCyclic include skipped: Root\n====";
    const sync = expandEditorIncludesSync(source, "root", (_from, target) => targets[target] || null, new Set(["note:root"]));
    const asyncResult = await expandEditorIncludes(source, "root", async (_from, target) => targets[target] || null, new Set(["note:root"]));
    expect(sync).toBe(expected);
    expect(asyncResult).toBe(expected);
  });
});
