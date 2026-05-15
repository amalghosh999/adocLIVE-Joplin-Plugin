const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const artifact = path.join(repoRoot, "com.asciidoc.joplin-plugin.jpl");
const pluginId = "com.asciidoc.joplin-plugin";
const profiles = [
  path.join(os.homedir(), ".config", "joplindev-desktop"),
  path.join(os.homedir(), ".config", "joplin-desktop"),
];

if (!fs.existsSync(artifact)) {
  throw new Error(`Missing built plugin artifact: ${artifact}`);
}

const existingProfiles = profiles.filter((profile) => fs.existsSync(profile));
if (existingProfiles.length === 0) {
  throw new Error(`No Joplin desktop profile directories found under ${path.join(os.homedir(), ".config")}`);
}

for (const profile of existingProfiles) {
  const pluginsDir = path.join(profile, "plugins");
  const cacheDir = path.join(profile, "cache", pluginId);
  const target = path.join(pluginsDir, path.basename(artifact));

  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.copyFileSync(artifact, target);
  fs.rmSync(cacheDir, { recursive: true, force: true });

  console.log(`Deployed adocLIVE to ${target}`);
  console.log(`Cleared plugin cache at ${cacheDir}`);
}
