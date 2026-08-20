# adocLIVE Test Lab Architecture

Status: accepted

The Test Lab is a contributor tool for exercising the actual adocLIVE custom editor without pretending to be the complete Joplin desktop application. The editor bundle and production CSS are the same artifacts registered with Joplin. A deterministic browser-hosted adapter supplies the editor-facing subset of Joplin behavior.

## System shape

```text
controller origin (default http://127.0.0.1:4173)
  dashboard, scenario recorder, LabControllerStore, logical scheduler
                  |
        validated transferred MessagePort
                  |
editor origin (default http://127.0.0.1:4174)
  shared editor shell, panel.js, production CSS
                  |
             EditorRpcService
          /                       \
 Joplin operation adapter     in-memory adapter
```

Every editor session is a separate cross-origin iframe and JavaScript realm. The controller owns shared notes, folders, resources, settings, templates, snippets, dictionary entries, fault policies, and the logical clock. Each iframe owns its CodeMirror state and transient UI. Two sessions can therefore edit one shared note without sharing module globals.

## Ownership and boundaries

- `src/shared/editor-shell.ts` owns the pure editor markup used by Joplin and the lab.
- `src/shared/editor-host-contracts.ts` owns request, response, push, and envelope validation.
- `src/host/` owns RPC routing and host-facing ports. Application logic does not import Joplin or lab adapters.
- `src/index.ts` remains the production composition root. Only production adapters may call Joplin.
- `src/lib/editor-transport.ts` and `src/lib/ipc.ts` own editor-side transport and typed request helpers.
- `test-lab/` owns the controller, deterministic store/scheduler, scenarios, fixtures, dashboard, and laboratory transport.
- `tests/browser/` owns black-box Chromium suites and control-only setup/observation helpers.
- `tests/joplin-sim/` owns the focused custom-editor handle simulator.

Production code must never import `test-lab/` or `tests/browser/`. The lab may import `src/shared/` contracts and build the real `src/panel.ts`; it must not copy editor behavior. Host application logic cannot import concrete Joplin or in-memory adapters. Diagnostics observe only and cannot change editor results.

## Transport security

The controller and editor deliberately use different local origins. The bootstrap accepts a connection only from the configured controller origin and only when origin, iframe source, session ID, and unguessable nonce match. It then accepts a single transferred `MessagePort`. Every envelope has protocol version, kind, session ID, request ID or push sequence, and payload. Zod validation rejects unknown versions, malformed payloads, duplicate request IDs, stale sequences, and messages for another session. Controller state is never attached to rendered note DOM.

Automated runs use a restrictive content policy and fail external requests. The editor origin serves only local build assets. Remote content requires the `ADOC_LAB_ALLOW_REMOTE=1` manual opt-in and is never enabled by browser tests.

## Determinism

Scenarios use semantic events and a logical clock. Host delays enter a deferred queue that contributors or a replay can resolve, reject, duplicate, or reorder. IDs and timestamps come from injected providers. The default save policy updates the shared note revision, acknowledges the saving handle without echoing to it, and notifies other handles according to the scenario policy.

## Diagnostics

The editor emits opt-in observational events around editor creation, requests, pushes, preview rendering, presentation changes, modal/popup lifecycle, resource/Mermaid work, measurement, and cache snapshots. Production installs no diagnostics sink and exposes no diagnostic global. Test Lab collection is enabled by an editor-document marker before `panel.js` loads.

## Artifacts

Generated lab bundles live in `test-lab-dist/`; Playwright output lives in `test-results/` and `playwright-report/`. Baseline JSON and reviewed Linux/Chromium screenshots are committed beneath `tests/browser/baselines/`. Private imports disable screenshots, video, traces, and persistent scenario export unless the contributor explicitly confirms export. Lab source and all generated test artifacts are excluded from the npm/JPL payload.

Release-baseline candidates are separate immutable, digest-named bundles beneath
an ignored root. The controller may expose their manifests and whitelisted files
only on a read-only `/baseline-review/` route. Browser drafts stay in
localStorage; the browser has no repository-write, POST, shell, or package-
management capability. A hash-bound receipt crosses back through a validating
CLI apply command before approved evidence becomes tracked. See
[ADR 0006](adrs/0006-immutable-candidate-review.md).

## Canonical commands

Commands and their scopes are documented in [TEST_CONTRACT.md](TEST_CONTRACT.md). The canonical browser is Chromium from `mcr.microsoft.com/playwright:v1.61.1-noble`; local results outside that image are diagnostic unless a contract explicitly says otherwise.

## Definition of done

Completion requires development-panel and extracted-JPL smoke, all request/push contracts, deterministic multi-session replay, protected functional/scroll/visual/accessibility suites, nightly performance/leak checks, the focused two-handle simulator, package isolation, the scripted Linux Joplin matrix, unit tests, both typechecks, and production distribution creation. Scroll, visual, and performance baseline changes remain human-only approvals. Windows and macOS evidence is required before a public release or a platform-sensitive change, not before merging the lab itself.

See [TEST_CONTRACT.md](TEST_CONTRACT.md), [PRIVACY.md](PRIVACY.md), [KNOWN_FAILURES.md](KNOWN_FAILURES.md), [PLANNING_HANDOFF.md](PLANNING_HANDOFF.md), and the [ADR index](adrs/README.md).
