import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BaselineCandidateBundleV1Schema,
  BaselineReviewReceiptV1Schema,
  VISUAL_CANDIDATE_IDS,
  type BaselineCandidateBundleV1,
  type BaselineReviewReceiptV1,
} from "./contracts.ts";
import {
  artifactHashRecord,
  canonicalJson,
  resolveBundlePath,
  sha256Bytes,
  sha256File,
  validateBundleDirectory,
} from "./node-utils.ts";

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(repoRoot: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export function validateReceiptAgainstBundle(
  receiptInput: unknown,
  bundle: BaselineCandidateBundleV1,
): BaselineReviewReceiptV1 {
  bundle = BaselineCandidateBundleV1Schema.parse(bundle);
  const receipt = BaselineReviewReceiptV1Schema.parse(receiptInput);
  if (receipt.bundleDigest !== bundle.bundleDigest) throw new Error("Receipt bundle digest does not match the candidate bundle");
  if (receipt.sourceCommit !== bundle.source.commit) throw new Error("Receipt source commit does not match the candidate bundle");
  if (bundle.audit.counts.total !== 0) throw new Error("Candidate bundle contains production advisories");
  if (!bundle.tests.passed) throw new Error("Candidate bundle test evidence did not pass");
  if (!bundle.finalizable || !bundle.environment.canonical || !bundle.source.clean) throw new Error("Receipt references a nonfinalizable candidate bundle");
  const expectedHashes = artifactHashRecord(bundle);
  if (JSON.stringify(Object.entries(receipt.artifactHashes).sort()) !== JSON.stringify(Object.entries(expectedHashes).sort())) {
    throw new Error("Receipt artifact hash inventory does not exactly match the candidate bundle");
  }
  if (Date.parse(receipt.reviewedAt) < Date.parse(bundle.createdAt)) throw new Error("Receipt predates candidate generation");
  return receipt;
}

function archiveCommand(archive: string, args: string[], encoding: BufferEncoding | null = "utf8"): string | Buffer {
  const result = spawnSync("tar", [...args, archive], {
    encoding,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Unable to inspect archive ${path.basename(archive)}: ${String(result.stderr).trim()}`);
  return result.stdout;
}

function safeArchivePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/$/, "");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized) || /[\x00-\x1f\x7f]/.test(normalized)) {
    throw new Error(`Archive contains an unsafe path: ${value}`);
  }
  if (normalized.split("/").some(segment => !segment || segment === "." || segment === "..")) {
    throw new Error(`Archive contains an unsafe path: ${value}`);
  }
  return normalized;
}

function tarInventory(archive: string): string[] {
  const names = String(archiveCommand(archive, ["-tzf"])).split("\n").filter(Boolean).map(safeArchivePath);
  if (new Set(names).size !== names.length) throw new Error(`Archive contains duplicate paths: ${path.basename(archive)}`);
  const verbose = String(archiveCommand(archive, ["-tvzf"])).split("\n").filter(Boolean);
  if (verbose.length !== names.length || verbose.some(line => line[0] !== "-" && line[0] !== "d")) {
    throw new Error(`Archive may contain only regular files and directories: ${path.basename(archive)}`);
  }
  return names.filter((_name, index) => verbose[index][0] === "-");
}

function readTarEntry(archive: string, entry: string): Buffer {
  const result = spawnSync("tar", ["-xOzf", archive, entry], { encoding: null, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Unable to read ${entry} from ${path.basename(archive)}: ${String(result.stderr).trim()}`);
  return Buffer.from(result.stdout);
}

function exactJsonWithout(value: Record<string, unknown>, omitted: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.includes(key)));
}

