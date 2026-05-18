import { describe, expect, it } from "vitest";

import {
  renderInline,
  __testGetLivePreviewContentBlocks,
  __testGetLivePreviewDocHeaderBlocks,
  __testGetLivePreviewCodeBlocks,
  __testGetLivePreviewSectionNumbers,
  __testGetLivePreviewListNumbers,
  __testGetLivePreviewListMarkers,
  __testGetLivePreviewListLineInfo,
  __testGetLivePreviewTables,
  __testRenderLivePreviewTableCell,
  __testGetLivePreviewImages,
  __testRenderLivePreviewLine,
  __testGetLivePreviewTocEntries,
  __testGetLivePreviewTocTargetLine,
  __testGetLivePreviewDocumentTitleRoleStyle,
  __testGetLivePreviewRawLines,
  __testGetLivePreviewRoleAttributeStyle,
  __testIsLivePreviewAttributeEntryLine,
  __testParseLivePreviewTableAttributes,
  __testSerializeCodeBlock,
} from "../../src/lib/editor/live-preview";

describe("Live Preview TOC collection", () => {
  const deepDocument = [
    "= Document",
    ":toc:",
    ":toclevels: 5",
    "",
    "== One",
    "=== Two",
    "==== Three",
    "===== Four",
    "====== Five",
  ].join("\n");

  it("includes level-6 source headings as TOC depth 5", () => {
    expect(__testGetLivePreviewTocEntries(deepDocument).map((entry) => entry.title)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
    ]);
  });

  it("coerces toclevels 0 to article depth 1", () => {
    const source = deepDocument.replace(":toclevels: 5", ":toclevels: 0");
    expect(__testGetLivePreviewTocEntries(source).map((entry) => entry.title)).toEqual(["One"]);
  });

  it("uses TOC macro-local body attributes", () => {
    const source = [
      "= Document",
      ":toc: macro",
      "",
      ":toclevels: 5",
      "toc::[]",
      "",
      "== One",
      "=== Two",
      "==== Three",
      "===== Four",
      "====== Five",
    ].join("\n");

    expect(__testGetLivePreviewTocEntries(source).map((entry) => entry.title)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
    ]);
  });

  it("uses pre-title document attributes for TOC config and auto placement", () => {
    const source = [
      ":toc:",
      ":toclevels: 5",
      "",
      "= Document",
      "",
      "== One",
      "=== Two",
      "==== Three",
      "===== Four",
      "====== Five",
    ].join("\n");

    expect(__testGetLivePreviewTocTargetLine(source)).toBe(5);
    expect(__testGetLivePreviewTocEntries(source).map((entry) => entry.title)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
    ]);
  });
});

describe("Live Preview section numbering", () => {
  it("numbers headings and skips disabled regions without incrementing counters", () => {
    const source = [
      "= Document",
      ":sectnums:",
      "",
      "== One",
      "",
      ":!sectnums:",
      "== Skipped",
      "=== Also Skipped",
      "",
      ":sectnums:",
      "== Two",
      "=== Two A",
    ].join("\n");

    expect(__testGetLivePreviewSectionNumbers(source)).toEqual([
      { lineNumber: 4, number: "1." },
      { lineNumber: 11, number: "2." },
      { lineNumber: 12, number: "2.1." },
    ]);
  });

  it("respects sectnumlevels and includes numbers in TOC entries", () => {
    const source = [
      "= Document",
      ":toc:",
      ":toclevels: 5",
      ":sectnums:",
      ":sectnumlevels: 5",
      "",
      "== One",
      "=== Two",
      "==== Three",
      "===== Four",
      "====== Five",
    ].join("\n");

    expect(__testGetLivePreviewTocEntries(source).map((entry) => `${entry.number} ${entry.title}`)).toEqual([
      "1. One",
      "1.1. Two",
      "1.1.1. Three",
      "1.1.1.1. Four",
      "1.1.1.1.1. Five",
    ]);
  });

  it("treats sectnumlevels 0 as numbering-depth disabled", () => {
    const source = [
      "= Document",
      ":sectnums:",
      ":sectnumlevels: 0",
      "",
      "== One",
      "=== Two",
    ].join("\n");

    expect(__testGetLivePreviewSectionNumbers(source)).toEqual([]);
  });

  it("uses pre-title sectnums and sectnumlevels", () => {
    const source = [
      ":sectnums:",
      ":sectnumlevels: 5",
      "",
      "= Document",
      "",
      "== One",
      "=== Two",
      "==== Three",
    ].join("\n");

    expect(__testGetLivePreviewSectionNumbers(source)).toEqual([
      { lineNumber: 6, number: "1." },
      { lineNumber: 7, number: "1.1." },
      { lineNumber: 8, number: "1.1.1." },
    ]);
  });
});

