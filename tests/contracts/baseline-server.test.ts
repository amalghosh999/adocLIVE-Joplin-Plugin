import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VISUAL_CANDIDATE_IDS } from "../../baseline/contracts";
import { artifactReference, computeBundleDigest, writeJson } from "../../baseline/node-utils";

const require = createRequire(import.meta.url);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "adoclive-baseline-server-"));
const candidatesRoot = path.join(temporaryRoot, "candidates");
let bundleDirectory = "";
let bundleDigest = "";
let controller: http.Server;
let editor: http.Server;
let origin = "";
let editorOrigin = "";

function writeArtifact(root: string, relative: string, content = relative) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return artifactReference(root, relative);
}

function buildBundle(): string {
  fs.mkdirSync(candidatesRoot, { recursive: true });
  const work = path.join(temporaryRoot, "work");
  fs.mkdirSync(work);
  const visuals = VISUAL_CANDIDATE_IDS.map(id => ({
    id,
    scenario: `scenario/${id}`,
    before: writeArtifact(work, `visual/before/${id}.png`),
    candidate: writeArtifact(work, `visual/candidate/${id}.png`),
    diff: writeArtifact(work, `visual/diff/${id}.png`),
    metrics: { width: 1, height: 1, threshold: 0.2, stabilityEpsilon: 2, maxDiffPixelRatio: 0.001, changedPixels: 0, diffPixelRatio: 0, maxChannelDelta: 0, dimensionsMatch: true },
  }));
  const valuesPx = Array.from({ length: 30 }, (_, index) => index);
  const unsigned = {
    schemaVersion: 1,
    kind: "BaselineCandidateBundle",
    bundleDigest: "0".repeat(64),
    createdAt: "2026-08-20T12:00:00.000Z",
    source: { commit: "a".repeat(40), clean: true },
    package: { name: "joplin-plugin-adoclive", version: "1.0.4" },
    environment: {
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
    },
    lockfile: writeArtifact(work, "metadata/package-lock.json"),
    visuals,
    scroll: {
      id: "scroll-raw-live-raw-mid-document",
      scenario: "raw-live-raw-mid-document",
      runs: 30,
      valuesPx,
      medianPx: 14,
      p99Px: 29,
      madPx: 7,
      rawLineHeightPx: 18,
      roundingMarginPx: 1,
      regressionCeilingPx: 36,
      quarterLineSafetyPx: 4.5,
      knownIssues: ["ADL-022", "ADL-023"],
      evidence: writeArtifact(work, "scroll/scroll-characterization.json"),
      frames: {
        medianBefore: writeArtifact(work, "scroll/median-before.png"),
        medianAfter: writeArtifact(work, "scroll/median-after.png"),
        worstBefore: writeArtifact(work, "scroll/worst-before.png"),
        worstAfter: writeArtifact(work, "scroll/worst-after.png"),
      },
    },
    audit: {
      report: writeArtifact(work, "reports/production-audit.json"),
      counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
    },
    tests: { report: writeArtifact(work, "reports/candidate-tests.json"), passed: true, scope: "release" },
    artifacts: {
      jpl: writeArtifact(work, "artifacts/com.asciidoc.joplin-plugin.jpl"),
      npmTarball: writeArtifact(work, "artifacts/joplin-plugin-adoclive-1.0.4.tgz"),
      publishManifest: writeArtifact(work, "artifacts/com.asciidoc.joplin-plugin.json"),
      pluginManifest: writeArtifact(work, "metadata/plugin-manifest.json"),
    },
    finalizable: true,
    draftReasons: [],
  };
  bundleDigest = computeBundleDigest(unsigned);
  writeJson(path.join(work, "manifest.json"), { ...unsigned, bundleDigest });
  bundleDirectory = path.join(candidatesRoot, bundleDigest);
  fs.renameSync(work, bundleDirectory);
  return bundleDirectory;
}

beforeAll(async () => {
  buildBundle();
  process.env.ADOC_BASELINE_CANDIDATE_ROOT = candidatesRoot;
  const server = require("../../scripts/lab-server.js") as { controller: http.Server; editor: http.Server };
  controller = server.controller;
  editor = server.editor;
  await new Promise<void>(resolve => controller.listen(0, "127.0.0.1", resolve));
  await new Promise<void>(resolve => editor.listen(0, "127.0.0.1", resolve));
  const address = controller.address();
  if (!address || typeof address === "string") throw new Error("Controller did not bind a test port");
  origin = `http://127.0.0.1:${address.port}`;
  const editorAddress = editor.address();
  if (!editorAddress || typeof editorAddress === "string") throw new Error("Editor did not bind a test port");
  editorOrigin = `http://127.0.0.1:${editorAddress.port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => controller.close(() => resolve()));
  await new Promise<void>(resolve => editor.close(() => resolve()));
  delete process.env.ADOC_BASELINE_CANDIDATE_ROOT;
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("baseline-review server boundary", () => {
  it("lists only validated bundles and serves whitelisted artifacts", async () => {
    const runs = await fetch(`${origin}/baseline-review/runs`);
    expect(runs.status).toBe(200);
    expect((await runs.json()).runs).toHaveLength(1);
    const manifest = await fetch(`${origin}/baseline-review/runs/${bundleDigest}/manifest`);
    expect(manifest.status).toBe(200);
    expect((await manifest.json()).bundleDigest).toBe(bundleDigest);
    const artifact = await fetch(`${origin}/baseline-review/runs/${bundleDigest}/files/metadata/plugin-manifest.json`);
    expect(artifact.status).toBe(200);
    expect(await artifact.text()).toBe("metadata/plugin-manifest.json");
    const head = await fetch(`${origin}/baseline-review/runs/${bundleDigest}/manifest`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const editorApi = await fetch(`${editorOrigin}/baseline-review/runs`);
    expect(editorApi.status).toBe(404);
  });

  it("rejects traversal, unlisted files, mutation methods, and tampered bundles", async () => {
    const traversal = await fetch(`${origin}/baseline-review/runs/${bundleDigest}/files/..%2Fpackage.json`);
    expect(traversal.status).toBe(404);
    const unlisted = await fetch(`${origin}/baseline-review/runs/${bundleDigest}/files/not-listed.txt`);
    expect(unlisted.status).toBe(404);
    const post = await fetch(`${origin}/baseline-review/runs`, { method: "POST" });
    expect(post.status).toBe(405);
    fs.appendFileSync(path.join(bundleDirectory, "metadata", "plugin-manifest.json"), "tampered");
    const afterTamper = await fetch(`${origin}/baseline-review/runs`);
    expect((await afterTamper.json()).runs).toHaveLength(0);
  });

  it("refuses to bind a non-loopback host", () => {
    const result = spawnSync(process.execPath, ["scripts/lab-server.js"], {
      cwd: path.resolve(__dirname, "../.."),
      env: { ...process.env, ADOC_LAB_HOST: "0.0.0.0" },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("loopback-only");
  });
});
