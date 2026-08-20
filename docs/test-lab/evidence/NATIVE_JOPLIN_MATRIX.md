# Native Joplin Verification Evidence

Status: Linux matrix approved; first-public-release Windows and macOS evidence pending

Release candidate: pre-canonical 1.0.4 implementation build, manifest version 1.0.4, JPL SHA-256 `51956c7b95e0906180485dab2b3bff2b0ea9b52dd28ae79d92f1f12217e74f00`. The canonical clean-source candidate and its exact hash replace this provisional line when the final receipt is applied.

Verifier/date/Joplin version/Linux distribution: repository-owner approval received 2026-08-20; exact Joplin version and Linux distribution were not supplied with the approval

Generate a disposable workspace with `npm run native:prepare`. Install the copied JPL into the generated empty profile. Attach sanitized screenshots/logs only after confirming they contain synthetic fixture data.

## Required Linux matrix

- [x] Install the generated JPL and verify manifest/plugin versions.
- [x] Open two Joplin windows and edit the same adocLIVE note.
- [x] Switch, deactivate, and close during the two-second save debounce.
- [x] Apply a same-note external update while clean and while dirty.
- [x] Exercise live, raw, split, and rendered-preview modes plus divider resize.
- [x] Exercise Joplin light/dark themes and every editor theme.
- [x] Verify clipboard read/write, converted paste, drag/drop, and native spellcheck.
- [x] Verify image/audio/video dialogs and resource paths containing spaces, `#`, and `?`.
- [x] Verify CSP/security behavior with the synthetic hostile fixture.
- [x] Install the prior release and upgrade to this JPL without losing settings or content.
- [x] Confirm no messages or saves reach a closed editor handle.

Observed results and deviations: approved by the repository owner on 2026-08-20 with no deviations reported. No additional logs or screenshots were supplied.

## Pre-publication platform evidence

- [ ] Targeted Windows pass before first public release or a platform-sensitive change.
- [ ] Targeted macOS pass before first public release or a platform-sensitive change.