describe("Live Preview source-language", () => {
  it("applies inherited source-language to source and bare listing blocks", () => {
    const source = [
      "= Document",
      ":source-language: js",
      "",
      "[source]",
      "----",
      "const x = 1;",
      "----",
      "",
      "----",
      "const y = 2;",
      "----",
    ].join("\n");

    expect(__testGetLivePreviewCodeBlocks(source)).toMatchObject([
      { attrLine: 4, language: "js", languageSource: "inherited", attributeStyle: "source" },
      { attrLine: -1, openLine: 9, language: "js", languageSource: "inherited", attributeStyle: "none" },
    ]);
  });

  it("keeps explicit languages and listing opt-outs", () => {
    const source = [
      "= Document",
      ":source-language: js",
      "",
      "[,ruby]",
      "----",
      "puts x",
      "----",
      "",
      "[listing]",
      "----",
      "plain text",
      "----",
    ].join("\n");

    expect(__testGetLivePreviewCodeBlocks(source)).toMatchObject([
      { language: "ruby", languageSource: "explicit", attributeStyle: "source" },
      { language: "", languageSource: "none", attributeStyle: "listing" },
    ]);
  });

  it("parses source block attrlists with generic shorthand options, ids, and roles", () => {
    const source = [
      "[%linenums,ruby]",
      "----",
      "puts 1",
      "----",
      "",
      "[source#demo.wide%nowrap,javascript]",
      "----",
      "console.log(1)",
      "----",
      "",
      "[source,role=text-center]",
      "----",
      "plain",
      "----",
      "",
      "[source,ruby,linenums,start=3,highlight=4]",
      "----",
      "puts 1",
      "puts 2",
      "----",
    ].join("\n");

    expect(__testGetLivePreviewCodeBlocks(source)).toMatchObject([
      {
        attrLine: 1,
        language: "ruby",
        languageSource: "explicit",
        attributeStyle: "source",
        options: ["linenums"],
        startLineNumber: 1,
      },
      {
        attrLine: 6,
        language: "javascript",
        id: "demo",
        roles: ["wide"],
        options: ["nowrap"],
        nowrap: true,
        rawAttributeLine: "[source#demo.wide%nowrap,javascript]",
      },
      {
        attrLine: 11,
        language: "",
        languageSource: "none",
        roles: ["text-center"],
      },
      {
        attrLine: 16,
        language: "ruby",
        options: ["linenums"],
        startLineNumber: 3,
        highlight: "4",
      },
    ]);
  });

  it("supports unsetting source-language before later blocks", () => {
    const source = [
      "= Document",
      ":source-language: js",
      "",
      "[source]",
      "----",
      "const x = 1;",
      "----",
      "",
      ":!source-language:",
      "[source]",
      "----",
      "plain text",
      "----",
    ].join("\n");

    expect(__testGetLivePreviewCodeBlocks(source)).toMatchObject([
      { language: "js", languageSource: "inherited" },
      { language: "", languageSource: "none" },
    ]);
  });

  it("preserves inherited source-language syntax when saving unchanged", () => {
    expect(__testSerializeCodeBlock("js", "const x = 1;", {
      attributeStyle: "source",
      languageSource: "inherited",
      originalLanguage: "js",
    })).toBe("[source]\n----\nconst x = 1;\n----");

    expect(__testSerializeCodeBlock("js", "const x = 1;", {
      attributeStyle: "none",
      languageSource: "inherited",
      originalLanguage: "js",
    })).toBe("----\nconst x = 1;\n----");
  });

  it("serializes inherited source-language opt-out as listing when selecting text", () => {
    expect(__testSerializeCodeBlock("", "plain text", {
      attributeStyle: "none",
      languageSource: "inherited",
      originalLanguage: "js",
    })).toBe("[listing]\n----\nplain text\n----");
  });

  it("uses pre-title source-language for later source blocks", () => {
    const source = [
      ":source-language: js",
      "",
      "= Document",
      "",
      "[source]",
      "----",
      "const x = 1;",
      "----",
    ].join("\n");

    expect(__testGetLivePreviewCodeBlocks(source)).toMatchObject([
      { attrLine: 5, language: "js", languageSource: "inherited", attributeStyle: "source" },
    ]);
  });
});

