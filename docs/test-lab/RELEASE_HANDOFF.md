# 1.0.4 Release Handoff

The release path preserves the package contract documented by the
[official Joplin plugin generator](https://github.com/laurent22/joplin/blob/dev/packages/generator-joplin/generators/app/templates/GENERATOR_DOC.md):
the package name begins with `joplin-plugin-`, the `joplin-plugin` keyword is
present, and `publish/` contains the JPL plus publication JSON. The npm payload
continues to contain only those publish artifacts and required package metadata.

## Source and evidence commits

1. Run the full verification matrix and create a clean 1.0.4 source commit.
2. Run `npm run release:prepare` or dispatch the canonical candidate workflow.
3. Import the retained artifact if needed, then run `npm run baseline:review`.
4. Review all 13 visuals and the scroll characterization; record exact Windows
   and macOS hardened-JPL delta evidence; download the receipt.
5. Run `npm run baseline:apply -- <receipt.json>` from the unchanged clean source
   commit and verify the allowlisted evidence-only diff.
6. Create the evidence-only commit.

The source and evidence commits are intentionally user-owned. Candidate bundles,
JPLs, npm tarballs, browser output, and non-applied receipts remain ignored and
untracked.

## Publication

Validate without publishing:

```bash
npm run release:publish -- \
  --bundle .baseline-candidates/<digest> \
  --receipt docs/test-lab/evidence/baseline-reviews/<digest>.receipt.json \
  --confirm 1.0.4 \
  --dry-run
```

Remove `--dry-run` only for the explicit external publication action. The
command verifies the applied receipt, clean evidence commit, one-commit
source-to-evidence allowlist, live zero-advisory audit, exact hashes, npm and
GitHub authentication, package-version availability, and tag state. It then
publishes the stored npm tarball and attaches the stored JPL; it does not rebuild
or change versions. Direct `npm publish` is guarded.

Any newly disclosed production advisory, artifact mismatch, receipt conflict,
or source change invalidates the handoff and requires a new canonical candidate
and review.
