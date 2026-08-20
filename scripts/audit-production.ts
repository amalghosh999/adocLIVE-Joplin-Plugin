import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ProductionAuditExceptionCatalogV1Schema,
  type ProductionAuditExceptionV1,
} from "../baseline/contracts.ts";

export type AuditMode = "pr" | "release" | "nightly";

export interface NpmAuditVia {
  source?: number;
  url?: string;
  severity?: string;
}

export interface NpmAuditVulnerability {
  name: string;
  severity: "info" | "low" | "moderate" | "high" | "critical";
  via: Array<string | NpmAuditVia>;
}

export interface NpmAuditReport {
  vulnerabilities: Record<string, NpmAuditVulnerability>;
  metadata: {
    vulnerabilities: Record<"info" | "low" | "moderate" | "high" | "critical" | "total", number>;
  };
}

export interface AuditPolicyResult {
  ok: boolean;
  mode: AuditMode;
  blockingPackages: string[];
  exceptedPackages: string[];
  messages: string[];
}

function advisoryId(via: NpmAuditVia): string | null {
  const match = via.url?.match(/GHSA-[a-z0-9-]+/i);
  return match?.[0].toUpperCase() || (typeof via.source === "number" ? String(via.source) : null);
}

export function advisoryIdsForPackage(
  report: NpmAuditReport,
  packageName: string,
  visited = new Set<string>(),
): Set<string> {
  if (visited.has(packageName)) return new Set();
  visited.add(packageName);
  const vulnerability = report.vulnerabilities[packageName];
  const ids = new Set<string>();
  for (const via of vulnerability?.via || []) {
    if (typeof via === "string") {
      for (const id of advisoryIdsForPackage(report, via, visited)) ids.add(id);
    } else {
      const id = advisoryId(via);
      if (id) ids.add(id);
    }
  }
  return ids;
}

function exceptionCovers(
  candidate: ProductionAuditExceptionV1,
  advisoryIds: Set<string>,
  now: Date,
): boolean {
  if (Date.parse(candidate.createdAt) > now.getTime() || Date.parse(candidate.expiresAt) <= now.getTime()) return false;
  return advisoryIds.size > 0 && [...advisoryIds].every(id => candidate.advisoryIds.map(value => value.toUpperCase()).includes(id.toUpperCase()));
}

export function evaluateAuditPolicy(
  report: NpmAuditReport,
  catalogInput: unknown,
  mode: AuditMode,
  now = new Date(),
): AuditPolicyResult {
  const catalog = ProductionAuditExceptionCatalogV1Schema.parse(catalogInput);
  if (mode === "nightly") return { ok: true, mode, blockingPackages: [], exceptedPackages: [], messages: [] };

  if (mode === "release") {
    const blockingPackages = Object.keys(report.vulnerabilities).sort();
    return {
      ok: report.metadata.vulnerabilities.total === 0,
      mode,
      blockingPackages,
      exceptedPackages: [],
      messages: blockingPackages.length ? ["Release audit requires zero production advisories; exceptions are ignored."] : [],
    };
  }

  const blockingPackages: string[] = [];
  const exceptedPackages: string[] = [];
  const messages: string[] = [];
  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities).sort(([left], [right]) => left.localeCompare(right))) {
    if (vulnerability.severity !== "high" && vulnerability.severity !== "critical") continue;
    if (vulnerability.severity === "critical") {
      blockingPackages.push(packageName);
      messages.push(`${packageName}: critical production advisories cannot be excepted.`);
      continue;
    }
    const ids = advisoryIdsForPackage(report, packageName);
    const exception = catalog.exceptions.find(candidate => exceptionCovers(candidate, ids, now));
    if (exception) exceptedPackages.push(packageName);
    else {
      blockingPackages.push(packageName);
      messages.push(`${packageName}: unexcepted high production advisory (${[...ids].sort().join(", ") || "no advisory id"}).`);
    }
  }
  return { ok: blockingPackages.length === 0, mode, blockingPackages, exceptedPackages, messages };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readAuditReport(repoRoot: string): NpmAuditReport {
  const input = argument("--input");
  if (input) return JSON.parse(fs.readFileSync(path.resolve(repoRoot, input), "utf8")) as NpmAuditReport;
  const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!audit.stdout.trim()) throw new Error(`npm audit produced no JSON: ${audit.stderr.trim()}`);
  return JSON.parse(audit.stdout) as NpmAuditReport;
}

export function runAuditCli(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..");
  const mode = (argument("--mode") || "pr") as AuditMode;
  if (!(["pr", "release", "nightly"] as string[]).includes(mode)) throw new Error(`Unknown audit mode: ${mode}`);
  const catalogPath = argument("--exceptions") || "security/production-audit-exceptions.json";
  const outputPath = argument("--output");
  const report = readAuditReport(repoRoot);
  const catalog = JSON.parse(fs.readFileSync(path.resolve(repoRoot, catalogPath), "utf8"));
  const now = new Date(process.env.ADOC_AUDIT_NOW || Date.now());
  const policy = evaluateAuditPolicy(report, catalog, mode, now);
  if (outputPath) {
    const resolved = path.resolve(repoRoot, outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`);
  }
  const counts = report.metadata.vulnerabilities;
  console.log(`[audit:prod:${mode}] info=${counts.info} low=${counts.low} moderate=${counts.moderate} high=${counts.high} critical=${counts.critical} total=${counts.total}`);
  for (const packageName of policy.exceptedPackages) console.log(`[audit:prod:${mode}] excepted high: ${packageName}`);
  for (const message of policy.messages) console.error(`[audit:prod:${mode}] ${message}`);
  if (!policy.ok) process.exitCode = 1;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) runAuditCli();
