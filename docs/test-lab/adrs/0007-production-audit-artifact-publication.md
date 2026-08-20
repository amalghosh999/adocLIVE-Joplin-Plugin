# ADR 0007: Gate production dependencies and publish preserved artifacts

Status: accepted

## Context

Rebuilding during publication can produce bytes different from the reviewed
candidate. Treating development-only advisories as equivalent to shipped
runtime risk also obscures the release rule, while allowing a production
advisory through a release weakens the evidence handoff.

## Decision

Pull requests block unexcepted high and critical production dependency
advisories. A temporary exception is permitted only for a high-severity
production advisory, must name an owner, rationale, compensating controls and
advisory IDs, and must expire within 30 days. Critical exceptions are
prohibited. Release preparation and publication require zero production
advisories at every severity; release mode ignores all exceptions. Nightly jobs
retain the full audit report without changing that release rule.

Release preparation creates the JPL and npm tarball once, stores their exact
bytes in the immutable candidate bundle, and binds their hashes to the review
receipt. Publication tooling verifies the applied receipt, clean evidence
commit, source-to-evidence allowlist, live audit, authentication, package-name
availability, tag state, and every stored hash. It publishes the stored npm
tarball and attaches the stored JPL without rebuilding or changing versions.
Direct `npm publish` is guarded.

External tag creation, pushes, GitHub releases, and npm publication remain
separate explicit actions and are not performed by the 1.0.4 hardening change.

## Consequences

The reviewed bytes are the publishable bytes. A newly disclosed production
advisory or any artifact mismatch invalidates the handoff and requires a new
canonical bundle and review. Development-only advisory modernization and major
Asciidoctor upgrades remain separate work.
