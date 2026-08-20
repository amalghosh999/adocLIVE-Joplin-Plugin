import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProductionAuditExceptionCatalogV1Schema } from "../../baseline/contracts";
import { evaluateAuditPolicy, type NpmAuditReport } from "../../scripts/audit-production";

const fixtures = path.resolve(__dirname, "fixtures");
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(fixtures, name), "utf8")) as NpmAuditReport;
const now = new Date("2026-08-20T12:00:00.000Z");

function exception(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    severity: "high",
    owner: "Security owner",
    rationale: "Upstream compatible resolution is pending.",
    compensatingControls: "Untrusted input is rejected before this package.",
    advisoryIds: ["GHSA-aaaa-bbbb-cccc"],
    createdAt: "2026-08-01T12:00:00.000Z",
    expiresAt: "2026-08-30T12:00:00.000Z",
    ...overrides,
  };
}

describe("production audit policy", () => {
  it("passes a zero-advisory report in PR and release modes", () => {
    const catalog = { schemaVersion: 1, exceptions: [] };
    expect(evaluateAuditPolicy(load("audit-zero.json"), catalog, "pr", now).ok).toBe(true);
    expect(evaluateAuditPolicy(load("audit-zero.json"), catalog, "release", now).ok).toBe(true);
  });

  it("blocks unexcepted high findings and accepts a current exact exception only in PR mode", () => {
    const report = load("audit-high.json");
    expect(evaluateAuditPolicy(report, { schemaVersion: 1, exceptions: [] }, "pr", now).ok).toBe(false);
    const catalog = { schemaVersion: 1, exceptions: [exception()] };
    expect(evaluateAuditPolicy(report, catalog, "pr", now)).toMatchObject({ ok: true, exceptedPackages: ["transitive-package"] });
    expect(evaluateAuditPolicy(report, catalog, "release", now).ok).toBe(false);
  });

  it("rejects critical exceptions, expired exceptions, and exception windows over 30 days", () => {
    const critical = exception({ severity: "critical" });
    expect(() => ProductionAuditExceptionCatalogV1Schema.parse({ schemaVersion: 1, exceptions: [critical] })).toThrow();
    expect(evaluateAuditPolicy(load("audit-high.json"), { schemaVersion: 1, exceptions: [exception({ expiresAt: "2026-08-19T12:00:00.000Z" })] }, "pr", now).ok).toBe(false);
    expect(() => ProductionAuditExceptionCatalogV1Schema.parse({ schemaVersion: 1, exceptions: [exception({ expiresAt: "2026-09-01T12:00:01.000Z" })] })).toThrow();
    expect(evaluateAuditPolicy(load("audit-high.json"), { schemaVersion: 1, exceptions: [exception({ createdAt: "2026-08-21T12:00:00.000Z", expiresAt: "2026-08-30T12:00:00.000Z" })] }, "pr", now).ok).toBe(false);
  });

  it("always blocks critical production findings in PR mode", () => {
    expect(evaluateAuditPolicy(load("audit-critical.json"), { schemaVersion: 1, exceptions: [] }, "pr", now).ok).toBe(false);
  });

  it("rejects unknown exception catalog versions", () => {
    expect(() => evaluateAuditPolicy(load("audit-zero.json"), { schemaVersion: 2, exceptions: [] }, "pr", now)).toThrow();
  });
});
