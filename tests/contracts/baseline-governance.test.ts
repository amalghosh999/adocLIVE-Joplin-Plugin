import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BaselineReviewReceiptV1Schema, SCROLL_CANDIDATE_ID } from "../../baseline/contracts";

const root = path.resolve(__dirname, "../..");

function approvalReceipt(approvalEvidence: unknown) {
  expect(approvalEvidence).toMatch(/^docs\/test-lab\/evidence\/baseline-reviews\/[a-f0-9]{64}\.receipt\.json$/);
  const relativePath = String(approvalEvidence);
  const receipt = BaselineReviewReceiptV1Schema.parse(JSON.parse(fs.readFileSync(path.join(root, ...relativePath.split("/")), "utf8")));
  expect(path.basename(relativePath)).toBe(`${receipt.bundleDigest}.receipt.json`);
  return receipt;
}

describe("baseline governance", () => {
  it("requires every committed visual candidate to be explicitly hashed in its review manifest", () => {
    const baselineRoot = path.join(root, "tests/browser/baselines/visual");
    const manifest = JSON.parse(fs.readFileSync(path.join(baselineRoot, "baseline.json"), "utf8"));
    expect(typeof manifest.approved).toBe("boolean");
    const receipt = manifest.approved ? approvalReceipt(manifest.approvalEvidence) : null;
    if (!manifest.approved) expect(manifest.approvalEvidence).toBeNull();
    expect(manifest.threshold).toBe(0.2);
    expect(manifest.maxDiffPixelRatio).toBe(0.001);
    const files = fs.readdirSync(path.join(baselineRoot, "visual.spec.ts")).filter(file => file.endsWith(".png")).sort();
    expect(Object.keys(manifest.candidateHashes).sort()).toEqual(files);
    for (const file of files) {
      const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(baselineRoot, "visual.spec.ts", file))).digest("hex");
      expect(hash, `${file} changed without baseline-manifest review`).toBe(manifest.candidateHashes[file]);
      if (receipt) expect(receipt.artifactHashes[`visual/candidate/${file}`], `${file} is not bound to the applied review receipt`).toBe(hash);
    }
  });

  it("keeps scroll and performance approval state explicit and human-evidenced", () => {
    for (const file of ["tests/browser/baselines/scroll/scroll-bounds.json", "tests/browser/baselines/performance.json"]) {
      const candidate = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
      expect(typeof candidate.approved).toBe("boolean");
      if (!candidate.approved) expect(candidate.approvalEvidence).toBeNull();
      else if (file.includes("scroll-bounds")) {
        const receipt = approvalReceipt(candidate.approvalEvidence);
        expect(receipt.decisions.find(decision => decision.itemId === SCROLL_CANDIDATE_ID)?.decision).toBe("approved");
        expect(receipt.knownIssueAcknowledgements).toEqual({ "ADL-022": true, "ADL-023": true });
        expect(receipt.artifactHashes).toHaveProperty("scroll/scroll-characterization.json");
      } else expect(candidate.approvalEvidence).toMatch(/docs\/test-lab\/evidence\//);
    }
  });
});
