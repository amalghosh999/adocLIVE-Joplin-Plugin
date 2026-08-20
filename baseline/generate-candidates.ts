import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  BaselineCandidateBundleV1Schema,
  CANONICAL_CONTAINER,
  CANONICAL_PLAYWRIGHT_VERSION,
  VISUAL_CANDIDATE_IDS,
  type BaselineCandidateBundleV1,
} from "./contracts.ts";
import {
  artifactReference,
  computeBundleDigest,
  copyIntoBundle,
  makeWritableRecursive,
  setBundleReadOnly,
  validateBundleDirectory,
  writeJson,
} from "./node-utils.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const visualScenarioNames: Record<(typeof VISUAL_CANDIDATE_IDS)[number], string> = {
  "block-gallery": "block-gallery",
  "block-editor-modal": "tables-code/block-editor-modal",
  "dark-live-preview": "inline-sections/dark/live-preview",
  "floating-section-preview": "tables-code/floating-section-preview",
  "footnote-popup": "tables-code/footnote-popup",
  "high-contrast-live-preview": "inline-sections/high-contrast/live-preview",
  "light-live-preview": "inline-sections/light/live-preview",
  "light-preview": "inline-sections/light/preview",
  "light-raw": "inline-sections/light/raw",
  "light-split": "inline-sections/light/split",
  "narrow-high-contrast": "inline-sections/high-contrast/375x667",
  "search-ui": "tables-code/search-ui",
  "toolbar-dropdown": "tables-code/toolbar-dropdown",
};

interface CommandResult {
  command: string;
  stdout: string;
}

