import { describe, expect, it } from "vitest";
import {
  BaselineReviewDraftV1Schema,
  NativePlatformEvidenceV1Schema,
  REVIEW_ITEM_IDS,
  migrateDraftNotesToBundle,
  parseKnownBaselineContract,
} from "../../baseline/contracts";

const digest = "a".repeat(64);

function draft() {
  return BaselineReviewDraftV1Schema.parse({
    schemaVersion: 1,
    kind: "BaselineReviewDraft",
    bundleDigest: digest,
    updatedAt: "2026-08-20T12:00:00.000Z",
    reviewer: "Reviewer",
    decisions: REVIEW_ITEM_IDS.map((itemId, index) => ({ itemId, decision: index ? "approved" : "rejected", note: `note:${itemId}` })),
    knownIssueAcknowledgements: { "ADL-022": true, "ADL-023": true },
    platformEvidence: ["windows", "macos"].map(platform => ({
      platform,
      joplinVersion: "3.4.12",
      osVersion: "test",
      date: "2026-08-20",
      verifier: "Reviewer",
      result: "pass",
      deviations: "None",
      hardenedJplDelta: { installStartup: true, representativeRender: true, themeAndViewChanges: true, hostileFixture: true, upgrade: true },
    })),
    overallRationale: "Reviewed all evidence.",
  });
}

describe("baseline contracts", () => {
  it("rejects unknown schema versions before interpreting a contract", () => {
    expect(() => parseKnownBaselineContract({ schemaVersion: 2, kind: "BaselineReviewDraft" })).toThrow(/Unsupported baseline schema version/);
    const valid = draft();
    expect(BaselineReviewDraftV1Schema.safeParse({ ...valid, decisions: valid.decisions.map(item => ({ ...item, itemId: REVIEW_ITEM_IDS[0] })) }).success).toBe(false);
    expect(BaselineReviewDraftV1Schema.safeParse({ ...valid, platformEvidence: [valid.platformEvidence[0], valid.platformEvidence[0]] }).success).toBe(false);
  });

  it("migrates notes but resets decisions and issue acknowledgements for a replacement bundle", () => {
    const migrated = migrateDraftNotesToBundle(draft(), "b".repeat(64), "2026-08-21T12:00:00.000Z");
    expect(migrated.bundleDigest).toBe("b".repeat(64));
    expect(migrated.decisions.every(item => item.decision === "unresolved")).toBe(true);
    expect(migrated.decisions[0].note).toBe(`note:${REVIEW_ITEM_IDS[0]}`);
    expect(migrated.knownIssueAcknowledgements).toEqual({ "ADL-022": false, "ADL-023": false });
    expect(migrated.platformEvidence.every(item => item.result === "" && Object.values(item.hardenedJplDelta).every(value => !value))).toBe(true);
    expect(migrated.overallRationale).toBe("");
  });

  it("requires every native delta case and only passing results", () => {
    const input = draft().platformEvidence[0];
    expect(NativePlatformEvidenceV1Schema.safeParse({ ...input, schemaVersion: 1 }).success).toBe(true);
    expect(NativePlatformEvidenceV1Schema.safeParse({ ...input, schemaVersion: 1, result: "fail" }).success).toBe(false);
    expect(NativePlatformEvidenceV1Schema.safeParse({ ...input, schemaVersion: 1, hardenedJplDelta: { ...input.hardenedJplDelta, upgrade: false } }).success).toBe(false);
  });
});
