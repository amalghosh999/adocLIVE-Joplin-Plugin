import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { unzipSync } from "fflate";
import { makeWritableRecursive, setBundleReadOnly, validateBundleDirectory } from "./node-utils.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_ZIP_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10_000;

interface ZipEntry {
  name: string;
  normalizedName: string;
  directory: boolean;
  uncompressedBytes: number;
}

function safeArchiveEntries(entries: string[]): void {
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/").replace(/\/$/, "");
    if (!normalized || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized) || /[\x00-\x1f\x7f]/.test(normalized)
      || normalized.split("/").some(segment => !segment || segment === "." || segment === "..")) {
      throw new Error(`Archive contains an unsafe path: ${entry}`);
    }
  }
}

function rejectNonRegularTarEntries(source: string, expectedCount: number): void {
  const listing = run("tar", ["-tvzf", source]);
  const types = listing.split("\n").filter(Boolean).map(line => line[0]);
  if (types.length !== expectedCount || types.some(type => type !== "-" && type !== "d")) {
    throw new Error("Candidate archives may contain only regular files and directories");
  }
}

function zipEndOfCentralDirectory(bytes: Buffer): number {
  if (bytes.length < 22) throw new Error("Candidate ZIP is truncated");
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let cursor = bytes.length - 22; cursor >= minimum; cursor -= 1) {
    if (bytes.readUInt32LE(cursor) !== 0x06054b50) continue;
    const commentBytes = bytes.readUInt16LE(cursor + 20);
    if (cursor + 22 + commentBytes === bytes.length) return cursor;
  }
  throw new Error("Candidate ZIP has no valid end-of-central-directory record");
}

function decodeZipName(bytes: Buffer, utf8: boolean): string {
  if (!utf8 && bytes.some(byte => byte >= 0x80)) {
    throw new Error("Candidate ZIP uses an unsupported legacy filename encoding");
  }
  try {
    return utf8 ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : bytes.toString("ascii");
  } catch {
    throw new Error("Candidate ZIP contains an invalid UTF-8 filename");
  }
}