function run(command: string, args: string[], environment: NodeJS.ProcessEnv = {}): CommandResult {
  const label = [command, ...args].join(" ");
  console.log(`[baseline:candidates] ${label}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...environment },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
  return { command: label, stdout: result.stdout || "" };
}

function git(...args: string[]): string {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertTrackedStateUnchanged(initialStatus: string): void {
  const finalStatus = git("status", "--porcelain=v1", "--untracked-files=all");
  if (finalStatus !== initialStatus) throw new Error("Candidate generation changed tracked repository state");
}

function osDescription(): string {
  if (fs.existsSync("/etc/os-release")) {
    const values = Object.fromEntries(fs.readFileSync("/etc/os-release", "utf8").split("\n")
      .map(line => line.match(/^([A-Z_]+)=(.*)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map(match => [match[1], match[2].replace(/^"|"$/g, "")]));
    return values.PRETTY_NAME || `${os.platform()} ${os.release()}`;
  }
  return `${os.platform()} ${os.release()}`;
}

async function createDiff(
  beforePath: string,
  candidatePath: string,
  diffPath: string,
): Promise<{
  width: number;
  height: number;
  threshold: number;
  stabilityEpsilon: number;
  maxDiffPixelRatio: number;
  changedPixels: number;
  diffPixelRatio: number;
  maxChannelDelta: number;
  dimensionsMatch: boolean;
}> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const result = await page.evaluate(async ({ before, candidate, threshold, stabilityEpsilon }) => {
      const load = (encoded: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Unable to decode candidate PNG"));
        image.src = `data:image/png;base64,${encoded}`;
      });
      const [beforeImage, candidateImage] = await Promise.all([load(before), load(candidate)]);
      const width = Math.max(beforeImage.width, candidateImage.width);
      const height = Math.max(beforeImage.height, candidateImage.height);
      const beforeCanvas = document.createElement("canvas");
      const candidateCanvas = document.createElement("canvas");
      const diffCanvas = document.createElement("canvas");
      for (const canvas of [beforeCanvas, candidateCanvas, diffCanvas]) {
        canvas.width = width;
        canvas.height = height;
      }
      const beforeContext = beforeCanvas.getContext("2d", { willReadFrequently: true })!;
      const candidateContext = candidateCanvas.getContext("2d", { willReadFrequently: true })!;
      const diffContext = diffCanvas.getContext("2d")!;
      beforeContext.clearRect(0, 0, width, height);
      candidateContext.clearRect(0, 0, width, height);
      beforeContext.drawImage(beforeImage, 0, 0);
      candidateContext.drawImage(candidateImage, 0, 0);
      const beforePixels = beforeContext.getImageData(0, 0, width, height).data;
      const candidateImageData = candidateContext.getImageData(0, 0, width, height);
      const candidatePixels = candidateImageData.data;
      const diff = diffContext.createImageData(width, height);
      let changedPixels = 0;
      let maxChannelDelta = 0;
      const cutoff = threshold * 255;
      for (let index = 0; index < beforePixels.length; index += 4) {
        const red = Math.abs(beforePixels[index] - candidatePixels[index]);
        const green = Math.abs(beforePixels[index + 1] - candidatePixels[index + 1]);
        const blue = Math.abs(beforePixels[index + 2] - candidatePixels[index + 2]);
        const alpha = Math.abs(beforePixels[index + 3] - candidatePixels[index + 3]);
        let delta = Math.max(red, green, blue, alpha);
        if (delta <= stabilityEpsilon) {
          candidatePixels[index] = beforePixels[index];
          candidatePixels[index + 1] = beforePixels[index + 1];
          candidatePixels[index + 2] = beforePixels[index + 2];
          candidatePixels[index + 3] = beforePixels[index + 3];
          delta = 0;
        }
        maxChannelDelta = Math.max(maxChannelDelta, delta);
        if (delta > cutoff) {
          changedPixels += 1;
          diff.data.set([220, 38, 38, 255], index);
        } else {
          const luminance = Math.round(candidatePixels[index] * .299 + candidatePixels[index + 1] * .587 + candidatePixels[index + 2] * .114);
          diff.data.set([luminance, luminance, luminance, 72], index);
        }
      }
      candidateContext.putImageData(candidateImageData, 0, 0);
      diffContext.putImageData(diff, 0, 0);
      return {
        width,
        height,
        changedPixels,
        diffPixelRatio: changedPixels / (width * height),
        maxChannelDelta,
        dimensionsMatch: beforeImage.width === candidateImage.width && beforeImage.height === candidateImage.height,
        candidatePng: candidateCanvas.toDataURL("image/png").slice("data:image/png;base64,".length),
        png: diffCanvas.toDataURL("image/png").slice("data:image/png;base64,".length),
      };
    }, {
      before: fs.readFileSync(beforePath).toString("base64"),
      candidate: fs.readFileSync(candidatePath).toString("base64"),
      threshold: 0.2,
      stabilityEpsilon: 2,
    });
    fs.mkdirSync(path.dirname(diffPath), { recursive: true });
    fs.writeFileSync(candidatePath, Buffer.from(result.candidatePng, "base64"));
    fs.writeFileSync(diffPath, Buffer.from(result.png, "base64"));
    return {
      width: result.width,
      height: result.height,
      threshold: 0.2,
      stabilityEpsilon: 2,
      maxDiffPixelRatio: 0.001,
      changedPixels: result.changedPixels,
      diffPixelRatio: result.diffPixelRatio,
      maxChannelDelta: result.maxChannelDelta,
      dimensionsMatch: result.dimensionsMatch,
    };
  } finally {
    await browser.close();
  }
}

function candidatePorts(): { controller: string; editor: string } {
  const base = 43000 + (process.pid % 1000) * 2;
  return { controller: String(base), editor: String(base + 1) };
}

export async function generateCandidates(): Promise<string> {
  const requireCanonical = process.argv.includes("--canonical");
  const candidatesRoot = path.resolve(repoRoot, argument("--output-root") || ".baseline-candidates");
  fs.mkdirSync(candidatesRoot, { recursive: true });
  const temporaryRoot = fs.mkdtempSync(path.join(candidatesRoot, ".tmp-"));
  const initialStatus = git("status", "--porcelain=v1", "--untracked-files=all");
  const sourceCommit = git("rev-parse", "HEAD");
  const sourceClean = initialStatus.length === 0;
  const createdAt = new Date(git("show", "-s", "--format=%cI", "HEAD")).toISOString();
  const playwrightPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, "node_modules", "@playwright", "test", "package.json"), "utf8"));
  const container = process.env.ADOC_CANONICAL_CONTAINER || null;
  const canonicalEnvironment = container === CANONICAL_CONTAINER && playwrightPackage.version === CANONICAL_PLAYWRIGHT_VERSION;
  const commands: string[] = [];

  try {
    if (requireCanonical && !sourceClean) throw new Error("Canonical candidate generation requires a clean source commit");
    if (requireCanonical && !canonicalEnvironment) {
      throw new Error(`Canonical generation requires ${CANONICAL_CONTAINER} with Playwright ${CANONICAL_PLAYWRIGHT_VERSION}`);
    }
    commands.push(run("npm", ["run", "dist"]).command);
    const auditPath = path.join(temporaryRoot, "reports", "production-audit.json");
    commands.push(run("node", ["scripts/audit-production.ts", "--mode", "nightly", "--output", auditPath]).command);
    const auditReport = JSON.parse(fs.readFileSync(auditPath, "utf8"));
    const counts = auditReport.metadata.vulnerabilities;
    if (requireCanonical && counts.total !== 0) throw new Error(`Canonical candidate generation requires zero production advisories; found ${counts.total}`);

    if (requireCanonical) {
      for (const script of ["test:unit", "typecheck", "typecheck:lab", "test:joplin-sim", "test:browser", "test:a11y", "test:artifact-smoke"]) {
        commands.push(run("npm", ["run", script]).command);
      }
    }

    const ports = candidatePorts();
    const browserEnvironment = {
      ADOC_LAB_CONTROLLER_PORT: ports.controller,
      ADOC_LAB_EDITOR_PORT: ports.editor,
      ADOC_BASELINE_CANDIDATE_DIR: path.join(temporaryRoot, "visual", "candidate"),
      CI: "true",
      TZ: "America/Chicago",
    };
    commands.push(run("npx", ["playwright", "test", "tests/browser/visual.spec.ts", "--project=chromium", "--workers=1", "--retries=0"], browserEnvironment).command);
    commands.push(run("npx", ["playwright", "test", "tests/browser/scroll.spec.ts", "--grep", "characterizes 30", "--project=chromium", "--workers=1", "--retries=0"], {
      ...browserEnvironment,
      ADOC_BASELINE_CANDIDATE_DIR: "",
      ADOC_SCROLL_CANDIDATE_DIR: path.join(temporaryRoot, "scroll"),
      ADOC_LAB_PRINT_METRICS: "1",
    }).command);

    const visualCandidates = [];
    for (const id of VISUAL_CANDIDATE_IDS) {
      const descriptor = { id, fileName: `${id}.png`, scenario: visualScenarioNames[id] };
      const beforeRelative = `visual/before/${descriptor.fileName}`;
      const candidateRelative = `visual/candidate/${descriptor.fileName}`;
      const diffRelative = `visual/diff/${descriptor.fileName}`;
      const beforeSource = path.join(repoRoot, "tests", "browser", "baselines", "visual", "visual.spec.ts", descriptor.fileName);
      const beforePath = path.join(temporaryRoot, beforeRelative);
      fs.mkdirSync(path.dirname(beforePath), { recursive: true });
      fs.copyFileSync(beforeSource, beforePath);
      const candidatePath = path.join(temporaryRoot, candidateRelative);
      if (!fs.existsSync(candidatePath)) throw new Error(`Visual candidate was not generated: ${descriptor.id}`);
      const metrics = await createDiff(beforePath, candidatePath, path.join(temporaryRoot, diffRelative));
      visualCandidates.push({
        id: descriptor.id,
        scenario: descriptor.scenario,
        before: artifactReference(temporaryRoot, beforeRelative),
        candidate: artifactReference(temporaryRoot, candidateRelative),
        diff: artifactReference(temporaryRoot, diffRelative),
        metrics,
      });
    }

    const scrollEvidencePath = path.join(temporaryRoot, "scroll", "scroll-characterization.json");
    const scrollResult = JSON.parse(fs.readFileSync(scrollEvidencePath, "utf8"));
    const roundingMarginPx = 1;
    const scroll = {
      id: "scroll-raw-live-raw-mid-document" as const,
      scenario: "raw-live-raw-mid-document" as const,
      runs: 30 as const,
      valuesPx: scrollResult.valuesPx,
      medianPx: scrollResult.medianPx,
      p99Px: scrollResult.p99Px,
      madPx: scrollResult.madPx,
      rawLineHeightPx: scrollResult.rawLineHeightPx,
      roundingMarginPx,
      regressionCeilingPx: scrollResult.p99Px + Math.max(roundingMarginPx, scrollResult.madPx),
      quarterLineSafetyPx: scrollResult.rawLineHeightPx / 4,
      knownIssues: ["ADL-022", "ADL-023"] as const,
      evidence: artifactReference(temporaryRoot, "scroll/scroll-characterization.json"),
      frames: {
        medianBefore: artifactReference(temporaryRoot, "scroll/median-before.png"),
        medianAfter: artifactReference(temporaryRoot, "scroll/median-after.png"),
        worstBefore: artifactReference(temporaryRoot, "scroll/worst-before.png"),
        worstAfter: artifactReference(temporaryRoot, "scroll/worst-after.png"),
      },
    };

    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "src", "manifest.json"), "utf8"));
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const artifactDirectory = path.join(temporaryRoot, "artifacts");
    fs.mkdirSync(artifactDirectory, { recursive: true });
    const jpl = copyIntoBundle(path.join(repoRoot, "publish", `${manifest.id}.jpl`), temporaryRoot, `artifacts/${manifest.id}.jpl`);
    const publishManifest = copyIntoBundle(path.join(repoRoot, "publish", `${manifest.id}.json`), temporaryRoot, `artifacts/${manifest.id}.json`);
    const pluginManifest = copyIntoBundle(path.join(repoRoot, "src", "manifest.json"), temporaryRoot, "metadata/plugin-manifest.json");
    const lockfile = copyIntoBundle(path.join(repoRoot, "package-lock.json"), temporaryRoot, "metadata/package-lock.json");
    const packResult = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", artifactDirectory]);
    commands.push(packResult.command);
    const packOutput = JSON.parse(packResult.stdout);
    const packDetails = Array.isArray(packOutput) ? packOutput[0] : Object.values(packOutput as Record<string, unknown>)[0];
    if (!packDetails || typeof (packDetails as { filename?: unknown }).filename !== "string") throw new Error("npm pack did not report its tarball filename");
    const npmTarball = artifactReference(temporaryRoot, `artifacts/${(packDetails as { filename: string }).filename}`);

    const testReportPath = path.join(temporaryRoot, "reports", "candidate-tests.json");
    const testScope = requireCanonical ? "release" as const : "candidate" as const;
    const stableCommands = commands.map(command => command.split(temporaryRoot).join("$BUNDLE"));
    writeJson(testReportPath, { schemaVersion: 1, scope: testScope, passed: true, commands: stableCommands });
    const draftReasons = [
      ...(!sourceClean ? ["Source working tree was not clean at generation time."] : []),
      ...(!canonicalEnvironment ? [`Environment is not ${CANONICAL_CONTAINER} with Playwright ${CANONICAL_PLAYWRIGHT_VERSION}.`] : []),
      ...(counts.total !== 0 ? [`Production audit contains ${counts.total} advisories.`] : []),
      ...(!requireCanonical ? ["Release verification was not requested; use the canonical Docker command for a finalizable bundle."] : []),
    ];

    const unsigned = {
      schemaVersion: 1 as const,
      kind: "BaselineCandidateBundle" as const,
      bundleDigest: "0".repeat(64),
      createdAt,
      source: { commit: sourceCommit, clean: sourceClean },
      package: { name: packageJson.name, version: packageJson.version },
      environment: {
        container,
        playwrightVersion: playwrightPackage.version,
        browser: "chromium" as const,
        os: osDescription(),
        architecture: os.arch(),
        nodeVersion: process.version,
        npmVersion: run("npm", ["--version"]).stdout.trim(),
        timezone: "America/Chicago" as const,
        locale: "en-US" as const,
        deviceScaleFactor: 1 as const,
        canonical: canonicalEnvironment,
      },
      lockfile,
      visuals: visualCandidates,
      scroll,
      audit: { report: artifactReference(temporaryRoot, "reports/production-audit.json"), counts },
      tests: { report: artifactReference(temporaryRoot, "reports/candidate-tests.json"), passed: true, scope: testScope },
      artifacts: { jpl, npmTarball, publishManifest, pluginManifest },
      finalizable: sourceClean && canonicalEnvironment && counts.total === 0 && testScope === "release",
      draftReasons,
    };
    const bundleDigest = computeBundleDigest(unsigned);
    const bundle = BaselineCandidateBundleV1Schema.parse({ ...unsigned, bundleDigest });
    writeJson(path.join(temporaryRoot, "manifest.json"), bundle);
    validateBundleDirectory(temporaryRoot, false);

    if (requireCanonical && !bundle.finalizable) throw new Error(`Canonical bundle requirements failed:\n- ${bundle.draftReasons.join("\n- ")}`);
    const finalDirectory = path.join(candidatesRoot, bundleDigest);
    if (fs.existsSync(finalDirectory)) {
      const existing = validateBundleDirectory(finalDirectory, true);
      if (existing.bundleDigest !== bundleDigest) throw new Error(`Conflicting candidate bundle already exists: ${finalDirectory}`);
      makeWritableRecursive(temporaryRoot);
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
      assertTrackedStateUnchanged(initialStatus);
      console.log(`[baseline:candidates] reused immutable bundle ${finalDirectory}`);
      return finalDirectory;
    }
    fs.renameSync(temporaryRoot, finalDirectory);
    validateBundleDirectory(finalDirectory, true);
    setBundleReadOnly(finalDirectory);

    assertTrackedStateUnchanged(initialStatus);
    console.log(`[baseline:candidates] ${bundle.finalizable ? "finalizable" : "draft-only"} bundle ${finalDirectory}`);
    for (const reason of bundle.draftReasons) console.log(`[baseline:candidates] draft reason: ${reason}`);
    return finalDirectory;
  } catch (error) {
    makeWritableRecursive(temporaryRoot);
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  generateCandidates().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
