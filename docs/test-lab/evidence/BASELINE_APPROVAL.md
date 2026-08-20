# Baseline Approval Evidence

Status: partially approved; scroll and visual review pending

Canonical image: `mcr.microsoft.com/playwright:v1.61.1-noble`

- Scroll candidate: 30 repetitions on 2026-07-10; median 54.5625 px, p99 689.3125 px, MAD 0 px, raw line height 18.1875 px. The desired quarter-line contract remains expected-failing as `ADL-022`. Review [scroll-bounds.json](../../../tests/browser/baselines/scroll/scroll-bounds.json). Reviewer/approval date: pending.
- Visual candidate: 13 editor-only Linux/Chromium images generated on 2026-07-10. Every image hash is recorded in [baseline.json](../../../tests/browser/baselines/visual/baseline.json). Reviewer/approval date: pending.
- Performance candidate: 12 post-warmup samples per scale on 2026-07-10. Median/p95 values in milliseconds are 10.1/15.8 (1k), 34.8/36.1 (5k), 66.7/68.1 (10k), and 132.4/134.7 (20k). Review [performance.json](../../../tests/browser/baselines/performance.json). Approved by the repository owner on 2026-08-20; no exceptions reported.
- Headed dashboard inspection: approved by the repository owner on 2026-08-20; no findings reported.

Approval means the reviewer inspected the distributions, screenshots/diffs, anomalies, diagnostics, and current known-failure catalog. Automation and implementation authors cannot self-mark this record complete without that explicit review.