export function verifyReleaseMetadata(bundleRoot: string, bundle: BaselineCandidateBundleV1): void {
  const pluginManifest = JSON.parse(fs.readFileSync(resolveBundlePath(bundleRoot, bundle.artifacts.pluginManifest.path), "utf8"));
  const publishManifest = JSON.parse(fs.readFileSync(resolveBundlePath(bundleRoot, bundle.artifacts.publishManifest.path), "utf8"));
  if (pluginManifest.version !== bundle.package.version || publishManifest.version !== bundle.package.version) {
    throw new Error("Candidate package and Joplin manifest versions do not agree");
  }
  if (publishManifest._publish_hash !== `sha256:${bundle.artifacts.jpl.sha256}`) throw new Error("Publish manifest JPL hash does not match the candidate JPL");
  if (typeof publishManifest._publish_commit !== "string" || !publishManifest._publish_commit.endsWith(bundle.source.commit)) {
    throw new Error("Publish manifest source commit does not match the candidate source");
  }
  if (canonicalJson(pluginManifest) !== canonicalJson(exactJsonWithout(publishManifest, ["_publish_hash", "_publish_commit"]))) {
    throw new Error("Publish manifest plugin metadata does not exactly match the candidate plugin manifest");
  }

  const lockfile = JSON.parse(fs.readFileSync(resolveBundlePath(bundleRoot, bundle.lockfile.path), "utf8"));
  if (lockfile.name !== bundle.package.name || lockfile.version !== bundle.package.version
    || lockfile.packages?.[""]?.name !== bundle.package.name || lockfile.packages?.[""]?.version !== bundle.package.version) {
    throw new Error("Candidate lockfile root metadata does not match the package name and version");
  }

  const audit = JSON.parse(fs.readFileSync(resolveBundlePath(bundleRoot, bundle.audit.report.path), "utf8"));
  if (canonicalJson(audit.metadata?.vulnerabilities) !== canonicalJson(bundle.audit.counts)) {
    throw new Error("Candidate audit report counts do not match the bundle manifest");
  }
  if (audit.metadata?.vulnerabilities?.total !== 0) throw new Error("Candidate audit report is not zero-advisory");

  const testReport = JSON.parse(fs.readFileSync(resolveBundlePath(bundleRoot, bundle.tests.report.path), "utf8"));
  if (testReport.schemaVersion !== 1 || testReport.passed !== true || testReport.scope !== bundle.tests.scope
    || !Array.isArray(testReport.commands) || !testReport.commands.every((command: unknown) => typeof command === "string")) {
    throw new Error("Candidate test report does not agree with the bundle manifest");
  }
  for (const requiredPrefix of [
    "npm run dist",
    "node scripts/audit-production.ts --mode nightly --output ",
    "npx playwright test tests/browser/visual.spec.ts ",
    "npx playwright test tests/browser/scroll.spec.ts ",
    "npm pack --json --ignore-scripts --pack-destination ",
  ]) {
    if (!testReport.commands.some((command: string) => command.startsWith(requiredPrefix))) {
      throw new Error(`Candidate test report is missing ${requiredPrefix.trim()}`);
    }
  }
  if (bundle.tests.scope === "release") {
    for (const script of ["test:unit", "typecheck", "typecheck:lab", "test:joplin-sim", "test:browser", "test:a11y", "test:artifact-smoke"]) {
      if (!testReport.commands.includes(`npm run ${script}`)) throw new Error(`Candidate release test report is missing npm run ${script}`);
    }
  }

  const jplPath = resolveBundlePath(bundleRoot, bundle.artifacts.jpl.path);
  const jplInventory = tarInventory(jplPath);
  if (!jplInventory.includes("manifest.json")) throw new Error("Candidate JPL does not contain manifest.json");
  const archivedPluginManifest = JSON.parse(readTarEntry(jplPath, "manifest.json").toString("utf8"));
  if (canonicalJson(archivedPluginManifest) !== canonicalJson(pluginManifest)) {
    throw new Error("Candidate JPL manifest does not exactly match the candidate plugin manifest");
  }

  const npmTarballPath = resolveBundlePath(bundleRoot, bundle.artifacts.npmTarball.path);
  const expectedNpmFiles = [
    "package/LICENSE",
    "package/README.adoc",
    "package/package.json",
    `package/publish/${pluginManifest.id}.jpl`,
    `package/publish/${pluginManifest.id}.json`,
  ].sort();
  const npmInventory = tarInventory(npmTarballPath).sort();
  if (canonicalJson(npmInventory) !== canonicalJson(expectedNpmFiles)) {
    throw new Error(`Candidate npm tarball inventory does not match the release allowlist:\n${npmInventory.join("\n")}`);
  }
  const archivedPackage = JSON.parse(readTarEntry(npmTarballPath, "package/package.json").toString("utf8"));
  if (archivedPackage.name !== bundle.package.name || archivedPackage.version !== bundle.package.version
    || !Array.isArray(archivedPackage.keywords) || !archivedPackage.keywords.includes("joplin-plugin")
    || canonicalJson(archivedPackage.files) !== canonicalJson(["publish"])) {
    throw new Error("Candidate npm package metadata does not match the release contract");
  }
  if (sha256Bytes(readTarEntry(npmTarballPath, `package/publish/${pluginManifest.id}.jpl`)) !== bundle.artifacts.jpl.sha256) {
    throw new Error("Candidate npm tarball does not contain the exact reviewed JPL bytes");
  }
  if (sha256Bytes(readTarEntry(npmTarballPath, `package/publish/${pluginManifest.id}.json`)) !== bundle.artifacts.publishManifest.sha256) {
    throw new Error("Candidate npm tarball does not contain the exact reviewed publish-manifest bytes");
  }
}

