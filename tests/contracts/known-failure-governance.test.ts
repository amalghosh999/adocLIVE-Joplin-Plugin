import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

describe("known-failure governance", () => {
  const catalog = fs.readFileSync(path.join(root, "docs/test-lab/KNOWN_FAILURES.md"), "utf8");
  const activeIds = new Set([...catalog.matchAll(/^\| (ADL-\d{3}) \|/gm)].map(match => match[1]));
  const testSources = sourceFiles(path.join(root, "tests")).map(file => fs.readFileSync(file, "utf8"));

  it("ties every active catalog record to an executable test", () => {
    expect(activeIds.size).toBeGreaterThan(0);
    for (const id of activeIds) {
      expect(testSources.some(source => source.includes(id)), `${id} has no exact executable contract`).toBe(true);
    }
  });

  it("requires every expected-failure marker to have an active reviewed ID", () => {
    const markedIds = new Set<string>();
    for (const source of testSources) {
      for (const line of source.split("\n")) {
        if (!/(?:test\.fail|it\.fails)/.test(line)) continue;
        for (const match of line.matchAll(/ADL-\d{3}/g)) markedIds.add(match[0]);
      }
    }
    expect(markedIds.size).toBeGreaterThan(0);
    for (const id of markedIds) expect(activeIds.has(id), `${id} is expected-failing but absent from the active catalog`).toBe(true);
  });
});
