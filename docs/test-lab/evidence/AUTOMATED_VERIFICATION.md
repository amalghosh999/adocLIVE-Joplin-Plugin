# Automated Verification Evidence

Status: pre-source-commit automated gates passed; remaining user-owned and native-review gates are listed below

Verified on 2026-08-20 with Node 26.7.0, npm 12.0.2, Playwright 1.61.1, and Chromium. CI uses the canonical `mcr.microsoft.com/playwright:v1.61.1-noble` image.

## Final matrix

After the first canonical attempt exposed an archive-import test that assumed a
host `zip` executable, the importer and test fixture were made self-contained
with the dev-only `fflate` package. The full `npm run test:lab:nightly` aggregate
was then rerun successfully from a fresh `npm ci` install. The complete results
were:

- Production audits: PR, release, nightly, and direct `npm audit --omit=dev` all reported zero advisories at every severity. The unfiltered install retains one moderate and six high development-only advisories, which are outside the 1.0.4 production-release scope.
- Unit and contract suite: 31 files, 268 passing tests and one intentional expected-failure sentinel (269 total).
- Explicit protocol/receipt contract suite: 16 files, 83 passing tests and one intentional expected-failure sentinel (84 total).
- Production and Test Lab TypeScript checks: passed.
- Production Webpack/JPL build: passed.
- Focused two-handle Joplin simulator: 4 passed.
- Functional, lifecycle, race, security, privacy, replay, and baseline-review Chromium suite: 39 passed.
- Protected scroll suite: 4 passed, including the 30-repeat characterization and the separately governed ADL-022/023 desired-behavior expected failures.
- Visual suite: 4 passed and compared 13 committed editor-only images.
- WCAG 2.2 AA automation: 4 passed, including the review page's narrow, forced-colors, and reduced-motion states.
- Packaged-artifact contracts: 6 passed.
- Extracted generated-JPL Chromium boot: 1 passed.
- Complete deterministic fixture matrix: 1 passed.
- Performance and responsiveness: 5 passed across 1k, 5k, 10k, and 20k lines.
- Leak detection: 2 passed, each exercising at least 100 lifecycle repetitions with CDP heap/DOM gates.

## Candidate and review-boundary checks

- Before the portability correction, two consecutive local candidate runs
  produced and then reused digest
  `ae6c0584b2f69d5a2e7d77266039eea8d65642887f057d6ffbff123004df2806`.
  That draft is now intentionally obsolete and cannot be finalized against the
  replacement source commit.
- The first canonical run from source commit
  `156016648b87f5a039a5112762c8caa9e0c1b546` failed closed during unit tests
  because the pinned Noble image has neither `zip` nor `unzip`. No candidate was
  finalized or reviewed from that attempt.
- ZIP import now performs bounded central-directory validation and rejects
  traversal, duplicate/colliding paths, encryption, unsupported compression,
  symlinks, special entries, and inconsistent sizes before writing regular files.
  Its contract passed directly inside `mcr.microsoft.com/playwright:v1.61.1-noble`
  without system ZIP tools, and an independently generated Info-ZIP candidate
  bundle imported and revalidated successfully.
- Live loopback review requests returned the page, run list, manifest, and a whitelisted PNG. An unlisted file and a traversal path returned 404; POST returned 405; offline CSP and no-store headers were present.
- Dirty-tree release preparation and canonical generation failed before building. Direct `npm publish --dry-run` was blocked by the publication guard.

## Repository and artifact checks

- `git diff --check`: passed.
- Relative Markdown links under `docs/test-lab`: passed.
- `npm pack --dry-run --json`: only `LICENSE`, `README.adoc`, `package.json`, and the two `publish/` artifacts are included.
- Generated JPL inspection and extracted-panel smoke: passed; no Test Lab sources or outputs are present.
- Production dependency-boundary contracts: passed; production code does not import Test Lab or browser-test modules.
- Disposable native-verification workspace generation: passed.

Final production artifact measurements are recorded in [BUNDLE_SIZES.md](BUNDLE_SIZES.md). Candidate baseline evidence is recorded in [BASELINE_APPROVAL.md](BASELINE_APPROVAL.md).

## Human completion gates

Automation cannot complete or self-approve these required records:

- The replacement user-owned clean 1.0.4 source commit that includes the Noble
  archive-portability correction.
- Canonical Noble generation and individual browser review of all 13 visuals plus the characterized scroll evidence.
- Targeted Windows and macOS hardened-JPL delta evidence.
- Receipt application and the user-owned evidence-only commit.

The performance baseline, headed dashboard inspection, and Linux native matrix were approved by the repository owner on 2026-08-20. Until the remaining records are signed, the repository implementation is complete and automated gates are green, but the plan's full human-evidence definition of done remains open.
