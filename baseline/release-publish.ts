import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BaselineReviewReceiptV1Schema, VISUAL_CANDIDATE_IDS } from "./contracts.ts";
import { validateReceiptAgainstBundle, verifyReleaseMetadata } from "./apply-receipt.ts";
import { canonicalJson, resolveBundlePath, validateBundleDirectory } from "./node-utils.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(command: string, args: string[], options: { allowFailure?: boolean; environment?: NodeJS.ProcessEnv } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...options.environment },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!options.allowFailure && result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return result;
}

function git(...args: string[]): string {
  return run("git", args).stdout.trim();
}

function gitIn(workingRoot: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd: workingRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export function isAllowedEvidencePath(file: string): boolean {
  if (file === "tests/browser/baselines/visual/baseline.json"
    || file === "tests/browser/baselines/scroll/scroll-bounds.json"
    || file === "docs/test-lab/evidence/BASELINE_APPROVAL.md"
    || file === "docs/test-lab/evidence/NATIVE_JOPLIN_MATRIX.md"
    || /^docs\/test-lab\/evidence\/baseline-reviews\/[a-f0-9]{64}\.receipt\.json$/.test(file)) return true;
  const visual = file.match(/^tests\/browser\/baselines\/visual\/visual\.spec\.ts\/([a-z0-9-]+)\.png$/)?.[1];
  return Boolean(visual && (VISUAL_CANDIDATE_IDS as readonly string[]).includes(visual));
}

export function validateEvidenceDiff(
  sourceCommit: string,
  head: string,
  workingRoot = repoRoot,
  requiredPaths: string[] = [],
): string[] {
  const count = Number(gitIn(workingRoot, "rev-list", "--count", `${sourceCommit}..${head}`));
  if (count !== 1) throw new Error(`Release handoff requires exactly one evidence-only commit after the source commit; found ${count}`);
  const files = gitIn(workingRoot, "diff", "--name-only", `${sourceCommit}..${head}`).split("\n").filter(Boolean);
  const allowed = files.every(isAllowedEvidencePath);
  if (!allowed || files.length === 0) throw new Error(`Source-to-evidence diff contains a non-allowlisted path:\n${files.join("\n")}`);
  const missing = requiredPaths.filter(file => !files.includes(file));
  if (missing.length) throw new Error(`Evidence commit is missing required applied records:\n${missing.join("\n")}`);
  return files;
}

function assertPackageVersionAvailable(packageName: string, version: string, npmUser: string): void {
  const view = run("npm", ["view", packageName, "versions", "--json"], { allowFailure: true });
  if (view.status === 0) {
    const parsed = JSON.parse(view.stdout || "[]");
    const versions = Array.isArray(parsed) ? parsed : [parsed];
    if (versions.includes(version)) throw new Error(`${packageName}@${version} is already published`);
    const owners = run("npm", ["owner", "ls", packageName], { allowFailure: true });
    if (owners.status !== 0 || !owners.stdout.split("\n").some(line => line.trim().startsWith(`${npmUser} `) || line.trim() === npmUser)) {
      throw new Error(`Authenticated npm user ${npmUser} is not an owner of existing package ${packageName}`);
    }
  } else if (!`${view.stdout}${view.stderr}`.includes("E404")) {
    throw new Error(`Unable to verify npm package-name availability: ${view.stderr.trim()}`);
  }
}

export function publishRelease(): void {
  const bundleInput = argument("--bundle");
  const receiptInput = argument("--receipt");
  const confirmedVersion = argument("--confirm");
  const dryRun = process.argv.includes("--dry-run");
  if (!bundleInput || !receiptInput || !confirmedVersion) {
    throw new Error("Usage: npm run release:publish -- --bundle <dir> --receipt <file> --confirm <version> [--dry-run]");
  }
  const bundleRoot = path.resolve(repoRoot, bundleInput);
  const bundle = validateBundleDirectory(bundleRoot, true);
  const receipt = validateReceiptAgainstBundle(JSON.parse(fs.readFileSync(path.resolve(repoRoot, receiptInput), "utf8")), bundle);
  verifyReleaseMetadata(bundleRoot, bundle);
  if (bundle.package.version !== confirmedVersion) throw new Error(`Confirmation ${confirmedVersion} does not match bundle ${bundle.package.version}`);
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const pluginManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "src", "manifest.json"), "utf8"));
  if (packageJson.version !== confirmedVersion || pluginManifest.version !== confirmedVersion) throw new Error("Current release metadata does not match the confirmed version");
  if (git("status", "--porcelain=v1", "--untracked-files=all")) throw new Error("Release publication requires a clean evidence commit");
  const head = git("rev-parse", "HEAD");
  const evidenceReceipt = path.join(repoRoot, "docs", "test-lab", "evidence", "baseline-reviews", `${bundle.bundleDigest}.receipt.json`);
  validateEvidenceDiff(receipt.sourceCommit, head, repoRoot, [
    "tests/browser/baselines/visual/baseline.json",
    "tests/browser/baselines/scroll/scroll-bounds.json",
    "docs/test-lab/evidence/BASELINE_APPROVAL.md",
    "docs/test-lab/evidence/NATIVE_JOPLIN_MATRIX.md",
    path.relative(repoRoot, evidenceReceipt).split(path.sep).join("/"),
  ]);
  const applied = BaselineReviewReceiptV1Schema.parse(JSON.parse(fs.readFileSync(evidenceReceipt, "utf8")));
  if (canonicalJson(applied) !== canonicalJson(receipt)) throw new Error("Publication receipt is not the exact applied evidence receipt");

  run("node", ["scripts/audit-production.ts", "--mode", "release"]);
  const branch = git("branch", "--show-current");
  if (!(["master", "main"] as string[]).includes(branch)) throw new Error(`Release publication requires master or main, not ${branch}`);
  const tag = `v${confirmedVersion}`;
  if (git("tag", "--list", tag)) throw new Error(`Local tag already exists: ${tag}`);
  if (run("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], { allowFailure: true }).status === 0) throw new Error(`Remote tag already exists: ${tag}`);
  run("gh", ["auth", "status"]);
  const npmUser = run("npm", ["whoami"]).stdout.trim();
  if (!npmUser) throw new Error("npm whoami returned no authenticated account");
  assertPackageVersionAvailable(bundle.package.name, confirmedVersion, npmUser);

  const tarball = resolveBundlePath(bundleRoot, bundle.artifacts.npmTarball.path);
  const jpl = resolveBundlePath(bundleRoot, bundle.artifacts.jpl.path);
  if (dryRun) {
    run("npm", ["publish", tarball, "--dry-run", "--ignore-scripts"], { environment: { ADOC_RELEASE_PUBLISH: "1" } });
    console.log(`[release:publish] dry run passed for ${bundle.package.name}@${confirmedVersion}; no tag, push, release, or publication was performed`);
    return;
  }

  run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
  run("git", ["push", "origin", branch]);
  run("git", ["push", "origin", tag]);
  run("gh", ["release", "create", tag, jpl, "--title", tag, "--notes", `Release ${tag}`, "--latest"]);
  run("npm", ["publish", tarball, "--access", "public"], { environment: { ADOC_RELEASE_PUBLISH: "1" } });
  console.log(`[release:publish] published exact stored artifacts for ${bundle.package.name}@${confirmedVersion}`);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try { publishRelease(); }
  catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  }
}
