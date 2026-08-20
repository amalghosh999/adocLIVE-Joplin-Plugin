import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_CONTAINER } from "./contracts.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockDigest = crypto.createHash("sha256").update(fs.readFileSync(path.join(repoRoot, "package-lock.json"))).digest("hex").slice(0, 16);
const nodeModulesVolume = `adoclive-baseline-${lockDigest}`;

function docker(args: string[]): void {
  console.log(`[baseline:candidates:docker] docker ${args.join(" ")}`);
  const result = spawnSync("docker", args, { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Docker exited with status ${result.status}`);
}

const mountArgs = [
  "--rm",
  "--workdir", "/work",
  "--volume", `${repoRoot}:/work`,
  "--volume", `${nodeModulesVolume}:/work/node_modules`,
  "--env", "CI=true",
  "--env", "TZ=America/Chicago",
  "--env", `ADOC_CANONICAL_CONTAINER=${CANONICAL_CONTAINER}`,
];

docker(["run", ...mountArgs, CANONICAL_CONTAINER, "npm", "ci"]);
docker([
  "run",
  ...mountArgs,
  "--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
  "--env", "npm_config_cache=/tmp/adoclive-npm-cache",
  CANONICAL_CONTAINER,
  "npm", "run", "baseline:candidates", "--", "--canonical",
]);
