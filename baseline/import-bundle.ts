import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeWritableRecursive, setBundleReadOnly, validateBundleDirectory } from "./node-utils.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function safeArchiveEntries(entries: string[]): void {
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/").replace(/\/$/, "");
    if (!normalized || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized) || /[\x00-\x1f\x7f]/.test(normalized)
      || normalized.split("/").some(segment => !segment || segment === "." || segment === "..")) {
      throw new Error(`Archive contains an unsafe path: ${entry}`);
    }
  }
}

function rejectNonRegularArchiveEntries(kind: "zip" | "tar", source: string, expectedCount: number): void {
  const listing = kind === "zip" ? run("unzip", ["-Z", "-l", source]) : run("tar", ["-tvzf", source]);
  const types = kind === "zip"
    ? listing.split("\n").flatMap(line => line.match(/^([dl-])[rwx-]{9}\s/)?.[1] || [])
    : listing.split("\n").filter(Boolean).map(line => line[0]);
  if (types.length !== expectedCount || types.some(type => type !== "-" && type !== "d")) {
    throw new Error("Candidate archives may contain only regular files and directories");
  }
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function locateBundle(extracted: string): string {
  if (fs.existsSync(path.join(extracted, "manifest.json"))) return extracted;
  const directories = fs.readdirSync(extracted, { withFileTypes: true }).filter(entry => entry.isDirectory());
  const candidates = directories.map(entry => path.join(extracted, entry.name)).filter(directory => fs.existsSync(path.join(directory, "manifest.json")));
  if (candidates.length !== 1) throw new Error("Imported artifact must contain exactly one candidate bundle");
  return candidates[0];
}

function extractArtifact(source: string, extractionRoot: string): string {
  if (fs.statSync(source).isDirectory()) return source;
  const lower = source.toLocaleLowerCase();
  if (lower.endsWith(".zip")) {
    const entries = run("unzip", ["-Z1", source]).split("\n").filter(Boolean);
    safeArchiveEntries(entries);
    rejectNonRegularArchiveEntries("zip", source, entries.length);
    run("unzip", ["-q", source, "-d", extractionRoot]);
    return locateBundle(extractionRoot);
  }
  if (lower.endsWith(".tgz") || lower.endsWith(".tar.gz")) {
    const entries = run("tar", ["-tzf", source]).split("\n").filter(Boolean);
    safeArchiveEntries(entries);
    rejectNonRegularArchiveEntries("tar", source, entries.length);
    run("tar", ["--no-same-owner", "--no-same-permissions", "-xzf", source, "-C", extractionRoot]);
    return locateBundle(extractionRoot);
  }
  throw new Error("Candidate import accepts a bundle directory, .zip, .tgz, or .tar.gz artifact");
}

export function importBundle(sourceInput: string, candidateRootInput = ".baseline-candidates"): string {
  const source = path.resolve(repoRoot, sourceInput);
  if (!fs.existsSync(source)) throw new Error(`Candidate artifact does not exist: ${source}`);
  const candidateRoot = path.resolve(repoRoot, candidateRootInput);
  const extractionParent = path.resolve(repoRoot, ".baseline-review-import");
  fs.mkdirSync(candidateRoot, { recursive: true });
  fs.mkdirSync(extractionParent, { recursive: true });
  const extractionRoot = fs.mkdtempSync(path.join(extractionParent, "extract-"));
  const copyContainer = fs.mkdtempSync(path.join(candidateRoot, ".import-"));
  const copyRoot = path.join(copyContainer, "bundle");
  try {
    const bundleSource = extractArtifact(source, extractionRoot);
    const manifest = validateBundleDirectory(bundleSource, false);
    fs.cpSync(bundleSource, copyRoot, { recursive: true, force: false, errorOnExist: true });
    validateBundleDirectory(copyRoot, false);
    const destination = path.join(candidateRoot, manifest.bundleDigest);
    if (fs.existsSync(destination)) {
      const existing = validateBundleDirectory(destination, true);
      if (existing.bundleDigest !== manifest.bundleDigest) throw new Error(`Conflicting bundle already exists: ${destination}`);
      makeWritableRecursive(copyContainer);
      fs.rmSync(copyContainer, { recursive: true, force: true });
      return destination;
    }
    fs.renameSync(copyRoot, destination);
    fs.rmSync(copyContainer, { recursive: true, force: true });
    validateBundleDirectory(destination, true);
    setBundleReadOnly(destination);
    return destination;
  } finally {
    makeWritableRecursive(extractionRoot);
    fs.rmSync(extractionRoot, { recursive: true, force: true });
    if (fs.existsSync(copyContainer)) {
      makeWritableRecursive(copyContainer);
      fs.rmSync(copyContainer, { recursive: true, force: true });
    }
  }
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const source = process.argv[2];
  if (!source) {
    console.error("Usage: npm run baseline:review:import -- <bundle-directory|artifact.zip|artifact.tgz>");
    process.exitCode = 2;
  } else {
    try { console.log(`[baseline:review:import] ${importBundle(source)}`); }
    catch (error) {
      console.error(error instanceof Error ? error.stack || error.message : String(error));
      process.exitCode = 1;
    }
  }
}
