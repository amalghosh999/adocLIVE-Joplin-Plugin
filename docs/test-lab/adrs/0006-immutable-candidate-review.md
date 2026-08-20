# ADR 0006: Use immutable candidate bundles and hash-bound review receipts

Status: accepted

## Context

Direct snapshot replacement mixes evidence generation, human judgment, and
tracked-file mutation. It cannot prove that the artifacts a reviewer inspected
are the files later applied or published, and it makes stale or partial review
difficult to reject reliably.

## Decision

Canonical generation creates an immutable, digest-named candidate bundle from a
clean source commit. The bundle records the environment, lockfile, all 13 visual
candidates and their before/candidate/diff evidence, the 30-run scroll
characterization, audit and test results, the JPL, npm tarball, manifest, and a
SHA-256 for every referenced file. Candidate directories are ignored and cannot
enter npm or JPL payloads.

The controller exposes a loopback-only, read-only `/baseline-review/` surface.
It may enumerate validated bundles and read whitelisted artifacts beneath one
resolved bundle; it has no POST, mutation, shell, package-management, or editor-
origin capability. Review drafts live in browser localStorage under the bundle
digest and may be exported or imported as JSON. Notes may migrate to a
replacement bundle, but every decision resets when evidence hashes change.

Finalization produces one canonical `BaselineReviewReceiptV1` bound to the
bundle digest and artifact hashes. It names one reviewer and timestamp, records
every per-image decision, the characterized scroll decision, known-issue
acknowledgements, an overall rationale, and complete Windows/macOS hardened-JPL
evidence. Unknown schema versions, incomplete decisions, rejected items,
noncanonical environments, production advisories, stale commits, and tampered
artifacts fail closed.

Only the validated CLI apply step may promote approved PNGs and manifests or
copy a receipt into tracked evidence. Applying an unchanged receipt is an
idempotent validation; a conflicting prior application fails.

## Consequences

Review and application become two explicit, auditable operations. The browser
remains safe to use with synthetic evidence because it cannot write the
repository. A new artifact hash invalidates prior decisions and requires a new
review, which is intentional even when the visual difference appears harmless.
