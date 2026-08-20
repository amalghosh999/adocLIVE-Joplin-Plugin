import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ArtifactReferenceV1Schema,
  BaselineCandidateBundleV1Schema,
  type ArtifactReferenceV1,
  type BaselineCandidateBundleV1,
} from "./contracts.ts";

const ZERO_DIGEST = "0".repeat(64);

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Bytes(value: Buffer | string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256File(file: string): string {
  return sha256Bytes(fs.readFileSync(file));
}

export function computeBundleDigest(bundle: BaselineCandidateBundleV1 | Record<string, unknown>): string {
  return sha256Bytes(canonicalJson({ ...bundle, bundleDigest: ZERO_DIGEST }));
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function copyIntoBundle(source: string, bundleRoot: string, relativePath: string): ArtifactReferenceV1 {
  const destination = resolveBundlePath(bundleRoot, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return artifactReference(bundleRoot, relativePath);
}

export function artifactReference(bundleRoot: string, relativePath: string): ArtifactReferenceV1 {
  const parsedPath = ArtifactReferenceV1Schema.shape.path.parse(relativePath);
  const file = resolveBundlePath(bundleRoot, parsedPath);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Bundle artifact is not a regular file: ${relativePath}`);
  return { path: parsedPath, sha256: sha256File(file), bytes: stat.size };
}

export function resolveBundlePath(bundleRoot: string, relativePath: string): string {
  const parsed = ArtifactReferenceV1Schema.shape.path.parse(relativePath);
  const root = path.resolve(bundleRoot);
  const resolved = path.resolve(root, ...parsed.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Artifact escaped bundle: ${relativePath}`);
  return resolved;
}

export function artifactReferences(bundle: BaselineCandidateBundleV1): ArtifactReferenceV1[] {
  const references: ArtifactReferenceV1[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const parsed = ArtifactReferenceV1Schema.safeParse(value);
    if (parsed.success) {
      references.push(parsed.data);
      return;
    }
    Object.values(value as Record<string, unknown>).forEach(visit);
  };
  visit(bundle);
  return references;
}

export function artifactHashRecord(bundle: BaselineCandidateBundleV1): Record<string, string> {
  return Object.fromEntries(artifactReferences(bundle)
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(reference => [reference.path, reference.sha256]));
}

function filesBeneath(root: string, current = root): string[] {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Candidate bundles may not contain symlinks: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) return filesBeneath(root, absolute);
    if (!entry.isFile()) throw new Error(`Candidate bundle contains a non-file: ${path.relative(root, absolute)}`);
    return [path.relative(root, absolute).split(path.sep).join("/")];
  });
}

export function validateBundleDirectory(bundleRoot: string, requireDigestName = true): BaselineCandidateBundleV1 {
  const resolvedRoot = path.resolve(bundleRoot);
  const rootStat = fs.lstatSync(resolvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Candidate bundle root must be a real directory");
  const manifestPath = path.join(resolvedRoot, "manifest.json");
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("Candidate bundle manifest must be a regular file");
  const manifest = BaselineCandidateBundleV1Schema.parse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  const computed = computeBundleDigest(manifest);
  if (computed !== manifest.bundleDigest) throw new Error(`Bundle digest mismatch: expected ${manifest.bundleDigest}, computed ${computed}`);
  if (requireDigestName && path.basename(resolvedRoot) !== manifest.bundleDigest) throw new Error("Candidate directory name does not match its bundle digest");

  const references = artifactReferences(manifest);
  const paths = references.map(reference => reference.path);
  if (new Set(paths).size !== paths.length) throw new Error("Bundle manifest references an artifact more than once");
  for (const reference of references) {
    const file = resolveBundlePath(resolvedRoot, reference.path);
    if (!fs.existsSync(file)) throw new Error(`Missing bundle artifact: ${reference.path}`);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Invalid bundle artifact: ${reference.path}`);
    if (stat.size !== reference.bytes) throw new Error(`Bundle artifact size mismatch: ${reference.path}`);
    if (sha256File(file) !== reference.sha256) throw new Error(`Bundle artifact hash mismatch: ${reference.path}`);
  }
  const actualFiles = filesBeneath(resolvedRoot).filter(file => file !== "manifest.json").sort();
  const expectedFiles = [...paths].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`Bundle file inventory mismatch; expected ${expectedFiles.length}, found ${actualFiles.length}`);
  }
  return manifest;
}

export function setBundleReadOnly(bundleRoot: string): void {
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(target);
        fs.chmodSync(target, 0o555);
      } else fs.chmodSync(target, 0o444);
    }
  };
  walk(bundleRoot);
  fs.chmodSync(bundleRoot, 0o555);
}

export function makeWritableRecursive(target: string): void {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isDirectory()) {
    fs.chmodSync(target, 0o755);
    for (const entry of fs.readdirSync(target)) makeWritableRecursive(path.join(target, entry));
  } else fs.chmodSync(target, 0o644);
}
