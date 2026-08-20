# ADR 0004: Govern scroll, visual, and performance baselines

Status: accepted

Linux Chromium in the Playwright 1.61.1 Noble image is canonical. Scroll
regression ceilings come from reviewed 30-run source-anchor displacement using:

```text
ceiling = p99 + max(1 px, MAD)
```

The raw/live/raw endpoints use the same raw document geometry. The collector
records and gates that geometry stability, then measures the anchor's viewport
displacement as the absolute `scrollTop` delta. This is equivalent to comparing
the same line's viewport coordinates and remains observable when CodeMirror
virtualizes a severely displaced anchor out of the DOM.

That ceiling characterizes current behavior and prevents an unreviewed
regression; it is not the desired correctness contract. The independent
quarter-line source-anchor target remains an expected-failing ADL-022 assertion,
and mathematically correct bottom-clamp behavior remains ADL-023. Approving a
characterized ceiling must never be described as accepting either defect as
correct or as retiring either expected failure.

Visual snapshots use deterministic display inputs. Performance uses calibrated
repeated median/p95 samples and fixed absolute/relative contracts. Automation
may create candidates but never commits or approves them. Any baseline change
requires explicit human review and recorded evidence.