function receiptEvidencePath(bundleDigest: string): string {
  return `docs/test-lab/evidence/baseline-reviews/${bundleDigest}.receipt.json`;
}

function baselineApprovalMarkdown(bundle: BaselineCandidateBundleV1, receipt: BaselineReviewReceiptV1, evidencePath: string): string {
  const scroll = bundle.scroll;
  return `# Baseline Approval Evidence

Status: visual and scroll baselines approved for adocLIVE ${bundle.package.version}

Canonical image: \`${bundle.environment.container}\`

Receipt: [${path.basename(evidencePath)}](baseline-reviews/${path.basename(evidencePath)})  
Reviewer: ${receipt.reviewer}  
Reviewed: ${receipt.reviewedAt}  
Bundle digest: \`${bundle.bundleDigest}\`  
Source commit: \`${bundle.source.commit}\`

- Visual baseline: all ${bundle.visuals.length} editor-only Linux/Chromium images were individually approved. No bulk decision was used.
- Scroll characterization: ${scroll.runs} repetitions; median ${scroll.medianPx} px, p99 ${scroll.p99Px} px, MAD ${scroll.madPx} px, raw line height ${scroll.rawLineHeightPx} px, regression ceiling ${scroll.regressionCeilingPx} px.
- The scroll ceiling protects characterized behavior only. ADL-022 quarter-line safety and ADL-023 bottom-clamp correctness remain desired-behavior expected failures and were explicitly acknowledged.
- Production audit: zero advisories at every severity.
- Performance baseline and headed dashboard inspection remain approved from the repository-owner review on 2026-08-20.

Overall rationale: ${receipt.overallRationale}
`;
}

function platformSection(evidence: BaselineReviewReceiptV1["platformEvidence"][number]): string {
  const label = evidence.platform === "windows" ? "Windows" : "macOS";
  return `### ${label}

- Joplin: ${evidence.joplinVersion}
- OS: ${evidence.osVersion}
- Date: ${evidence.date}
- Verifier: ${evidence.verifier}
- Result: pass
- Deviations: ${evidence.deviations}
- Hardened-JPL delta: install/startup, representative render, theme/view changes, hostile fixture, and upgrade all passed.
`;
}

