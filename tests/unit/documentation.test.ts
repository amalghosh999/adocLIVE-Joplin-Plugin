import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

function pngDimensions(relativePath: string): { width: number; height: number } {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("public documentation", () => {
  it("uses conservative Markdown that renders on GitHub and the Joplin plugin page", () => {
    const readme = read("README.md");
    expect(readme).toMatch(/^# adocLIVE\n/);
    expect(readme).not.toMatch(/[\u2013\u2014]/);
    expect(readme).not.toMatch(/\bnot\s+[^.\n]+\s+but\s+[^.\n]+/i);
    expect(readme).toContain("docs/images/adoclive-live-preview.png");
    expect(readme).toContain("docs/USER_GUIDE.adoc");
    expect(fs.existsSync(path.join(root, "README.adoc"))).toBe(false);
    expect(fs.existsSync(path.join(root, "docs/USER_GUIDE.adoc"))).toBe(true);
    expect(read(".npmignore")).toContain("!README.md");
    const guide = read("docs/USER_GUIDE.adoc");
    expect(guide).toContain("link:test-lab/README.md[");
    expect(guide).toContain("link:../LICENSE[");
  });

  it("keeps every screenshot manifest entry labeled, local, and README-visible", () => {
    const readme = read("README.md");
    const manifest = JSON.parse(read("src/manifest.json")) as { screenshots?: Array<{ src: string; label: string }> };
    expect(manifest.screenshots).toHaveLength(3);
    for (const screenshot of manifest.screenshots || []) {
      expect(screenshot.src).toMatch(/^docs\/images\/[a-z0-9-]+\.png$/);
      expect(screenshot.label.trim().length).toBeGreaterThan(12);
      expect(readme).toContain(screenshot.src);
      expect(pngDimensions(screenshot.src)).toEqual({ width: 1280, height: 800 });
    }
  });

  it("uses only synthetic, repository-owned source for examples and screenshots", () => {
    for (const fileName of ["weekend-field-guide.adoc", "small-project-release.adoc"]) {
      const source = read(`examples/${fileName}`);
      expect(source).toContain("fictional");
      expect(source).not.toMatch(/(?:^|\s)\/home\//i);
      expect(source).not.toMatch(/(?:^|\s)[A-Z]:\\Users\\/i);
      expect(source).not.toMatch(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
    }
    const captureScript = read("scripts/capture-docs-screenshots.js");
    expect(captureScript).toContain("readSyntheticExample");
    expect(captureScript).toContain("privateSession");
    expect(captureScript).toContain("externalRequests");
  });
});
