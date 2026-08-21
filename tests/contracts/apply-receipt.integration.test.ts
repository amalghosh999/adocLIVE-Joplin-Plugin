import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BaselineCandidateBundleV1Schema,
  BaselineReviewReceiptV1Schema,
  REVIEW_ITEM_IDS,
  VISUAL_CANDIDATE_IDS,
  type BaselineCandidateBundleV1,
  type BaselineReviewReceiptV1,
} from "../../baseline/contracts";
import { applyReceipt, verifyReleaseMetadata } from "../../baseline/apply-receipt";
import {
  artifactHashRecord,
  artifactReference,
  computeBundleDigest,
  validateBundleDirectory,
  writeJson,
} from "../../baseline/node-utils";

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));

const packageLockText = `${JSON.stringify({
  name: "joplin-plugin-adoclive",
  version: "1.0.4",
  lockfileVersion: 3,
  packages: { "": { name: "joplin-plugin-adoclive", version: "1.0.4" } },
})}\n`;

function run(cwd: string, command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function write(root: string, relativePath: string, content: string | Buffer): string {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function createRepository(workspace: string): { repo: string; commit: string; pluginManifest: Record<string, unknown> } {
  const repo = path.join(workspace, "repo");
  fs.mkdirSync(repo);
  const packageJson = {
    name: "joplin-plugin-adoclive",
    version: "1.0.4",
    keywords: ["joplin-plugin"],
    files: ["publish"],
  };
  const pluginManifest = {
    manifest_version: 1,
    id: "com.asciidoc.joplin-plugin",
    app_min_version: "3.0",
    version: "1.0.4",
    name: "adocLIVE",
  };
  write(repo, "package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
  write(repo, "package-lock.json", packageLockText);
  write(repo, "src/manifest.json", `${JSON.stringify(pluginManifest, null, 2)}\n`);
  write(repo, "tests/browser/baselines/visual/baseline.json", "{}\n");
  write(repo, "tests/browser/baselines/scroll/scroll-bounds.json", "{}\n");
  write(repo, "docs/test-lab/evidence/BASELINE_APPROVAL.md", "pending\n");
  write(repo, "docs/test-lab/evidence/NATIVE_JOPLIN_MATRIX.md", "pending\n");
  run(repo, "git", ["init", "-b", "master"]);
  run(repo, "git", ["add", "."]);
  run(repo, "git", ["commit", "-m", "source"]);
  return { repo, commit: run(repo, "git", ["rev-parse", "HEAD"]), pluginManifest };
}

function createBundle(
  workspace: string,
  sourceCommit: string,
  pluginManifest: Record<string, unknown>,
): { candidateRoot: string; bundleRoot: string; bundle: BaselineCandidateBundleV1 } {
  const candidateRoot = path.join(workspace, "candidates");
  const buildRoot = path.join(workspace, "build");
  const bundleWork = path.join(workspace, "bundle-work");
  fs.mkdirSync(candidateRoot);
  fs.mkdirSync(buildRoot);
  fs.mkdirSync(bundleWork);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Av7eWQAAAABJRU5ErkJggg==", "base64");
  const add = (relativePath: string, content: string | Buffer = relativePath) => {
    write(bundleWork, relativePath, content);
    return artifactReference(bundleWork, relativePath);
  };

  const visuals = VISUAL_CANDIDATE_IDS.map(id => ({
    id,
    scenario: `scenario/${id}`,
    before: add(`visual/before/${id}.png`, png),
    candidate: add(`visual/candidate/${id}.png`, png),
    diff: add(`visual/diff/${id}.png`, png),
    metrics: {
      width: 1, height: 1, threshold: 0.2, stabilityEpsilon: 2, maxDiffPixelRatio: 0.001,
      changedPixels: 0, diffPixelRatio: 0, maxChannelDelta: 0, dimensionsMatch: true,
    },
  }));
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  const lockfile = add("metadata/package-lock.json", packageLockText);
  const pluginManifestRef = add("metadata/plugin-manifest.json", `${JSON.stringify(pluginManifest, null, 2)}\n`);
  const auditReport = add("reports/production-audit.json", `${JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: counts },
  })}\n`);
  const releaseScripts = ["test:unit", "typecheck", "typecheck:lab", "test:joplin-sim", "test:browser", "test:a11y", "test:artifact-smoke"];
  const testReport = add("reports/candidate-tests.json", `${JSON.stringify({
    schemaVersion: 1,
    scope: "release",
    passed: true,
    commands: [
      "npm run dist",
      "node scripts/audit-production.ts --mode nightly --output /candidate/audit.json",
      ...releaseScripts.map(script => `npm run ${script}`),
      "npx playwright test tests/browser/visual.spec.ts --project=chromium",
      "npx playwright test tests/browser/scroll.spec.ts --project=chromium",
      "npm pack --json --ignore-scripts --pack-destination /candidate/artifacts",
    ],
  })}\n`);

  const jplSource = path.join(buildRoot, "jpl");
  fs.mkdirSync(jplSource);
  write(jplSource, "manifest.json", `${JSON.stringify(pluginManifest, null, 2)}\n`);
  write(jplSource, "index.js", "module.exports = {};\n");
  write(jplSource, "panel.js", "void 0;\n");
  const jplPath = write(bundleWork, "artifacts/com.asciidoc.joplin-plugin.jpl", "");
  run(buildRoot, "tar", ["-czf", jplPath, "-C", jplSource, "manifest.json", "index.js", "panel.js"]);
  const jpl = artifactReference(bundleWork, "artifacts/com.asciidoc.joplin-plugin.jpl");

  const publishManifestValue = {
    ...pluginManifest,
    _publish_hash: `sha256:${jpl.sha256}`,
    _publish_commit: `master:${sourceCommit}`,
  };
  const publishManifestText = `${JSON.stringify(publishManifestValue, null, 2)}\n`;
  const publishManifest = add("artifacts/com.asciidoc.joplin-plugin.json", publishManifestText);

  const npmRoot = path.join(buildRoot, "npm");
  const npmPackage = {
    name: "joplin-plugin-adoclive",
    version: "1.0.4",
    keywords: ["joplin-plugin"],
    files: ["publish"],
  };
  write(npmRoot, "package/package.json", `${JSON.stringify(npmPackage, null, 2)}\n`);
  write(npmRoot, "package/LICENSE", "MIT\n");
  write(npmRoot, "package/README.md", "# adocLIVE\n");
  fs.mkdirSync(path.join(npmRoot, "package/publish"), { recursive: true });
  fs.copyFileSync(jplPath, path.join(npmRoot, "package/publish/com.asciidoc.joplin-plugin.jpl"));
  write(npmRoot, "package/publish/com.asciidoc.joplin-plugin.json", publishManifestText);
  const tarballPath = write(bundleWork, "artifacts/joplin-plugin-adoclive-1.0.4.tgz", "");
  run(buildRoot, "tar", [
    "-czf", tarballPath, "-C", npmRoot,
    "package/LICENSE", "package/README.md", "package/package.json",
    "package/publish/com.asciidoc.joplin-plugin.jpl", "package/publish/com.asciidoc.joplin-plugin.json",
  ]);
  const npmTarball = artifactReference(bundleWork, "artifacts/joplin-plugin-adoclive-1.0.4.tgz");

  const valuesPx = Array(30).fill(1);
  const unsigned = {
    schemaVersion: 1 as const,
    kind: "BaselineCandidateBundle" as const,
    bundleDigest: "0".repeat(64),
    createdAt: "2026-08-20T12:00:00.000Z",
    source: { commit: sourceCommit, clean: true },
    package: { name: "joplin-plugin-adoclive", version: "1.0.4" },
    environment: {
      container: "mcr.microsoft.com/playwright:v1.61.1-noble",
      playwrightVersion: "1.61.1",
      browser: "chromium" as const,
      os: "Ubuntu 24.04",
      architecture: "x64",
      nodeVersion: "v26.7.0",
      npmVersion: "12.0.2",
      timezone: "America/Chicago" as const,
      locale: "en-US" as const,
      deviceScaleFactor: 1 as const,
      canonical: true,
    },
    lockfile,
    visuals,
    scroll: {
      id: "scroll-raw-live-raw-mid-document" as const,
      scenario: "raw-live-raw-mid-document" as const,
      runs: 30 as const,
      valuesPx,
      medianPx: 1,
      p99Px: 1,
      madPx: 0,
      rawLineHeightPx: 20,
      roundingMarginPx: 1 as const,
      regressionCeilingPx: 2,
      quarterLineSafetyPx: 5,
      knownIssues: ["ADL-022", "ADL-023"] as const,
      evidence: add("scroll/scroll-characterization.json", `${JSON.stringify({ valuesPx })}\n`),
      frames: {
        medianBefore: add("scroll/median-before.png", png),
        medianAfter: add("scroll/median-after.png", png),
        worstBefore: add("scroll/worst-before.png", png),
        worstAfter: add("scroll/worst-after.png", png),
      },
    },
    audit: { report: auditReport, counts },
    tests: { report: testReport, passed: true, scope: "release" as const },
    artifacts: { jpl, npmTarball, publishManifest, pluginManifest: pluginManifestRef },
    finalizable: true,
    draftReasons: [],
  };
  const bundleDigest = computeBundleDigest(unsigned);
  const bundle = BaselineCandidateBundleV1Schema.parse({ ...unsigned, bundleDigest });
  writeJson(path.join(bundleWork, "manifest.json"), bundle);
  const bundleRoot = path.join(candidateRoot, bundleDigest);
  fs.renameSync(bundleWork, bundleRoot);
  validateBundleDirectory(bundleRoot, true);
  return { candidateRoot, bundleRoot, bundle };
}

function createReceipt(bundle: BaselineCandidateBundleV1): BaselineReviewReceiptV1 {
  const hardenedJplDelta = {
    installStartup: true,
    representativeRender: true,
    themeAndViewChanges: true,
    hostileFixture: true,
    upgrade: true,
  };
  return BaselineReviewReceiptV1Schema.parse({
    schemaVersion: 1,
    kind: "BaselineReviewReceipt",
    bundleDigest: bundle.bundleDigest,
    sourceCommit: bundle.source.commit,
    artifactHashes: artifactHashRecord(bundle),
    reviewer: "Release Reviewer",
    reviewedAt: "2026-08-20T13:00:00.000Z",
    decisions: REVIEW_ITEM_IDS.map(itemId => ({ itemId, decision: "approved", note: "Reviewed individually." })),
    knownIssueAcknowledgements: { "ADL-022": true, "ADL-023": true },
    platformEvidence: (["windows", "macos"] as const).map(platform => ({
      schemaVersion: 1,
      platform,
      joplinVersion: "3.4.12",
      osVersion: platform === "windows" ? "Windows 11 24H2" : "macOS 15.6",
      date: "2026-08-20",
      verifier: "Release Reviewer",
      result: "pass",
      deviations: "None",
      hardenedJplDelta,
    })),
    overallRationale: "Every hash-bound visual, scroll, package, audit, and native-platform artifact agrees.",
  });
}

describe("baseline receipt application", () => {
  it("proves exact JPL/npm agreement, applies only governed evidence, and revalidates idempotently", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "adoclive-apply-integration-"));
    temporary.push(workspace);
    const { repo, commit, pluginManifest } = createRepository(workspace);
    const { candidateRoot, bundleRoot, bundle } = createBundle(workspace, commit, pluginManifest);
    const receipt = createReceipt(bundle);
    const receiptPath = write(workspace, "receipt.json", `${JSON.stringify(receipt, null, 2)}\n`);

    expect(() => verifyReleaseMetadata(bundleRoot, bundle)).not.toThrow();
    const applied = applyReceipt(receiptPath, { repoRoot: repo, candidateRoot });
    expect(applied).toEqual({
      idempotent: false,
      evidencePath: `docs/test-lab/evidence/baseline-reviews/${bundle.bundleDigest}.receipt.json`,
    });
    const changed = run(repo, "git", ["status", "--short", "--untracked-files=all"]).split("\n").filter(Boolean);
    expect(changed).toHaveLength(VISUAL_CANDIDATE_IDS.length + 5);
    expect(changed.every(line => /tests\/browser\/baselines|docs\/test-lab\/evidence/.test(line))).toBe(true);
    expect(applyReceipt(receiptPath, { repoRoot: repo, candidateRoot }).idempotent).toBe(true);

    const conflictingReceipt = write(workspace, "conflict.json", `${JSON.stringify({ ...receipt, reviewer: "Different Reviewer" }, null, 2)}\n`);
    expect(() => applyReceipt(conflictingReceipt, { repoRoot: repo, candidateRoot })).toThrow(/conflicting receipt/);
    fs.writeFileSync(path.join(repo, "tests/browser/baselines/visual/visual.spec.ts/block-gallery.png"), "tampered");
    expect(() => applyReceipt(receiptPath, { repoRoot: repo, candidateRoot })).toThrow(/promoted baseline or native evidence conflicts/);
  });

  it("rejects a tarball whose nested JPL differs from the reviewed artifact", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "adoclive-artifact-agreement-"));
    temporary.push(workspace);
    const { commit, pluginManifest } = createRepository(workspace);
    const { bundleRoot, bundle } = createBundle(workspace, commit, pluginManifest);
    const tarball = path.join(bundleRoot, bundle.artifacts.npmTarball.path);
    const extracted = path.join(workspace, "tampered-npm");
    fs.mkdirSync(extracted);
    run(workspace, "tar", ["-xzf", tarball, "-C", extracted]);
    fs.appendFileSync(path.join(extracted, "package/publish/com.asciidoc.joplin-plugin.jpl"), "tampered");
    run(workspace, "tar", [
      "-czf", tarball, "-C", extracted,
      "package/LICENSE", "package/README.md", "package/package.json",
      "package/publish/com.asciidoc.joplin-plugin.jpl", "package/publish/com.asciidoc.joplin-plugin.json",
    ]);
    expect(() => verifyReleaseMetadata(bundleRoot, bundle)).toThrow(/exact reviewed JPL bytes/);
  });
});
