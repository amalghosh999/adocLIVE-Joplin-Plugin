# Shared Layouts

## Test Lab controller shell

- Source: `test-lab/controller/index.html`
- Description: Full-page three-column laboratory shell with a sticky status bar, left controls, central editor workspace, and right diagnostics rail.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'none'">
    <title>adocLIVE Test Lab</title>
    <link rel="stylesheet" href="/controller.css">
  </head>
  <body>
    <header class="topbar">
      <div>
        <h1>adocLIVE Test Lab</h1>
        <p>Real panel bundle · deterministic simulated Joplin</p>
      </div>
      <div class="badges" aria-live="polite">
        <span id="artifact-badge" class="badge" hidden>Extracted JPL</span>
        <span id="session-status">Connecting…</span>
        <span>Clock <output id="logical-clock">0</output> ms</span>
        <span>Errors <output id="error-count">0</output></span>
      </div>
    </header>
    <div id="remote-banner" class="warning" hidden>Remote-content mode is enabled. Results are not deterministic and cannot approve baselines.</div>
    <div id="private-banner" class="warning private" hidden>Private import: screenshots, traces, video, persistence, and unconfirmed export are prohibited.</div>
    <pre id="fatal-error" class="fatal" hidden></pre>

    <main class="dashboard">
      <aside class="controls" aria-label="Laboratory controls">
        <fieldset>
          <legend>Scenario</legend>
          <label>Fixture <select id="fixture"></select></label>
          <label class="file-label">Import local note/scenario <input id="import-file" type="file" accept=".adoc,.asciidoc,.txt,.json"></label>
          <div class="button-row"><button id="reset" type="button">Reset</button><button id="record" type="button">Record</button><button id="replay" type="button">Replay</button><button id="export" type="button">Export</button></div>
        </fieldset>

        <fieldset>
          <legend>Editor layout</legend>
          <label>Sessions <select id="session-count"><option value="1">One</option><option value="2">Two side by side</option></select></label>
          <label>View <select id="view-mode"><option value="live-preview">Live preview</option><option value="split">Split</option><option value="raw">Raw</option><option value="preview">Rendered preview</option></select></label>
          <label>Theme <select id="theme"><option value="follow">Follow host</option><option value="light">Light</option><option value="dark">Dark</option><option value="sepia">Sepia</option><option value="high-contrast">High contrast</option><option value="midnight">Midnight</option></select></label>
          <label>Viewport <select id="viewport"><option value="1280x800">1280 × 800</option><option value="1024x768">1024 × 768</option><option value="640x800">640 × 800</option><option value="375x667">375 × 667</option></select></label>
          <label>Zoom <input id="zoom" type="number" min="50" max="200" step="10" value="100"></label>
          <label>Margin <input id="margin" type="number" min="0" max="240" step="8" value="0"></label>
          <label class="checkbox"><input id="compact" type="checkbox"> Compact spacing</label>
          <label class="checkbox"><input id="attributes" type="checkbox" checked> Attribute completion</label>
          <label class="checkbox"><input id="spellcheck" type="checkbox"> nspell</label>
          <button id="apply-layout" type="button">Apply and reload editors</button>
        </fieldset>

        <fieldset>
          <legend>Host faults</legend>
          <label>Latency (logical ms) <input id="latency" type="number" min="0" value="0"></label>
          <label>Ordering <select id="ordering"><option value="fifo">FIFO</option><option value="manual">Manual</option><option value="reverse">Reverse</option></select></label>
          <label>Save echo <select id="save-echo"><option value="others">Other sessions</option><option value="none">None</option><option value="same">Saving session</option><option value="all">All sessions</option></select></label>
          <label>Request <select id="failure-request"></select></label>
          <label>Failure message <input id="failure-message" value="Synthetic host failure"></label>
          <label class="checkbox"><input id="manual-defer" type="checkbox"> Defer selected request</label>
          <label class="checkbox"><input id="duplicate-request" type="checkbox"> Duplicate selected response</label>
          <div class="button-row"><input id="clock-step" type="number" min="0" value="250" aria-label="Clock step"><button id="advance-clock" type="button">Advance</button></div>
          <div class="button-row"><button id="resolve-all" type="button">Resolve all</button><button id="reverse-pending" type="button">Reverse queue</button><button id="cancel-all" type="button">Cancel all</button></div>
          <ol id="pending-list" class="pending-list"></ol>
        </fieldset>

        <fieldset>
          <legend>Host mutation</legend>
          <label>External body <textarea id="mutation-body" rows="4">= External update

Synthetic host mutation.</textarea></label>
          <div class="button-row"><button id="external-update" type="button">Push update</button><button id="push-theme" type="button">Toggle theme push</button></div>
          <label>Resource <select id="resource-id" aria-label="Resource to mutate"></select></label>
          <label>Resource delay (logical ms) <input id="resource-delay" type="number" min="0" value="0"></label>
          <label>Resource failure <input id="resource-failure" placeholder="Empty clears failure"></label>
          <button id="mutate-resource" type="button">Mutate resource</button>
          <label>File-dialog selection <input id="file-selection" placeholder="/synthetic/path.ext"></label>
          <button id="apply-file-selection" type="button">Apply file selection</button>
        </fieldset>
      </aside>

      <section class="workspace" aria-label="Editor sessions" tabindex="0">
        <div id="editor-grid" class="editor-grid"></div>
      </section>

      <aside class="diagnostics" aria-label="Diagnostics">
        <div class="diagnostic-toolbar"><label>Filter <input id="log-filter" type="search"></label><button id="clear-logs" type="button">Clear</button></div>
        <details open><summary>Editor diagnostics</summary><pre id="diagnostics-log" tabindex="0"></pre></details>
        <details open><summary>Host / IPC log</summary><pre id="store-log" tabindex="0"></pre></details>
      </aside>
    </main>
    <script src="/controller.js"></script>
  </body>
</html>
```

There is no shared navigation, footer, SPA layout component, or route outlet.
The forthcoming baseline-review route should reuse the compact top bar and
three-pane density without pretending that the lab is a consumer product.
