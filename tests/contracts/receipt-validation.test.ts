import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BaselineCandidateBundleV1Schema, REVIEW_ITEM_IDS, VISUAL_CANDIDATE_IDS } from "../../baseline/contracts";
import { validateReceiptAgainstBundle, validateSourcePreconditions } from "../../baseline/apply-receipt";
import { artifactHashRecord, sha256File } from "../../baseline/node-utils";

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));
const ref = (path: string) => ({ path, sha256: "a".repeat(64), bytes: 1 });

function bundle(sourceCommit = "b".repeat(40)) {
  return BaselineCandidateBundleV1Schema.parse({
    schemaVersion: 1,
    kind: "BaselineCandidateBundle",
    bundleDigest: "c".repeat(64),
    createdAt: "2026-08-20T12:00:00.000Z",
    source: { commit: sourceCommit, clean: true },
    package: { name: "joplin-plugin-adoclive", version: "1.0.4" },
    environment: { container: "mcr.microsoft.com/playwright:v1.61.1-noble", playwrightVersion: "1.61.1", browser: "chromium", os: "Ubuntu 24.04", architecture: "x64", nodeVersion: "v26.7.0", npmVersion: "12.0.2", timezone: "America/Chicago", locale: "en-US", deviceScaleFactor: 1, canonical: true },
    lockfile: ref("metadata/package-lock.json"),
    visuals: VISUAL_CANDIDATE_IDS.map(id => ({ id, scenario: id, before: ref(`visual/before/${id}.png`), candidate: ref(`visual/candidate/${id}.png`), diff: ref(`visual/diff/${id}.png`), metrics: { width: 1, height: 1, threshold: .2, stabilityEpsilon: 2, maxDiffPixelRatio: .001, changedPixels: 0, diffPixelRatio: 0, maxChannelDelta: 0, dimensionsMatch: true } })),
    scroll: { id: "scroll-raw-live-raw-mid-document", scenario: "raw-live-raw-mid-document", runs: 30, valuesPx: Array(30).fill(1), medianPx: 1, p99Px: 1, madPx: 0, rawLineHeightPx: 18, roundingMarginPx: 1, regressionCeilingPx: 2, quarterLineSafetyPx: 4.5, knownIssues: ["ADL-022", "ADL-023"], evidence: ref("scroll/evidence.json"), frames: { medianBefore: ref("scroll/median-before.png"), medianAfter: ref("scroll/median-after.png"), worstBefore: ref("scroll/worst-before.png"), worstAfter: ref("scroll/worst-after.png") } },
    audit: { report: ref("reports/audit.json"), counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
    tests: { report: ref("reports/tests.json"), passed: true, scope: "release" },
    artifacts: { jpl: ref("artifacts/plugin.jpl"), npmTarball: ref("artifacts/package.tgz"), publishManifest: ref("artifacts/plugin.json"), pluginManifest: ref("metadata/plugin.json") },
    finalizable: true,
    draftReasons: [],
  });
}

function receipt(candidate = bundle()) {
  const delta = { installStartup: true, representativeRender: true, themeAndViewChanges: true, hostileFixture: true, upgrade: true };
  return {
    schemaVersion: 1,
    kind: "BaselineReviewReceipt",
    bundleDigest: candidate.bundleDigest,
    sourceCommit: candidate.source.commit,
    artifactHashes: artifactHashRecord(candidate),
    reviewer: "Release Reviewer",
    reviewedAt: "2026-08-20T13:00:00.000Z",
    decisions: REVIEW_ITEM_IDS.map(itemId => ({ itemId, decision: "approved", note: "" })),
    knownIssueAcknowledgements: { "ADL-022": true, "ADL-023": true },
    platformEvidence: ["windows", "macos"].map(platform => ({ schemaVersion: 1, platform, joplinVersion: "3.4.12", osVersion: "current", date: "2026-08-20", verifier: "Release Reviewer", result: "pass", deviations: "None", hardenedJplDelta: delta })),
    overallRationale: "The exact evidence and artifacts agree.",
  };
}

function git(directory: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" } });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function sourceBundle(directory: string, sourceCommit: string) {
  const candidate = bundle(sourceCommit);
  return BaselineCandidateBundleV1Schema.parse({
    ...candidate,
    lockfile: { ...candidate.lockfile, sha256: sha256File(path.join(directory, "package-lock.json")) },
    artifacts: {
      ...candidate.artifacts,
      pluginManifest: { ...candidate.artifacts.pluginManifest, sha256: sha256File(path.join(directory, "src", "manifest.json")) },
    },
  });
}

describe("receipt and apply validation", () => {
  it("accepts a complete exact receipt and rejects tampered hash inventories", () => {
    const candidate = bundle();
    expect(validateReceiptAgainstBundle(receipt(candidate), candidate).bundleDigest).toBe(candidate.bundleDigest);
    const tampered = receipt(candidate);
    tampered.artifactHashes[Object.keys(tampered.artifactHashes)[0]] = "f".repeat(64);
    expect(() => validateReceiptAgainstBundle(tampered, candidate)).toThrow(/hash inventory/);
    expect(() => validateReceiptAgainstBundle({ ...receipt(candidate), schemaVersion: 2 }, candidate)).toThrow();
  });

  it("rejects incomplete review, issue, rationale, timestamp, and native-platform evidence", () => {
    const candidate = bundle();
    const complete = receipt(candidate);
    expect(() => validateReceiptAgainstBundle({ ...complete, reviewer: "" }, candidate)).toThrow();
    expect(() => validateReceiptAgainstBundle({ ...complete, decisions: complete.decisions.slice(1) }, candidate)).toThrow();
    expect(() => validateReceiptAgainstBundle({ ...complete, knownIssueAcknowledgements: { "ADL-022": false, "ADL-023": true } }, candidate)).toThrow();
    expect(() => validateReceiptAgainstBundle({ ...complete, overallRationale: " " }, candidate)).toThrow();
    expect(() => validateReceiptAgainstBundle({ ...complete, reviewedAt: "2026-08-20T11:00:00.000Z" }, candidate)).toThrow(/predates/);
    expect(() => validateReceiptAgainstBundle({
      ...complete,
      platformEvidence: complete.platformEvidence.map((item, index) => index ? item : { ...item, hardenedJplDelta: { ...item.hardenedJplDelta, upgrade: false } }),
    }, candidate)).toThrow();
  });

  it("fails closed for noncanonical and advisory-bearing candidate bundles", () => {
    const candidate = bundle();
    const noncanonical = {
      ...candidate,
      finalizable: false,
      draftReasons: ["Noncanonical environment."],
      environment: { ...candidate.environment, container: null, canonical: false },
    };
    expect(() => validateReceiptAgainstBundle(receipt(candidate), noncanonical)).toThrow(/nonfinalizable/);
    const advisory = {
      ...candidate,
      finalizable: false,
      draftReasons: ["Production advisory."],
      audit: { ...candidate.audit, counts: { ...candidate.audit.counts, high: 1, total: 1 } },
    };
    expect(() => validateReceiptAgainstBundle(receipt(candidate), advisory)).toThrow(/advisories/);
  });

  it("rejects dirty trees, stale commits, and mismatched release metadata", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adoclive-apply-source-"));
    temporary.push(directory);
    fs.mkdirSync(path.join(directory, "src"));
    fs.writeFileSync(path.join(directory, "package.json"), '{"version":"1.0.4"}\n');
    fs.writeFileSync(path.join(directory, "package-lock.json"), '{"name":"joplin-plugin-adoclive","version":"1.0.4"}\n');
    fs.writeFileSync(path.join(directory, "src", "manifest.json"), '{"version":"1.0.4"}\n');
    git(directory, "init", "-b", "master");
    git(directory, "add", ".");
    git(directory, "commit", "-m", "source");
    const head = git(directory, "rev-parse", "HEAD");
    const candidate = sourceBundle(directory, head);
    const reviewed = validateReceiptAgainstBundle(receipt(candidate), candidate);
    expect(() => validateSourcePreconditions(directory, reviewed, candidate)).not.toThrow();
    const wrongLock = BaselineCandidateBundleV1Schema.parse({ ...candidate, lockfile: { ...candidate.lockfile, sha256: "f".repeat(64) } });
    const wrongLockReceipt = validateReceiptAgainstBundle(receipt(wrongLock), wrongLock);
    expect(() => validateSourcePreconditions(directory, wrongLockReceipt, wrongLock)).toThrow(/lockfile/);
    fs.writeFileSync(path.join(directory, "dirty.txt"), "dirty");
    expect(() => validateSourcePreconditions(directory, reviewed, candidate)).toThrow(/clean working tree/);
    fs.rmSync(path.join(directory, "dirty.txt"));
    fs.writeFileSync(path.join(directory, "package.json"), '{"version":"1.0.5"}\n');
    git(directory, "add", ".");
    git(directory, "commit", "-m", "later");
    expect(() => validateSourcePreconditions(directory, reviewed, candidate)).toThrow(/Stale receipt/);
    const currentHead = git(directory, "rev-parse", "HEAD");
    const currentCandidate = sourceBundle(directory, currentHead);
    const currentReceipt = validateReceiptAgainstBundle(receipt(currentCandidate), currentCandidate);
    expect(() => validateSourcePreconditions(directory, currentReceipt, currentCandidate)).toThrow(/version metadata/);
  });
});
