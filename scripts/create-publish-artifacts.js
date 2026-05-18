const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const manifestPath = path.join(repoRoot, "src", "manifest.json");
const distDir = path.join(repoRoot, "dist");
const publishDir = path.join(repoRoot, "publish");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (!packageJson.name || !packageJson.name.startsWith("joplin-plugin-")) {
  throw new Error(`package.json name must start with joplin-plugin-: ${packageJson.name}`);
}

if (!packageJson.keywords || !packageJson.keywords.includes("joplin-plugin")) {
  throw new Error("package.json keywords must include joplin-plugin");
}

if (!manifest.id) {
  throw new Error("src/manifest.json must include an id");
}

if (manifest.version !== packageJson.version) {
  throw new Error(`Version mismatch: package.json ${packageJson.version}, manifest ${manifest.version}`);
}

if (!fs.existsSync(path.join(distDir, "manifest.json"))) {
  throw new Error("Missing dist/manifest.json. Run the bundle build before creating publish artifacts.");
}

const distManifest = JSON.parse(fs.readFileSync(path.join(distDir, "manifest.json"), "utf8"));
if (distManifest.id !== manifest.id || distManifest.version !== manifest.version) {
  throw new Error("dist/manifest.json is out of sync with src/manifest.json");
}

fs.rmSync(publishDir, { recursive: true, force: true });
fs.mkdirSync(publishDir, { recursive: true });

const archivePath = path.join(publishDir, `${manifest.id}.jpl`);
const topLevelEntries = fs.readdirSync(distDir).sort();
if (topLevelEntries.length === 0) {
  throw new Error("dist/ is empty");
}

const tar = spawnSync("tar", ["-czf", archivePath, "-C", distDir, ...topLevelEntries], {
  cwd: repoRoot,
  stdio: "inherit",
});
if (tar.status !== 0) {
  throw new Error(`tar failed with exit code ${tar.status}`);
}

const publishHash = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex")}`;
const headResult = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (headResult.status !== 0) {
  throw new Error(`git rev-parse HEAD failed: ${headResult.stderr}`);
}

const publishManifest = {
  ...manifest,
  _publish_hash: publishHash,
  _publish_commit: `master:${headResult.stdout.trim()}`,
};

const publishManifestPath = path.join(publishDir, `${manifest.id}.json`);
fs.writeFileSync(publishManifestPath, `${JSON.stringify(publishManifest, null, 2)}\n`);

console.log(`Created ${path.relative(repoRoot, archivePath)}`);
console.log(`Created ${path.relative(repoRoot, publishManifestPath)}`);
