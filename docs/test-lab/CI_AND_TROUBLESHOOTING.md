# CI, Diagnostics, and Troubleshooting

PR jobs separate unit/build/contracts, protected browser suites, and Joplin-simulator/artifact smoke. Scheduled/on-demand work runs scale performance and 100-cycle leak tests. Non-private failures retain screenshots, video, traces, DOM/context, scenario data, and diagnostics for 14 days; nightly metrics retain 30 days.

Automated requests are loopback-only and CSP also denies remote content. A test that needs the internet is incorrectly designed. Expected failures must reference an exact reviewed `ADL-*` record; an unexpected pass fails so the record can be removed.

If the editor never connects, verify both ports are free, open `/health` on each origin, and inspect nonce/origin errors in diagnostics. If a request stays pending, inspect the logical queue and fault policy; advance the clock or resolve it explicitly. If fonts/assets fail, run `npm run lab:build` and inspect `test-lab-dist/editor/styles`.

For flaky scroll/visual output, reproduce in the pinned Noble container with one worker. Confirm fixed timezone/locale/device scale, local fonts/media, clean storage, quiet mutations, two animation frames, and no pending host/render work before proposing any baseline change.

Artifact failures should be reproduced with `npm run test:artifact-smoke`; inspect the tar listing before changing packaging. Native-only failures use `npm run native:prepare` and the matrix in `evidence/NATIVE_JOPLIN_MATRIX.md`.

Candidate import rejects unsafe archive paths, links, extra files, and hash
mismatches before the review route exposes anything. If a retained workflow
artifact is rejected, list its archive entries and validate the digest-named
directory with the same pinned Node environment; never copy individual files
around the validator.

Codex and contributors must preserve the dependency boundary: production cannot import `test-lab/` or browser tests, and lab behavior shared with production belongs behind `src/shared/` or `src/host/` ports. Run `rg 'test-lab|tests/browser' src` and package inspection before handoff.
