import { describe, expect, it } from "vitest";

import {
  deriveImageAlt,
  isLegacyResourceRef,
  isLocalImageTarget,
  normalizeImageTarget,
} from "../../src/lib/utils/image-target";

describe("isLocalImageTarget", () => {
  it("recognizes supported local image target formats", () => {
    expect(isLocalImageTarget("/images/cat.png")).toBe(true);
    expect(isLocalImageTarget("file:///home/demo/cat.png")).toBe(true);
    expect(isLocalImageTarget("C:\\images\\cat.png")).toBe(true);
    expect(isLocalImageTarget(":/0123456789abcdef0123456789abcdef")).toBe(true);
  });

  it("leaves relative and remote targets as non-local", () => {
    expect(isLocalImageTarget("images/cat.png")).toBe(false);
    expect(isLocalImageTarget("https://example.com/cat.png")).toBe(false);
  });
});

describe("deriveImageAlt", () => {
  it("uses the decoded filename without its extension", () => {
    expect(deriveImageAlt("file:///home/demo/space%20cat.png")).toBe("space cat");
  });

  it("falls back to a generic alt when the target has no filename", () => {
    expect(deriveImageAlt("https://example.com/")).toBe("image");
  });
});

describe("normalizeImageTarget", () => {
  it("converts local file urls into decoded file paths", () => {
    expect(normalizeImageTarget(" file:///home/demo/space%20cat.png ")).toBe("/home/demo/space cat.png");
  });

  it("preserves non-local targets verbatim once trimmed", () => {
    expect(normalizeImageTarget(" https://example.com/cat.png ")).toBe("https://example.com/cat.png");
    expect(normalizeImageTarget(" vscode-resource://image/cat ")).toBe("vscode-resource://image/cat");
    expect(normalizeImageTarget(" images/cat.png ")).toBe("images/cat.png");
  });
});

describe("isLegacyResourceRef", () => {
  it("matches legacy :/resourceId attachment identifiers", () => {
    expect(isLegacyResourceRef(":/0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isLegacyResourceRef(":0123456789abcdef0123456789abcdef")).toBe(true);
  });

  it("rejects non-resource identifiers", () => {
    expect(isLegacyResourceRef(":/not-a-resource")).toBe(false);
  });
});
