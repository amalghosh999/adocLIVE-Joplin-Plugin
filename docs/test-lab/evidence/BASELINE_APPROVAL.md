# Baseline Approval Evidence

Status: visual and scroll baselines approved for adocLIVE 1.0.4

Canonical image: `mcr.microsoft.com/playwright:v1.61.1-noble`

Receipt: [15a65c9fd95067467f152c14bae8c7982c2fd7cc01d7085a99fc84a221eaafc4.receipt.json](baseline-reviews/15a65c9fd95067467f152c14bae8c7982c2fd7cc01d7085a99fc84a221eaafc4.receipt.json)  
Reviewer: amalghosh999  
Reviewed: 2026-08-20T22:53:47.994Z  
Bundle digest: `15a65c9fd95067467f152c14bae8c7982c2fd7cc01d7085a99fc84a221eaafc4`  
Source commit: `50d8644c68f3eb667afe38630417a0432221d5a8`

- Visual baseline: all 13 editor-only Linux/Chromium images were individually approved. No bulk decision was used.
- Scroll characterization: 30 repetitions; median 0 px, p99 2837 px, MAD 0 px, raw line height 18.1875 px, regression ceiling 2838 px.
- The scroll ceiling protects characterized behavior only. ADL-022 quarter-line safety and ADL-023 bottom-clamp correctness remain desired-behavior expected failures and were explicitly acknowledged.
- Production audit: zero advisories at every severity.
- Performance baseline and headed dashboard inspection remain approved from the repository-owner review on 2026-08-20.

Overall rationale: all checks passed
