import { describe, expect, it } from "vitest";

import { parseImageMacroLine, serializeImageBlock } from "../../src/lib/utils/image-macro";

describe("parseImageMacroLine", () => {
  it("parses named image attributes through the shared attrlist parser", () => {
    const parsed = parseImageMacroLine('image::cat.png[alt="A, Cat",width=75%,height=40%,align=right]');

    expect(parsed).toMatchObject({
      target: "cat.png",
      resolvedTarget: "cat.png",
      alt: "A, Cat",
      width: 75,
      widthUnit: "%",
      widthSpecified: true,
      height: 40,
      heightUnit: "%",
      heightSpecified: true,
      align: "right",
    });
  });

  it("parses positional size values, ids, roles, and options", () => {
    const parsed = parseImageMacroLine("image::cat.png[#cat.preview%interactive,Cat,80,60]");

    expect(parsed).toMatchObject({
      target: "cat.png",
      alt: "Cat",
      width: 80,
      widthUnit: "px",
      widthSpecified: true,
      height: 60,
      heightUnit: "px",
      heightSpecified: true,
      id: "cat",
      roles: ["preview"],
      options: ["interactive"],
    });
  });

  it("resolves document imagesdir without rewriting the macro target", () => {
    const documentAttributes = new Map([["imagesdir", "images"]]);
    const parsed = parseImageMacroLine("image::cat.png[Cat,200,100]", "", documentAttributes);

    expect(parsed).toMatchObject({
      target: "cat.png",
      resolvedTarget: "images/cat.png",
      imagesdir: "",
      width: 200,
      widthUnit: "px",
      height: 100,
      heightUnit: "px",
    });
  });

  it("serializes image size as HTML-style dimensions and preserves semantic attrs", () => {
    expect(serializeImageBlock({
      target: "cat.png",
      alt: "Cat",
      title: "Cat title",
      caption: "Figure cat",
      width: 200,
      height: 50,
      widthUnit: "px",
      heightUnit: "%",
      widthSpecified: true,
      heightSpecified: true,
      align: "center",
      captionPosition: "below",
      id: "cat",
      roles: ["thumb"],
      options: ["interactive"],
      link: "https://example.com",
      window: "_blank",
      float: "right",
      format: "svg",
      scaledWidth: "25%",
      imagesdir: "images",
    })).toBe('.Figure cat\nimage::cat.png[id="cat",role="thumb",opts="interactive",alt="Cat",width="200",height="50%",align="center",title="Cat title",link="https://example.com",window="_blank",float="right",format="svg",scaledwidth="25%",imagesdir="images"]');
  });
});
