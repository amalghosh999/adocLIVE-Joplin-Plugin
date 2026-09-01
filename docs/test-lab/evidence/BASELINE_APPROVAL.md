# Baseline Approval Evidence

Status: visual and scroll baselines approved for adocLIVE 1.0.5

Canonical image: `mcr.microsoft.com/playwright:v1.61.1-noble`

Receipt: [9a4f00bd4f2642841237a451b358f3e7a1dca24d6164baf61a19c44192585835.receipt.json](baseline-reviews/9a4f00bd4f2642841237a451b358f3e7a1dca24d6164baf61a19c44192585835.receipt.json)  
Reviewer: lama999  
Reviewed: 2026-09-01T02:18:11.820Z  
Bundle digest: `9a4f00bd4f2642841237a451b358f3e7a1dca24d6164baf61a19c44192585835`  
Source commit: `ee4350f861f31c1aae6ee134f15ce40cde5d48d5`

- Visual baseline: all 13 editor-only Linux/Chromium images were individually approved. No bulk decision was used.
- Scroll characterization: 30 repetitions; median 0 px, p99 2837 px, MAD 0 px, raw line height 18.1875 px, regression ceiling 2838 px.
- The scroll ceiling protects characterized behavior only. ADL-022 quarter-line safety and ADL-023 bottom-clamp correctness remain desired-behavior expected failures and were explicitly acknowledged.
- Production audit: zero advisories at every severity.
- Performance baseline and headed dashboard inspection remain approved from the repository-owner review on 2026-08-20.

Overall rationale: all pass
