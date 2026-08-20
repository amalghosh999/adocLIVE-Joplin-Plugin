import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AdvisoryCountsV1Schema,
  BaselineCandidateBundleV1Schema,
  CandidateEnvironmentV1Schema,
  SafeRelativePathSchema,
  ScrollCandidateV1Schema,
  VISUAL_CANDIDATE_IDS,
} from "../../baseline/contracts";
import { canonicalJson, computeBundleDigest, validateBundleDirectory } from "../../baseline/node-utils";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("candidate bundle integrity utilities", () => {
  it("canonicalizes object keys without reordering arrays", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 }, items: [3, 2, 1] })).toBe('{"a":{"b":3,"y":2},"items":[3,2,1],"z":1}');
    expect(computeBundleDigest({ kind: "x", bundleDigest: "a".repeat(64), nested: { b: 1, a: 2 } }))
      .toBe(computeBundleDigest({ nested: { a: 2, b: 1 }, bundleDigest: "b".repeat(64), kind: "x" }));
  });

  it("rejects missing, traversal, tampered, and future-version bundle manifests", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adoclive-bundle-test-"));
    temporary.push(directory);
    fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ schemaVersion: 2 }));
    expect(() => validateBundleDirectory(directory, false)).toThrow();
    const linked = `${directory}-link`;
    fs.symlinkSync(directory, linked);
    temporary.push(linked);
    expect(() => validateBundleDirectory(linked, false)).toThrow(/real directory/);
    expect(() => SafeRelativePathSchema.parse("../outside")).toThrow(/traverse/);
    expect(() => SafeRelativePathSchema.parse("C:\\outside")).toThrow(/portable/);
  });

  it("derives canonical environment, audit totals, and scroll formulas instead of trusting flags", () => {
    const environment = {
      container: "mcr.microsoft.com/playwright:v1.61.1-noble",
      playwrightVersion: "1.61.1",
      browser: "chromium",
      os: "Ubuntu 24.04",
      architecture: "x64",
      nodeVersion: "v26.7.0",
      npmVersion: "12.0.2",
      timezone: "America/Chicago",
      locale: "en-US",
      deviceScaleFactor: 1,
      canonical: true,
    };
    expect(CandidateEnvironmentV1Schema.safeParse(environment).success).toBe(true);
    expect(CandidateEnvironmentV1Schema.safeParse({ ...environment, playwrightVersion: "1.61.0" }).success).toBe(false);
    expect(AdvisoryCountsV1Schema.safeParse({ info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 0 }).success).toBe(false);

    const artifact = { path: "evidence/file.png", sha256: "a".repeat(64), bytes: 1 };
    const scroll = {
      id: "scroll-raw-live-raw-mid-document",
      scenario: "raw-live-raw-mid-document",
      runs: 30,
      valuesPx: Array(30).fill(2),
      medianPx: 2,
      p99Px: 3,
      madPx: 2,
      rawLineHeightPx: 20,
      roundingMarginPx: 1,
      regressionCeilingPx: 5,
      quarterLineSafetyPx: 5,
      knownIssues: ["ADL-022", "ADL-023"],
      evidence: artifact,
      frames: { medianBefore: artifact, medianAfter: artifact, worstBefore: artifact, worstAfter: artifact },
    };
    expect(ScrollCandidateV1Schema.safeParse(scroll).success).toBe(true);
    expect(ScrollCandidateV1Schema.safeParse({ ...scroll, regressionCeilingPx: 4 }).success).toBe(false);
    expect(ScrollCandidateV1Schema.safeParse({ ...scroll, quarterLineSafetyPx: 4 }).success).toBe(false);
  });

  it("requires release-scoped test evidence before a bundle can be finalizable", () => {
    const ref = (artifactPath: string) => ({ path: artifactPath, sha256: "a".repeat(64), bytes: 1 });
    const input = {
      schemaVersion: 1,
      kind: "BaselineCandidateBundle",
      bundleDigest: "b".repeat(64),
      createdAt: "2026-08-20T12:00:00.000Z",
      source: { commit: "c".repeat(40), clean: true },
      package: { name: "joplin-plugin-adoclive", version: "1.0.4" },
      environment: {
        container: "mcr.microsoft.com/playwright:v1.61.1-noble", playwrightVersion: "1.61.1", browser: "chromium",
        os: "Ubuntu", architecture: "x64", nodeVersion: "v26", npmVersion: "12", timezone: "America/Chicago",
        locale: "en-US", deviceScaleFactor: 1, canonical: true,
      },
      lockfile: ref("metadata/package-lock.json"),
      visuals: VISUAL_CANDIDATE_IDS.map(id => ({
        id, scenario: id, before: ref(`visual/before/${id}.png`), candidate: ref(`visual/candidate/${id}.png`),
        diff: ref(`visual/diff/${id}.png`), metrics: { width: 1, height: 1, threshold: .2, stabilityEpsilon: 2, maxDiffPixelRatio: .001, changedPixels: 0, diffPixelRatio: 0, maxChannelDelta: 0, dimensionsMatch: true },
      })),
      scroll: {
        id: "scroll-raw-live-raw-mid-document", scenario: "raw-live-raw-mid-document", runs: 30, valuesPx: Array(30).fill(1),
        medianPx: 1, p99Px: 1, madPx: 0, rawLineHeightPx: 20, roundingMarginPx: 1, regressionCeilingPx: 2,
        quarterLineSafetyPx: 5, knownIssues: ["ADL-022", "ADL-023"], evidence: ref("scroll/evidence.json"),
        frames: { medianBefore: ref("scroll/median-before.png"), medianAfter: ref("scroll/median-after.png"), worstBefore: ref("scroll/worst-before.png"), worstAfter: ref("scroll/worst-after.png") },
      },
      audit: { report: ref("reports/audit.json"), counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
      tests: { report: ref("reports/tests.json"), passed: true, scope: "candidate" },
      artifacts: { jpl: ref("artifacts/plugin.jpl"), npmTarball: ref("artifacts/package.tgz"), publishManifest: ref("artifacts/plugin.json"), pluginManifest: ref("metadata/plugin.json") },
      finalizable: true,
      draftReasons: [],
    };
    expect(BaselineCandidateBundleV1Schema.safeParse(input).success).toBe(false);
    expect(BaselineCandidateBundleV1Schema.safeParse({
      ...input,
      tests: { ...input.tests, scope: "release" },
    }).success).toBe(true);
  });
});
