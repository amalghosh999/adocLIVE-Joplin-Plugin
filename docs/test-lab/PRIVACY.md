# Test Lab Privacy and Hostile Content Policy

Local note or scenario imports are private sessions by default. The controller keeps their source and derived data in memory. It must not write screenshots, video, traces, DOM snapshots, diagnostics, scenario exports, or browser storage containing imported content. Export requires an explicit confirmation that names the destination and the classes of data included. A reset destroys imported state and editor frames.

Committed fixtures contain only synthetic prose and original tiny local assets. Secrets, personal note content, copyrighted document corpora, and real user media are prohibited. Size-limited inline resources are decoded in memory; paths are restricted to the committed fixture asset root.

Hostile fixtures are inert test strings. They execute on the isolated editor origin with controller state unavailable to rendered DOM. Automated runs deny external requests and dangerous navigation. Manual remote-content mode requires `ADOC_LAB_ALLOW_REMOTE=1`, displays a persistent warning, and must never be used to approve deterministic baselines.

CI never receives private imports. Non-private failure artifacts are retained for 14 days; nightly metric summaries for 30 days. Contributors must inspect artifacts before sharing them outside the project.

Baseline candidate bundles are generated only from committed synthetic fixtures.
Private imported notes, their derived screenshots, and their browser storage
must never enter candidate generation, review receipts, JPLs, or npm tarballs.