describe("Live Preview document header control blocks", () => {
  it("keeps pre-title attributes out of the title rendering block", () => {
    const source = [
      ":toc:",
      ":sectnums:",
      "",
      "= Document",
      "Jane Writer <jane@example.com>",
      ":toclevels: 5",
      "",
      "== Section",
    ].join("\n");

    expect(__testGetLivePreviewDocHeaderBlocks(source)).toEqual([
      {
        startLine: 1,
        endLine: 3,
        titleLine: 4,
        authorLine: 5,
        titleRoles: [],
        showWidget: true,
        attributes: [
          { name: "author", value: "Jane Writer" },
          { name: "firstname", value: "Jane" },
          { name: "lastname", value: "Writer" },
          { name: "authorinitials", value: "JW" },
          { name: "email", value: "jane@example.com" },
          { name: "toc", value: "" },
          { name: "sectnums", value: "" },
          { name: "toclevels", value: "5" },
        ],
      },
      {
        startLine: 5,
        endLine: 6,
        titleLine: 4,
        authorLine: 5,
        titleRoles: [],
        showWidget: false,
        attributes: [
          { name: "author", value: "Jane Writer" },
          { name: "firstname", value: "Jane" },
          { name: "lastname", value: "Writer" },
          { name: "authorinitials", value: "JW" },
          { name: "email", value: "jane@example.com" },
          { name: "toc", value: "" },
          { name: "sectnums", value: "" },
          { name: "toclevels", value: "5" },
        ],
      },
    ]);
  });

  it("keeps every document-header control line raw while the title or a header control line is active", () => {
    const source = [
      ":toc:",
      ":sectnums:",
      "",
      "= Document",
      "Jane Writer <jane@example.com>",
      ":toclevels: 5",
      "",
      "== Section",
    ].join("\n");

    expect(__testGetLivePreviewRawLines(source, 4)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(__testGetLivePreviewRawLines(source, 2)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(__testGetLivePreviewRawLines(source, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(__testGetLivePreviewRawLines(source, 8)).toEqual([8]);
  });

  it("does not treat a top source block as document-header control lines", () => {
    const source = [
      "[source]",
      "----",
      "= Not title",
      "----",
      "",
      "= Later Title",
    ].join("\n");

    expect(__testGetLivePreviewDocHeaderBlocks(source)).toEqual([]);
    expect(__testGetLivePreviewCodeBlocks(source)).toMatchObject([
      { attrLine: 1, openLine: 2, languageSource: "none", attributeStyle: "source" },
    ]);
  });

  it("applies title-adjacent text-center role styling to the document title", () => {
    const source = [
      "[.text-center]",
      "= Centered Document",
      ":toc:",
      "",
      "== Section",
    ].join("\n");

    expect(__testGetLivePreviewDocHeaderBlocks(source)).toMatchObject([
      {
        startLine: 1,
        endLine: 1,
        titleLine: 2,
        titleRoles: ["text-center"],
      },
      {
        startLine: 3,
        endLine: 3,
        titleLine: 2,
        titleRoles: ["text-center"],
      },
    ]);
    expect(__testGetLivePreviewDocumentTitleRoleStyle(source)).toBe("display:inline-block;width:100%;text-align:center");
  });

  it("applies title-adjacent longhand and multi-role styling to the document title", () => {
    const source = [
      "[role=\"lead text-center\"]",
      "= Centered Lead Document",
      ":toc:",
      "",
      "== Section",
    ].join("\n");

    expect(__testGetLivePreviewDocHeaderBlocks(source)).toMatchObject([
      {
        startLine: 1,
        endLine: 1,
        titleLine: 2,
        titleRoles: ["lead", "text-center"],
      },
      {
        startLine: 3,
        endLine: 3,
        titleLine: 2,
        titleRoles: ["lead", "text-center"],
      },
    ]);
    expect(__testGetLivePreviewDocumentTitleRoleStyle(source)).toBe("font-size:1.2em;line-height:1.6;display:inline-block;width:100%;text-align:center");
  });
});

describe("Live Preview role attribute lines", () => {
  it("supports shorthand, longhand, and multiple role forms", () => {
    expect(__testGetLivePreviewRoleAttributeStyle("[.text-center]")).toBe("display:inline-block;width:100%;text-align:center");
    expect(__testGetLivePreviewRoleAttributeStyle("[role=text-center]")).toBe("display:inline-block;width:100%;text-align:center");
    expect(__testGetLivePreviewRoleAttributeStyle("[role=\"lead text-center\"]")).toBe("font-size:1.2em;line-height:1.6;display:inline-block;width:100%;text-align:center");
    expect(__testGetLivePreviewRoleAttributeStyle("[.lead.text-center]")).toBe("font-size:1.2em;line-height:1.6;display:inline-block;width:100%;text-align:center");
    expect(__testGetLivePreviewRoleAttributeStyle("[.nowrap]")).toBe("white-space:nowrap");
    expect(__testGetLivePreviewRoleAttributeStyle("[.pre-wrap]")).toBe("white-space:pre-wrap");
  });

  it("does not treat styled block attribute lists as standalone role lines", () => {
    expect(__testGetLivePreviewRoleAttributeStyle("[source,role=text-center]")).toBe("");
    expect(__testGetLivePreviewRoleAttributeStyle("[cols=2,role=text-center]")).toBe("");
  });

  it("preserves generic inline roles as classes while applying built-in role styles", () => {
    expect(renderInline("[.nowrap.custom]#keep together#")).toBe('<span class="cm-lp-role nowrap custom" style="white-space:nowrap">keep together</span>');
    expect(renderInline("[role=\"pre-wrap sample\"]#keep  spaces#")).toBe('<span class="cm-lp-role pre-wrap sample" style="white-space:pre-wrap">keep  spaces</span>');
    expect(renderInline("[red]#Alert#")).toBe('<span class="cm-lp-role red" style="color:red">Alert</span>');
    expect(renderInline("[#tagged.custom]#Text#")).toBe('<span id="tagged" class="cm-lp-role custom">Text</span>');
  });
});

describe("Live Preview table attrlists", () => {
  it("uses the shared attrlist parser for table options, ids, and roles", () => {
    expect(__testParseLivePreviewTableAttributes("[#scores.center%header%footer,cols=\"1,2\",opts=\"autowidth\",frame=none,grid=rows,stripes=even,float=right,align=center]")).toMatchObject({
      header: true,
      footer: true,
      autowidth: true,
      frame: "none",
      grid: "rows",
      stripes: "even",
      id: "scores",
      roles: ["center"],
      float: "right",
      align: "center",
    });
  });

  it("honors %noheader, opts aliases, table roles, and PSV cell specs", () => {
    const source = [
      "[#scores.right.stretch%noheader,cols=\"1h,1a,1l\",opts=\"autowidth\",float=left]",
      "|===",
      "2+| Span",
      ".2+^.^| Tall",
      "a| *Nested*",
      "literal continuation | with pipe",
      "l| literal",
      "|===",
    ].join("\n");

    expect(__testGetLivePreviewTables(source)).toMatchObject([
      {
        attrLine: 1,
        attrs: {
          header: false,
          autowidth: true,
          id: "scores",
          roles: ["right", "stretch"],
          float: "left",
          cols: [
            { width: 1, style: "h" },
            { width: 1, style: "a" },
            { width: 1, style: "l" },
          ],
        },
        rows: [
          [
            { text: "Span", spec: { colspan: 2, rowspan: 1, style: "" } },
            { text: "Tall", spec: { colspan: 1, rowspan: 2, halign: "center", valign: "middle" } },
          ],
          [
            { text: "*Nested*\nliteral continuation | with pipe", spec: { style: "a" } },
            { text: "literal", spec: { style: "l" } },
          ],
        ],
      },
    ]);
  });

  it("keeps rowspan-occupied columns out of following row layout", () => {
    const source = [
      "[cols=2]",
      "|===",
      ".2+| A | B",
      "| C | D",
      "| E",
      "|===",
    ].join("\n");

    expect(__testGetLivePreviewTables(source)[0].rows.map(row => row.map(cell => cell.text))).toEqual([
      ["A", "B"],
      ["C"],
      ["D", "E"],
    ]);
  });

  it("renders nested AsciiDoc table cell lines with their source-line attribute state", () => {
    const source = [
      ":hardbreaks-option:",
      "[cols=1]",
      "|===",
      "a| First line",
      "second line",
      "|===",
      ":!hardbreaks-option:",
    ].join("\n");

    expect(__testRenderLivePreviewTableCell(source)).toBe(
      '<div class="cm-lp-table-cell-line"><span class="cm-lp-paragraph cm-lp-hardbreaks">First line</span></div><div class="cm-lp-table-cell-line"><span class="cm-lp-paragraph cm-lp-hardbreaks">second line</span></div>',
    );
  });
});

describe("Live Preview image macros", () => {
  it("keeps raw targets while resolving inherited imagesdir for rendering", () => {
    const source = [
      ":imagesdir: images",
      "",
      ".Cat",
      "image::cat.png[Cat,200,100,link=https://example.com,window=_blank,float=right,role=thumbnail,opts=interactive]",
    ].join("\n");

    expect(__testGetLivePreviewImages(source)).toMatchObject([
      {
        titleLine: 3,
        imageLine: 4,
        options: {
          target: "cat.png",
          resolvedTarget: "images/cat.png",
          caption: "Cat",
          alt: "Cat",
          width: 200,
          widthUnit: "px",
          widthSpecified: true,
          height: 100,
          heightUnit: "px",
          heightSpecified: true,
          link: "https://example.com",
          window: "_blank",
          float: "right",
          roles: ["thumbnail"],
          options: ["interactive"],
          imagesdir: "",
        },
      },
    ]);
  });
});

describe("Live Preview content block attrlists", () => {
  it("preserves roles and ids on example, sidebar, admonition, and collapsible blocks", () => {
    const source = [
      ".Details",
      "[#details.wide%collapsible%open]",
      "====",
      "Body",
      "====",
      "",
      "[example%collapsible]",
      "Paragraph body",
      "continued body",
      "",
      "[NOTE#note-id.urgent]",
      "====",
      "Remember",
      "====",
      "",
      "[#side.info]",
      "****",
      "Sidebar",
      "****",
      "",
      "[example#example-id.featured]",
      "====",
      "Example",
      "====",
    ].join("\n");

    expect(__testGetLivePreviewContentBlocks(source)).toMatchObject([
      {
        kind: "collapsible",
        titleLine: 1,
        attrLine: 2,
        openLine: 3,
        closeLine: 5,
        delimited: true,
        title: "Details",
        id: "details",
        roles: ["wide"],
        options: ["collapsible", "open"],
        initiallyOpen: true,
      },
      {
        kind: "collapsible",
        attrLine: 7,
        openLine: 8,
        closeLine: 9,
        delimited: false,
        options: ["collapsible"],
        initiallyOpen: false,
      },
      {
        kind: "admonition",
        attrLine: 11,
        openLine: 12,
        closeLine: 14,
        id: "note-id",
        roles: ["urgent"],
        admonitionType: "note",
      },
      {
        kind: "sidebar",
        attrLine: 16,
        openLine: 17,
        closeLine: 19,
        id: "side",
        roles: ["info"],
      },
      {
        kind: "example",
        attrLine: 21,
        openLine: 22,
        closeLine: 24,
        id: "example-id",
        roles: ["featured"],
      },
    ]);
  });

  it("accepts block attribute lines before content block titles", () => {
    const source = [
      "[#release-notes%collapsible%open]",
      ".Release notes",
      "====",
      "Body",
      "====",
      "",
      "[example%collapsible]",
      ".Inline details",
      "Paragraph body",
    ].join("\n");

    expect(__testGetLivePreviewContentBlocks(source)).toMatchObject([
      {
        kind: "collapsible",
        startLine: 1,
        titleLine: 2,
        attrLine: 1,
        openLine: 3,
        closeLine: 5,
        delimited: true,
        title: "Release notes",
        id: "release-notes",
        options: ["collapsible", "open"],
        initiallyOpen: true,
      },
      {
        kind: "collapsible",
        startLine: 7,
        titleLine: 8,
        attrLine: 7,
        openLine: 9,
        closeLine: 9,
        delimited: false,
        title: "Inline details",
        options: ["collapsible"],
        initiallyOpen: false,
      },
    ]);
  });
});

describe("Live Preview list attrlists", () => {
  it("uses the shared attrlist parser for ordered list start values", () => {
    const source = [
      "[start=5]",
      ". Five",
      ". Six",
    ].join("\n");

    expect(__testGetLivePreviewListNumbers(source)).toEqual([
      { lineNumber: 2, number: 5 },
      { lineNumber: 3, number: 6 },
    ]);
  });

  it("supports ordered list style attrlists", () => {
    const source = [
      "[lowerroman,start=4]",
      ". Four",
      ". Five",
      "",
      "[upperalpha]",
      ". Alpha",
      "",
      "[lowergreek]",
      ". Greek",
    ].join("\n");

    expect(__testGetLivePreviewListMarkers(source)).toEqual([
      { lineNumber: 2, number: 4, style: "lowerroman", marker: "iv.", reversed: false },
      { lineNumber: 3, number: 5, style: "lowerroman", marker: "v.", reversed: false },
      { lineNumber: 6, number: 1, style: "upperalpha", marker: "A.", reversed: false },
      { lineNumber: 9, number: 1, style: "lowergreek", marker: "&alpha;.", reversed: false },
    ]);
  });

  it("supports reversed ordered lists and interactive checklist options", () => {
    const source = [
      "[%reversed,start=5]",
      ". Five",
      ". Four",
      "",
      "[opts=interactive]",
      "* [ ] Toggle me",
      "* [x] Done",
    ].join("\n");

    expect(__testGetLivePreviewListLineInfo(source)).toEqual([
      {
        lineNumber: 2,
        ordered: { number: 5, style: "arabic", marker: "5.", reversed: true },
      },
      {
        lineNumber: 3,
        ordered: { number: 4, style: "arabic", marker: "4.", reversed: true },
      },
      {
        lineNumber: 6,
        checklist: { interactive: true },
      },
      {
        lineNumber: 7,
        checklist: { interactive: true },
      },
    ]);
  });

  it("continues ordered list numbering and checklist options across blank lines", () => {
    const source = [
      "[start=5]",
      ". Five",
      "",
      ". Six",
      "",
      "Paragraph",
      "",
      ". One",
      "",
      "[opts=interactive]",
      "* [ ] Toggle",
      "",
      "* [x] Done",
      "",
      "Paragraph",
      "",
      "* [ ] Plain",
    ].join("\n");

    expect(__testGetLivePreviewListLineInfo(source)).toMatchObject([
      { lineNumber: 2, ordered: { number: 5, marker: "5." } },
      { lineNumber: 4, ordered: { number: 6, marker: "6." } },
      { lineNumber: 8, ordered: { number: 1, marker: "1." } },
      { lineNumber: 11, checklist: { interactive: true } },
      { lineNumber: 13, checklist: { interactive: true } },
      { lineNumber: 17, checklist: { interactive: false } },
    ]);
  });

  it("renders non-interactive checklists as static and interactive checklists as toggles", () => {
    expect(__testRenderLivePreviewLine("* [ ] Plain")).toContain(
      'data-interactive="false" style="cursor:default"',
    );
    expect(__testRenderLivePreviewLine("[opts=interactive]\n* [ ] Toggle", 2)).toContain(
      'class="cm-lp-checkbox cm-lp-checkbox-interactive" data-checked="false" data-interactive="true" style="cursor:pointer"',
    );
  });
});

describe("Live Preview link macros", () => {
  it("preserves link id, role, title, window, and options", () => {
    expect(renderInline('link:https://example.com[Example,#site.primary,title="Project site",window=_blank,opts="nofollow,noopener"]')).toBe(
      '<a id="site" class="cm-lp-link primary" href="https://example.com" data-href="https://example.com" target="_blank" data-window="_blank" title="Project site" rel="nofollow noopener">Example</a>',
    );
    expect(renderInline("https://example.com[Example^,role=external]")).toBe(
      '<a class="cm-lp-link external" href="https://example.com" data-href="https://example.com" target="_blank" data-window="_blank" rel="noopener">Example</a>',
    );
  });

  it("keeps generated inline formatting inside link text", () => {
    expect(renderInline("link:https://example.com[*Bold* and _em_]")).toBe(
      '<a class="cm-lp-link" href="https://example.com" data-href="https://example.com"><strong>Bold</strong> and <em>em</em></a>',
    );
  });
});

describe("Live Preview paragraph and break options", () => {
  it("renders hardbreak paragraph attributes and document-wide hardbreaks", () => {
    expect(__testRenderLivePreviewLine("[%hardbreaks]\nFirst line", 2)).toBe(
      '<span class="cm-lp-paragraph cm-lp-hardbreaks">First line</span>',
    );
    expect(__testRenderLivePreviewLine(":hardbreaks-option:\n\nFirst line", 3)).toBe(
      '<span class="cm-lp-paragraph cm-lp-hardbreaks">First line</span>',
    );
  });

  it("renders Markdown thematic breaks and attributed page breaks", () => {
    expect(__testRenderLivePreviewLine("---")).toContain("cm-lp-hr");
    expect(__testRenderLivePreviewLine("* * *")).toContain("cm-lp-hr");
    expect(__testRenderLivePreviewLine("[.column%always]\n<<<", 2)).toBe(
      '<span class="cm-lp-pagebreak cm-lp-pagebreak-always column"><span class="cm-lp-pagebreak-label">Column Break</span></span>',
    );
  });

  it("supports horizontal description list sizing attributes", () => {
    expect(__testGetLivePreviewListLineInfo("[horizontal,labelwidth=25,itemwidth=75]\nCPU:: Fast")).toEqual([
      {
        lineNumber: 2,
        description: {
          horizontal: true,
          labelWidth: "25%",
          itemWidth: "75%",
          id: "",
          roles: [],
        },
      },
    ]);
    expect(__testRenderLivePreviewLine("[horizontal,labelwidth=25,itemwidth=75]\nCPU:: Fast", 2)).toBe(
      '<span class="cm-lp-dlist cm-lp-dlist-horizontal" style="--lp-dlist-label-width:25%;--lp-dlist-item-width:75%"><strong class="cm-lp-dlist-label">CPU</strong><span class="cm-lp-dlist-item">Fast</span></span>',
    );
  });
});

describe("Live Preview attribute entry lines", () => {
  it("recognizes set and unset attribute entries as preview-hidden control lines", () => {
    expect(__testIsLivePreviewAttributeEntryLine(":name: Body Name")).toBe(true);
    expect(__testIsLivePreviewAttributeEntryLine(":!source-language:")).toBe(true);
    expect(__testIsLivePreviewAttributeEntryLine(":sectnums!:")).toBe(true);
  });

  it("does not treat description-list syntax as an attribute entry", () => {
    expect(__testIsLivePreviewAttributeEntryLine("Term:: Description")).toBe(false);
    expect(__testIsLivePreviewAttributeEntryLine(":: continuation")).toBe(false);
  });
});
