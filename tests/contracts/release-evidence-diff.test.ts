import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isAllowedEvidencePath, validateEvidenceDiff } from "../../baseline/release-publish";

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));

function git(directory: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function commit(directory: string, message: string, files: Record<string, string>): string {
  for (const [relativePath, value] of Object.entries(files)) {
    const target = path.join(directory, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  }
  git(directory, "add", ".");
  git(directory, "commit", "-m", message);
  return git(directory, "rev-parse", "HEAD");
}

function repository(): { directory: string; source: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adoclive-evidence-diff-"));
  temporary.push(directory);
  git(directory, "init", "-b", "master");
  const source = commit(directory, "source", { "package.json": "{}\n" });
  return { directory, source };
}

describe("release evidence diff", () => {
  it("allowlists only governed records and known visual IDs", () => {
    expect(isAllowedEvidencePath("tests/browser/baselines/visual/visual.spec.ts/block-gallery.png")).toBe(true);
    expect(isAllowedEvidencePath("tests/browser/baselines/visual/visual.spec.ts/invented.png")).toBe(false);
    expect(isAllowedEvidencePath(`docs/test-lab/evidence/baseline-reviews/${"a".repeat(64)}.receipt.json`)).toBe(true);
    expect(isAllowedEvidencePath("src/index.ts")).toBe(false);
  });

  it("accepts exactly one complete evidence commit and rejects missing records or extra commits", () => {
    const { directory, source } = repository();
    const receipt = `docs/test-lab/evidence/baseline-reviews/${"a".repeat(64)}.receipt.json`;
    const required = [
      "tests/browser/baselines/visual/baseline.json",
      "tests/browser/baselines/scroll/scroll-bounds.json",
      "docs/test-lab/evidence/BASELINE_APPROVAL.md",
      "docs/test-lab/evidence/NATIVE_JOPLIN_MATRIX.md",
      receipt,
    ];
    const head = commit(directory, "evidence", Object.fromEntries(required.map(file => [file, `${file}\n`])));
    expect(validateEvidenceDiff(source, head, directory, required).sort()).toEqual([...required].sort());
    expect(() => validateEvidenceDiff(source, head, directory, [...required, "tests/browser/baselines/visual/visual.spec.ts/block-gallery.png"]))
      .toThrow(/missing required/);
    const second = commit(directory, "extra evidence commit", { "docs/test-lab/evidence/BASELINE_APPROVAL.md": "changed again\n" });
    expect(() => validateEvidenceDiff(source, second, directory, required)).toThrow(/exactly one/);
  });

  it("rejects a one-commit source diff containing production code", () => {
    const { directory, source } = repository();
    const head = commit(directory, "not evidence only", { "src/index.ts": "export {};\n" });
    expect(() => validateEvidenceDiff(source, head, directory)).toThrow(/non-allowlisted/);
  });
});
