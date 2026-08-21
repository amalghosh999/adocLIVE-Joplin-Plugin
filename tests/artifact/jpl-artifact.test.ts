import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, "src/manifest.json"), "utf8"));
const archive = path.join(root, "publish", `${sourceManifest.id}.jpl`);
let extracted = "";
let entries: string[] = [];

beforeAll(() => {
  if (!fs.existsSync(archive)) throw new Error(`Missing ${archive}; npm run dist must run before artifact smoke`);
  entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n").sort();
  extracted = fs.mkdtempSync(path.join(os.tmpdir(), "adoclive-jpl-smoke-"));
  execFileSync("tar", ["-xzf", archive, "-C", extracted]);
});

afterAll(() => fs.rmSync(extracted, { recursive: true, force: true }));

describe("generated JPL and npm payload", () => {
  it("contains required production files and license notices", () => {
    for (const required of [
      "manifest.json", "index.js", "panel.js", "index.js.LICENSE.txt", "panel.js.LICENSE.txt",
      "styles/editor.css", "styles/preview.css", "styles/katex.min.css",
    ]) expect(entries).toContain(required);
    expect(entries.some(entry => /^styles\/fonts\/KaTeX_.+\.woff2$/.test(entry))).toBe(true);
  });

  it("contains no laboratory source, fixtures, baselines, browser output, or binaries", () => {
    const forbidden = entries.filter(entry => /(^|\/)(test-lab|baseline-review|baseline-candidates|tests|docs|test-results|playwright-report|blob-report|node_modules|\.cache)(\/|$)|\.(png|webm|zip|trace)$/i.test(entry));
    expect(forbidden).toEqual([]);
  });

  it("agrees on package, source-manifest, packaged-manifest, and publish versions", () => {
    const packagedManifest = JSON.parse(fs.readFileSync(path.join(extracted, "manifest.json"), "utf8"));
    expect(packagedManifest.id).toBe(sourceManifest.id);
    expect(packagedManifest.version).toBe(sourceManifest.version);
    expect(packagedManifest.version).toBe(packageJson.version);
  });

  it("has no missing local CSS asset references", () => {
    for (const cssName of ["editor.css", "preview.css", "katex.min.css"]) {
      const cssPath = path.join(extracted, "styles", cssName);
      const css = fs.readFileSync(cssPath, "utf8");
      for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        const reference = match[1];
        if (/^(data:|https?:|#)/.test(reference)) continue;
        const target = path.resolve(path.dirname(cssPath), reference.split(/[?#]/)[0]);
        expect(fs.existsSync(target), `${cssName} references missing ${reference}`).toBe(true);
      }
    }
  });

  it("keeps the npm package restricted to publish artifacts", () => {
    const result = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" }));
    const details = Array.isArray(result) ? result[0] : Object.values(result)[0] as { files: Array<{ path: string }> };
    const files = details.files.map((entry: { path: string }) => entry.path);
    const allowedMetadata = new Set(["package.json", "README.md", "LICENSE"]);
    expect(files.every((entry: string) => allowedMetadata.has(entry) || entry.startsWith("publish/"))).toBe(true);
    expect(files.some((entry: string) => entry.endsWith(".jpl"))).toBe(true);
  });

  it("recreates byte-identical JPL output from an unchanged dist tree", () => {
    const before = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    execFileSync(process.execPath, ["scripts/create-publish-artifacts.js"], { cwd: root, stdio: "pipe" });
    const after = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    expect(after).toBe(before);
  });
});
