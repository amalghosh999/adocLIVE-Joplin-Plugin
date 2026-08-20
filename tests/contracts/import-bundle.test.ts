import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { VISUAL_CANDIDATE_IDS } from "../../baseline/contracts";
import { importBundle } from "../../baseline/import-bundle";
import {
  artifactReference,
  computeBundleDigest,
  makeWritableRecursive,
  validateBundleDirectory,
  writeJson,
} from "../../baseline/node-utils";

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach(directory => {
  makeWritableRecursive(directory);
  fs.rmSync(directory, { recursive: true, force: true });
}));

function run(cwd: string, command: string, args: string[]): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function buildBundle(workspace: string): string {
  const root = path.join(workspace, "bundle-work");
  fs.mkdirSync(root);
  const add = (relativePath: string) => {
    const target = path.join(root, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, relativePath);
    return artifactReference(root, relativePath);
  };
  const visuals = VISUAL_CANDIDATE_IDS.map(id => ({
    id,
    scenario: id,
    before: add(`visual/before/${id}.png`),
    candidate: add(`visual/candidate/${id}.png`),
    diff: add(`visual/diff/${id}.png`),
    metrics: { width: 1, height: 1, threshold: .2, stabilityEpsilon: 2, maxDiffPixelRatio: .001, changedPixels: 0, diffPixelRatio: 0, maxChannelDelta: 0, dimensionsMatch: true },
  }));
  const unsigned = {
    schemaVersion: 1,
    kind: "BaselineCandidateBundle",
    bundleDigest: "0".repeat(64),
    createdAt: "2026-08-20T12:00:00.000Z",
    source: { commit: "a".repeat(40), clean: true },
    package: { name: "joplin-plugin-adoclive", version: "1.0.4" },
    environment: {
      container: "mcr.microsoft.com/playwright:v1.61.1-noble", playwrightVersion: "1.61.1", browser: "chromium",
      os: "Ubuntu", architecture: "x64", nodeVersion: "v26", npmVersion: "12", timezone: "America/Chicago",
      locale: "en-US", deviceScaleFactor: 1, canonical: true,
    },
    lockfile: add("metadata/package-lock.json"),
    visuals,
    scroll: {
      id: "scroll-raw-live-raw-mid-document", scenario: "raw-live-raw-mid-document", runs: 30, valuesPx: Array(30).fill(1),
      medianPx: 1, p99Px: 1, madPx: 0, rawLineHeightPx: 20, roundingMarginPx: 1, regressionCeilingPx: 2,
      quarterLineSafetyPx: 5, knownIssues: ["ADL-022", "ADL-023"], evidence: add("scroll/evidence.json"),
      frames: { medianBefore: add("scroll/median-before.png"), medianAfter: add("scroll/median-after.png"), worstBefore: add("scroll/worst-before.png"), worstAfter: add("scroll/worst-after.png") },
    },
    audit: { report: add("reports/audit.json"), counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
    tests: { report: add("reports/tests.json"), passed: true, scope: "release" },
    artifacts: { jpl: add("artifacts/plugin.jpl"), npmTarball: add("artifacts/package.tgz"), publishManifest: add("artifacts/plugin.json"), pluginManifest: add("metadata/plugin.json") },
    finalizable: true,
    draftReasons: [],
  };
  const digest = computeBundleDigest(unsigned);
  writeJson(path.join(root, "manifest.json"), { ...unsigned, bundleDigest: digest });
  const destination = path.join(workspace, digest);
  fs.renameSync(root, destination);
  validateBundleDirectory(destination, true);
  return destination;
}

function zipDirectory(root: string, directory: string, destination: string): void {
  const files: Record<string, Uint8Array> = {};
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else {
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        files[relative] = fs.readFileSync(absolute);
      }
    }
  };
  walk(path.join(root, directory));
  fs.writeFileSync(destination, zipSync(files, { level: 6 }));
}

function writeZipSymlink(destination: string): void {
  const bytes = Buffer.from(zipSync({ "candidate-link": Buffer.from("payload") }, { level: 0 }));
  const centralHeader = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  if (centralHeader < 0) throw new Error("Test ZIP has no central directory entry");
  bytes.writeUInt16LE(0x0314, centralHeader + 4);
  bytes.writeUInt32LE((0o120777 << 16) >>> 0, centralHeader + 38);
  fs.writeFileSync(destination, bytes);
}

describe("candidate bundle import", () => {
  it("imports validated directories idempotently and rejects source tampering", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "adoclive-import-directory-"));
    temporary.push(workspace);
    const source = buildBundle(workspace);
    const target = path.join(workspace, "target");
    const first = importBundle(source, target);
    expect(path.basename(first)).toBe(path.basename(source));
    expect(validateBundleDirectory(first, true).bundleDigest).toBe(path.basename(source));
    expect(fs.statSync(first).mode & 0o222).toBe(0);
    expect(fs.statSync(path.join(first, "manifest.json")).mode & 0o222).toBe(0);
    expect(importBundle(source, target)).toBe(first);
    fs.appendFileSync(path.join(source, "reports/audit.json"), "tampered");
    expect(() => importBundle(source, path.join(workspace, "tampered-target"))).toThrow(/hash mismatch|size mismatch/);
  });

  it("imports ZIP and tar artifacts and rejects traversal or symlink entries before extraction", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "adoclive-import-archives-"));
    temporary.push(workspace);
    const source = buildBundle(workspace);
    const digest = path.basename(source);
    const tarball = path.join(workspace, "candidate.tgz");
    const zip = path.join(workspace, "candidate.zip");
    run(workspace, "tar", ["-czf", tarball, digest]);
    zipDirectory(workspace, digest, zip);
    expect(validateBundleDirectory(importBundle(tarball, path.join(workspace, "tar-target")), true).bundleDigest).toBe(digest);
    expect(validateBundleDirectory(importBundle(zip, path.join(workspace, "zip-target")), true).bundleDigest).toBe(digest);

    const payload = path.join(workspace, "payload");
    fs.writeFileSync(payload, "escape attempt");
    const traversal = path.join(workspace, "traversal.tgz");
    run(workspace, "tar", ["-czf", traversal, "--transform=s|payload|../escaped.txt|", "payload"]);
    expect(() => importBundle(traversal, path.join(workspace, "traversal-target"))).toThrow(/unsafe path/);
    expect(fs.existsSync(path.join(workspace, "escaped.txt"))).toBe(false);

    const zipTraversal = path.join(workspace, "traversal.zip");
    fs.writeFileSync(zipTraversal, zipSync({ "../escaped-zip.txt": Buffer.from("escape attempt") }, { level: 0 }));
    expect(() => importBundle(zipTraversal, path.join(workspace, "zip-traversal-target"))).toThrow(/unsafe path/);
    expect(fs.existsSync(path.join(workspace, "escaped-zip.txt"))).toBe(false);

    const link = path.join(workspace, "candidate-link");
    fs.symlinkSync(payload, link);
    const symlinkArchive = path.join(workspace, "symlink.tgz");
    run(workspace, "tar", ["-czf", symlinkArchive, "candidate-link"]);
    fs.unlinkSync(link);
    expect(() => importBundle(symlinkArchive, path.join(workspace, "symlink-target"))).toThrow(/regular files and directories/);

    const symlinkZip = path.join(workspace, "symlink.zip");
    writeZipSymlink(symlinkZip);
    expect(() => importBundle(symlinkZip, path.join(workspace, "zip-symlink-target"))).toThrow(/regular files and directories/);
  });
});
