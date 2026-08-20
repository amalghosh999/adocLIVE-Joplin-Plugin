# Baseline Review

Scroll, visual, and relative performance files are reviewed evidence, not automatically updated output. Canonical results come from `mcr.microsoft.com/playwright:v1.61.1-noble` with the repository's exact Playwright version.

## Scroll

Run `npm run test:scroll` in the canonical image. Review all 30-run displacement values, p99, MAD, raw line height, screenshots/traces, and anomalies. The characterized regression ceiling is `p99 + max(1 px, MAD)`. It protects current behavior only. The desired one-quarter-line source-anchor contract remains the independently expected-failing ADL-022 assertion, and bottom-clamp correctness remains ADL-023. Approval must not call either defect correct.

## Visual

`npm run test:visual:update` stages candidates without changing tracked baselines. Inspect before/candidate/diff evidence for every one of the 13 images; there is no bulk approval. Default threshold is 0.2 with `maxDiffPixelRatio` 0.001. Exceptions must be documented beside approval evidence. CI never applies candidates.

Candidate canvas normalization snaps only per-pixel channel jitter of at most two
values back to the approved before pixel before hashing. This removes
non-semantic Chromium antialias noise; changes above that recorded stability
epsilon remain unmodified in the candidate and deterministic diff.

## Performance

Run `npm run test:perf` with one worker after calibration. Review warmups, samples, median/p95, long tasks, mutations, layout shifts, and absolute 50/100/200/400 ms ceilings. Set the relative baseline approved only with human evidence. The relative gate requires both over 20% and at least 5 ms regression.

Never approve results from remote-content mode, an unpinned browser/image, private imports, or a run with unexplained errors.

## Immutable candidate workflow

Canonical generation writes a digest-named bundle beneath the ignored candidate
root. A finalizable bundle comes only from Playwright 1.61.1 in
`mcr.microsoft.com/playwright:v1.61.1-noble`, a clean source commit, and a zero-
advisory production audit plus release-scoped test evidence. It contains the visual and scroll evidence, test and
audit reports, environment and lock details, manifest, JPL, npm tarball, and a
hash inventory. Local or noncanonical generation may be useful diagnostically
but remains draft-only.

Use the read-only `/baseline-review/` selector to decide each visual image and
the scroll characterization, record notes, acknowledge ADL-022/023 without
accepting them, add Windows and macOS hardened-JPL evidence, and provide an
overall rationale. Draft JSON is browser-local and bound to the bundle digest.
Final receipt export is blocked by any unresolved or rejected item, missing
native evidence, noncanonical environment, advisory, or missing rationale.

The CLI apply step revalidates the clean source commit and every artifact hash
before promoting approved evidence. It copies only the receipt and approved
baseline/native records into tracked Test Lab evidence; candidate bundles and
release artifacts remain untracked. See [ADR 0006](adrs/0006-immutable-candidate-review.md)
and the [review-page design record](evidence/BASELINE_REVIEW_DESIGN.md).

## Commands

```bash
npm run baseline:candidates             # local, draft-only when noncanonical or dirty
npm run baseline:candidates:docker      # canonical Playwright 1.61.1 Noble generation
npm run baseline:review                 # read-only browser selector
npm run baseline:review:import -- <artifact>
npm run baseline:apply -- <receipt.json>
```

Import accepts a validated directory, ZIP, or compressed tar artifact and
rejects traversal, unknown schemas, extra files, missing files, and hash
tampering. Applying a new receipt requires the clean reviewed source commit.
Reapplying the exact already-applied receipt performs idempotent validation;
conflicting evidence fails.