function nativeMatrixMarkdown(bundle: BaselineCandidateBundleV1, receipt: BaselineReviewReceiptV1, evidencePath: string): string {
  const windows = receipt.platformEvidence.find(item => item.platform === "windows")!;
  const macos = receipt.platformEvidence.find(item => item.platform === "macos")!;
  return `# Native Joplin Verification Evidence

Status: Linux matrix retained; Windows and macOS hardened-JPL delta evidence approved for ${bundle.package.version}

Release candidate: manifest ${bundle.package.version}, JPL SHA-256 \`${bundle.artifacts.jpl.sha256}\`  
Receipt: [${path.basename(evidencePath)}](baseline-reviews/${path.basename(evidencePath)})

## Previously recorded Linux matrix

The repository owner approved the full Linux install, multi-window, lifecycle, view/theme, clipboard, media, hostile-fixture, upgrade, and closed-handle matrix on 2026-08-20 with no deviations reported. That performance/dashboard/Linux evidence is retained; the receipt below records the hardened 1.0.4 platform deltas.

## Applied 1.0.4 hardened-JPL platform evidence

${platformSection(windows)}
${platformSection(macos)}
`;
}

function desiredApplicationFiles(
  repoRoot: string,
  bundleRoot: string,
  bundle: BaselineCandidateBundleV1,
  receipt: BaselineReviewReceiptV1,
): Map<string, Buffer> {
  const evidencePath = receiptEvidencePath(bundle.bundleDigest);
  const files = new Map<string, Buffer>();
  for (const visual of bundle.visuals) {
    files.set(`tests/browser/baselines/visual/visual.spec.ts/${visual.id}.png`, fs.readFileSync(resolveBundlePath(bundleRoot, visual.candidate.path)));
  }
  const visualManifest = {
    schemaVersion: 1,
    browser: "chromium",
    platform: "linux",
    container: bundle.environment.container,
    approved: true,
    approvalEvidence: evidencePath,
    characterizedOn: receipt.reviewedAt.slice(0, 10),
    threshold: 0.2,
    maxDiffPixelRatio: 0.001,
    candidateHashes: Object.fromEntries(bundle.visuals.map(visual => [`${visual.id}.png`, visual.candidate.sha256])),
  };
  files.set("tests/browser/baselines/visual/baseline.json", Buffer.from(`${JSON.stringify(visualManifest, null, 2)}\n`));
  const scrollManifest = {
    schemaVersion: 1,
    browser: "chromium",
    platform: "linux",
    container: bundle.environment.container,
    approved: true,
    approvalEvidence: evidencePath,
    characterizedOn: receipt.reviewedAt.slice(0, 10),
    scenarios: {
      [bundle.scroll.scenario]: {
        runs: bundle.scroll.runs,
        valuesPx: bundle.scroll.valuesPx,
        medianPx: bundle.scroll.medianPx,
        p99Px: bundle.scroll.p99Px,
        madPx: bundle.scroll.madPx,
        rawLineHeightPx: bundle.scroll.rawLineHeightPx,
        roundingMarginPx: bundle.scroll.roundingMarginPx,
        maxDisplacementPx: bundle.scroll.regressionCeilingPx,
        quarterLineSafetyPx: bundle.scroll.quarterLineSafetyPx,
        knownIssue: "ADL-022",
        bottomClampKnownIssue: "ADL-023",
      },
    },
  };
  files.set("tests/browser/baselines/scroll/scroll-bounds.json", Buffer.from(`${JSON.stringify(scrollManifest, null, 2)}\n`));
  files.set(evidencePath, Buffer.from(`${JSON.stringify(JSON.parse(canonicalJson(receipt)), null, 2)}\n`));
  files.set("docs/test-lab/evidence/BASELINE_APPROVAL.md", Buffer.from(baselineApprovalMarkdown(bundle, receipt, evidencePath)));
  files.set("docs/test-lab/evidence/NATIVE_JOPLIN_MATRIX.md", Buffer.from(nativeMatrixMarkdown(bundle, receipt, evidencePath)));
  return files;
}

function assertSafeTarget(repoRoot: string, relativePath: string): string {
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, ...relativePath.split("/"));
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Application target escaped repository: ${relativePath}`);
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Application target has a symlink component: ${relativePath}`);
    }
  }
  return target;
}

function appliedStateMatches(repoRoot: string, desired: Map<string, Buffer>): boolean {
  return [...desired].every(([relativePath, content]) => {
    const target = assertSafeTarget(repoRoot, relativePath);
    return fs.existsSync(target) && fs.readFileSync(target).equals(content);
  });
}

