import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_CONTAINER } from "./contracts.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command: string, args: string[], environment: NodeJS.ProcessEnv = {}): void {
  console.log(`[release:prepare] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: repoRoot, env: { ...process.env, ...environment }, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const pluginManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "src", "manifest.json"), "utf8"));
if (packageJson.version !== pluginManifest.version) throw new Error("package.json and Joplin manifest versions differ");
const sourceStatus = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: repoRoot, encoding: "utf8" });
if (sourceStatus.status !== 0) throw new Error(`Unable to inspect source state: ${sourceStatus.stderr.trim()}`);
if (sourceStatus.stdout.trim()) throw new Error("Release preparation requires the clean user-owned source commit");
run("node", ["scripts/audit-production.ts", "--mode", "release"]);
if (process.env.ADOC_CANONICAL_CONTAINER === CANONICAL_CONTAINER) run("node", ["baseline/generate-candidates.ts", "--canonical"]);
else run("node", ["baseline/docker-candidates.ts"]);