function inspectZip(bytes: Buffer): ZipEntry[] {
  const end = zipEndOfCentralDirectory(bytes);
  const disk = bytes.readUInt16LE(end + 4);
  const centralDisk = bytes.readUInt16LE(end + 6);
  const entriesOnDisk = bytes.readUInt16LE(end + 8);
  const entryCount = bytes.readUInt16LE(end + 10);
  const centralBytes = bytes.readUInt32LE(end + 12);
  const centralOffset = bytes.readUInt32LE(end + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error("Candidate ZIP may not span multiple disks");
  }
  if (entryCount === 0xffff || centralBytes === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 candidate artifacts are not supported");
  }
  if (entryCount === 0 || entryCount > MAX_ZIP_ENTRIES || centralOffset + centralBytes > end) {
    throw new Error("Candidate ZIP central directory is invalid");
  }

  const entries: ZipEntry[] = [];
  const normalizedKinds = new Map<string, boolean>();
  let expandedBytes = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Candidate ZIP central directory is malformed");
    }
    const madeBy = bytes.readUInt16LE(cursor + 4);
    const flags = bytes.readUInt16LE(cursor + 8);
    const compression = bytes.readUInt16LE(cursor + 10);
    const compressedBytes = bytes.readUInt32LE(cursor + 20);
    const uncompressedBytes = bytes.readUInt32LE(cursor + 24);
    const nameBytes = bytes.readUInt16LE(cursor + 28);
    const extraBytes = bytes.readUInt16LE(cursor + 30);
    const commentBytes = bytes.readUInt16LE(cursor + 32);
    const startDisk = bytes.readUInt16LE(cursor + 34);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameBytes + extraBytes + commentBytes;
    if (next > end || startDisk !== 0 || localOffset === 0xffffffff
      || compressedBytes === 0xffffffff || uncompressedBytes === 0xffffffff) {
      throw new Error("Candidate ZIP entry metadata is invalid or requires ZIP64");
    }
    if ((flags & 0x1) !== 0) throw new Error("Encrypted candidate ZIP entries are not supported");
    if (compression !== 0 && compression !== 8) throw new Error(`Unsupported candidate ZIP compression method: ${compression}`);

    const name = decodeZipName(bytes.subarray(cursor + 46, cursor + 46 + nameBytes), (flags & 0x800) !== 0);
    safeArchiveEntries([name]);
    const normalizedName = name.replace(/\\/g, "/").replace(/\/$/, "");
    const unixPlatform = (madeBy >>> 8) === 3 || (madeBy >>> 8) === 19;
    const unixType = unixPlatform ? ((externalAttributes >>> 16) & 0xf000) : 0;
    if (unixType !== 0 && unixType !== 0x4000 && unixType !== 0x8000) {
      throw new Error("Candidate archives may contain only regular files and directories");
    }
    const directory = name.endsWith("/") || unixType === 0x4000 || (externalAttributes & 0x10) !== 0;
    if ((directory && unixType === 0x8000) || (directory && uncompressedBytes !== 0)) {
      throw new Error("Candidate ZIP entry type metadata is inconsistent");
    }
    if (normalizedKinds.has(normalizedName)) throw new Error(`Candidate ZIP contains a duplicate path: ${name}`);
    normalizedKinds.set(normalizedName, directory);
    expandedBytes += uncompressedBytes;
    if (expandedBytes > MAX_ZIP_EXPANDED_BYTES) throw new Error("Candidate ZIP expands beyond the supported size limit");
    entries.push({ name, normalizedName, directory, uncompressedBytes });
    cursor = next;
  }
  if (cursor !== centralOffset + centralBytes) throw new Error("Candidate ZIP central directory length is inconsistent");

  for (const entry of entries) {
    const segments = entry.normalizedName.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      const ancestor = segments.slice(0, length).join("/");
      if (normalizedKinds.get(ancestor) === false) throw new Error(`Candidate ZIP path collides with a file: ${entry.name}`);
    }
  }
  return entries;
}

function extractZip(source: string, extractionRoot: string): string {
  const size = fs.statSync(source).size;
  if (size > MAX_ZIP_BYTES) throw new Error("Candidate ZIP exceeds the supported size limit");
  const bytes = fs.readFileSync(source);
  const entries = inspectZip(bytes);
  let expanded: Record<string, Uint8Array>;
  try {
    expanded = unzipSync(bytes);
  } catch (error) {
    throw new Error(`Candidate ZIP decompression failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const expectedNames = new Set(entries.map(entry => entry.name));
  if (Object.keys(expanded).some(name => !expectedNames.has(name))) throw new Error("Candidate ZIP entry inventory changed during decompression");
  for (const entry of entries) {
    const target = path.resolve(extractionRoot, ...entry.normalizedName.split("/"));
    if (!target.startsWith(`${path.resolve(extractionRoot)}${path.sep}`)) throw new Error(`Archive contains an unsafe path: ${entry.name}`);
    if (entry.directory) {
      fs.mkdirSync(target, { recursive: true, mode: 0o755 });
      continue;
    }
    const contents = expanded[entry.name];
    if (!contents || contents.byteLength !== entry.uncompressedBytes) throw new Error(`Candidate ZIP entry size mismatch: ${entry.name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    fs.writeFileSync(target, contents, { flag: "wx", mode: 0o644 });
  }
  return locateBundle(extractionRoot);
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
  if (lower.endsWith(".zip")) return extractZip(source, extractionRoot);
  if (lower.endsWith(".tgz") || lower.endsWith(".tar.gz")) {
    const entries = run("tar", ["-tzf", source]).split("\n").filter(Boolean);
    safeArchiveEntries(entries);
    rejectNonRegularTarEntries(source, entries.length);
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
