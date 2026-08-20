import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("candidate and release governance", () => {
  it("stages visual updates through immutable candidates and ignores generated bundles", () => {
    expect(packageJson.scripts["test:visual:update"]).toBe("npm run baseline:candidates");
    expect(packageJson.scripts["test:visual:update"]).not.toContain("update-snapshots");
    expect(source(".gitignore")).toContain(".baseline-candidates/");
    const generator = source("baseline/generate-candidates.ts");
    expect(generator).toContain("Candidate generation changed tracked repository state");
    expect(generator.match(/assertTrackedStateUnchanged\(initialStatus\)/g)).toHaveLength(2);
  });

  it("guards direct npm publication and keeps prepare separate from publish", () => {
    expect(packageJson.scripts.prepublishOnly).toContain("Direct npm publish is disabled");
    expect(packageJson.scripts["release:prepare"]).toContain("release-prepare");
    expect(packageJson.scripts["release:publish"]).toContain("release-publish");
    const publish = source("baseline/release-publish.ts");
    expect(publish).not.toMatch(/npm["'], \["run", "dist"/);
    expect(publish).not.toContain("npm version");
    expect(publish).toContain("bundle.artifacts.npmTarball.path");
    expect(publish).toContain("bundle.artifacts.jpl.path");
  });

  it("retains canonical CI candidates for 30 days and gates production audits", () => {
    const candidates = source(".github/workflows/baseline-candidates.yml");
    const testLab = source(".github/workflows/test-lab.yml");
    expect(candidates).toContain("mcr.microsoft.com/playwright:v1.61.1-noble");
    expect(candidates).toContain("retention-days: 30");
    expect(candidates).toContain("audit:prod:release");
    expect(testLab).toContain("audit:prod:pr");
    expect(testLab).toContain("audit:prod:release");
  });

  it("preserves the official Joplin npm discovery contract", () => {
    expect(packageJson.name.startsWith("joplin-plugin-")).toBe(true);
    expect(packageJson.keywords).toContain("joplin-plugin");
    expect(packageJson.files).toEqual(["publish"]);
  });
});