export function validateSourcePreconditions(
  repoRoot: string,
  receipt: BaselineReviewReceiptV1,
  bundle: BaselineCandidateBundleV1,
): void {
  const head = git(repoRoot, "rev-parse", "HEAD");
  if (head !== receipt.sourceCommit) throw new Error(`Stale receipt: current HEAD ${head} does not equal source ${receipt.sourceCommit}`);
  const status = git(repoRoot, "status", "--porcelain=v1", "--untracked-files=all");
  if (status) throw new Error("Baseline application requires a clean working tree");
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "src", "manifest.json"), "utf8"));
  if (packageJson.version !== bundle.package.version || sourceManifest.version !== bundle.package.version) throw new Error("Current source version metadata does not match the reviewed bundle");
  if (sha256File(path.join(repoRoot, "package-lock.json")) !== bundle.lockfile.sha256) {
    throw new Error("Current source lockfile does not match the reviewed bundle");
  }
  if (sha256File(path.join(repoRoot, "src", "manifest.json")) !== bundle.artifacts.pluginManifest.sha256) {
    throw new Error("Current Joplin manifest bytes do not match the reviewed bundle");
  }
}

export function applyReceipt(
  receiptPathInput: string,
  options: { repoRoot?: string; candidateRoot?: string } = {},
): { idempotent: boolean; evidencePath: string } {
  const repoRoot = path.resolve(options.repoRoot || defaultRepoRoot);
  const receiptPath = path.resolve(repoRoot, receiptPathInput);
  const receiptInput = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  const parsedReceipt = BaselineReviewReceiptV1Schema.parse(receiptInput);
  const candidateRoot = path.resolve(repoRoot, options.candidateRoot || ".baseline-candidates");
  const bundleRoot = path.join(candidateRoot, parsedReceipt.bundleDigest);
  const bundle = validateBundleDirectory(bundleRoot, true);
  const receipt = validateReceiptAgainstBundle(receiptInput, bundle);
  verifyReleaseMetadata(bundleRoot, bundle);
  const desired = desiredApplicationFiles(repoRoot, bundleRoot, bundle, receipt);
  for (const relativePath of desired.keys()) assertSafeTarget(repoRoot, relativePath);
  const evidencePath = receiptEvidencePath(bundle.bundleDigest);
  const evidenceTarget = assertSafeTarget(repoRoot, evidencePath);

  if (fs.existsSync(evidenceTarget)) {
    const existing = BaselineReviewReceiptV1Schema.parse(JSON.parse(fs.readFileSync(evidenceTarget, "utf8")));
    if (canonicalJson(existing) !== canonicalJson(receipt)) throw new Error("A conflicting receipt is already applied for this bundle digest");
    if (!appliedStateMatches(repoRoot, desired)) throw new Error("Applied receipt exists but promoted baseline or native evidence conflicts");
    return { idempotent: true, evidencePath };
  }

  validateSourcePreconditions(repoRoot, receipt, bundle);

  const backups = new Map<string, Buffer | null>();
  try {
    for (const [relativePath, content] of desired) {
      const target = assertSafeTarget(repoRoot, relativePath);
      backups.set(target, fs.existsSync(target) ? fs.readFileSync(target) : null);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    if (!appliedStateMatches(repoRoot, desired)) throw new Error("Baseline application verification failed after writing evidence");
  } catch (error) {
    for (const [target, previous] of [...backups].reverse()) {
      if (previous === null) fs.rmSync(target, { force: true });
      else fs.writeFileSync(target, previous);
    }
    throw error;
  }
  return { idempotent: false, evidencePath };
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const receiptPath = process.argv[2];
  if (!receiptPath) {
    console.error("Usage: npm run baseline:apply -- <receipt.json>");
    process.exitCode = 2;
  } else {
    try {
      const result = applyReceipt(receiptPath);
      console.log(`[baseline:apply] ${result.idempotent ? "validated existing application" : "applied approved evidence"}`);
      console.log(`[baseline:apply] ${result.evidencePath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.stack || error.message : String(error));
      process.exitCode = 1;
    }
  }
}
