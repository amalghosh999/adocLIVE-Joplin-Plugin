const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { chromium } = require("playwright");

const repoRoot = path.resolve(__dirname, "..");
const examplesRoot = fs.realpathSync(path.join(repoRoot, "examples"));
const outputRoot = path.join(repoRoot, "docs", "images");
const controllerPort = 4273;
const editorPort = 4274;
const controllerUrl = `http://127.0.0.1:${controllerPort}`;
const primaryNoteId = "00000000000000000000000000000001";

function readSyntheticExample(fileName) {
  const candidate = fs.realpathSync(path.join(examplesRoot, fileName));
  if (!candidate.startsWith(`${examplesRoot}${path.sep}`)) {
    throw new Error(`Documentation example escaped the examples directory: ${fileName}`);
  }
  const source = fs.readFileSync(candidate, "utf8");
  const privateMarkers = [/(?:^|\s)\/home\//i, /(?:^|\s)[A-Z]:\\Users\\/i, /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/];
  if (privateMarkers.some(pattern => pattern.test(source))) {
    throw new Error(`Documentation example contains a personal-data marker: ${fileName}`);
  }
  return source;
}

async function waitForHealth(serverOutput) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${controllerUrl}/health`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // The loopback server may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Test Lab did not become ready.\n${serverOutput()}`);
}

async function waitForEditor(page) {
  const frame = page.frameLocator('iframe[data-session-id="editor-1"]');
  await frame.locator("#asciidoc-editor-root").waitFor({ state: "visible", timeout: 30_000 });
  await frame.locator(".cm-editor").waitFor({ state: "visible", timeout: 30_000 });
  return frame;
}

async function waitForStableFrame(frame) {
  await frame.locator("body").evaluate(async () => {
    await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2_000))]);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise(resolve => {
      let quietTimer = 0;
      const hardStop = window.setTimeout(finish, 3_000);
      const observer = new MutationObserver(() => {
        clearTimeout(quietTimer);
        quietTimer = window.setTimeout(finish, 180);
      });
      function finish() {
        clearTimeout(quietTimer);
        clearTimeout(hardStop);
        observer.disconnect();
        resolve();
      }
      observer.observe(document.body, { attributes: true, childList: true, subtree: true });
      quietTimer = window.setTimeout(finish, 180);
    });
  });
}

async function capture(context, definition) {
  const page = await context.newPage();
  const errors = [];
  const externalRequests = [];
  page.on("pageerror", error => errors.push(error.stack || error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", request => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname) && !["data:", "blob:"].includes(url.protocol)) {
      externalRequests.push(request.url());
    }
  });

  await page.goto(controllerUrl, { waitUntil: "domcontentloaded" });
  await waitForEditor(page);
  await page.locator("#view-mode").selectOption(definition.view);
  await page.locator("#theme").selectOption(definition.theme);
  await page.locator("#viewport").selectOption("1280x800");
  await page.locator("#apply-layout").click();
  const frame = await waitForEditor(page);

  await page.evaluate(({ noteId, source, title }) => {
    window.__ADOC_LAB__.mutateNote(noteId, source, title);
  }, { noteId: primaryNoteId, source: definition.source, title: definition.title });
  await frame.locator(".cm-content").waitFor({ state: "visible" });
  await frame.getByRole("button", { name: definition.tab, exact: true }).click();
  await waitForStableFrame(frame);
  await page.waitForFunction(() => window.__ADOC_LAB__.getState().pending.length === 0);

  const labState = await page.evaluate(() => window.__ADOC_LAB__.getState());
  if (labState.privateSession) throw new Error("Documentation capture entered a private Test Lab session");

  await frame.locator("html").evaluate(element => {
    element.classList.add("documentation-capture");
    const style = document.createElement("style");
    style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important}.cm-cursor{visibility:hidden!important}";
    document.head.appendChild(style);
  });
  await page.addStyleTag({ content: `
    html, body { width: 1280px !important; height: 800px !important; min-width: 0 !important; overflow: hidden !important; }
    .topbar, .warning, .fatal, .controls, .diagnostics { display: none !important; }
    .dashboard, .workspace { display: block !important; width: 1280px !important; height: 800px !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
    .editor-grid, .editor-frame-shell { display: block !important; width: 1280px !important; min-width: 0 !important; max-width: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important; }
    .editor-frame-shell > h2 { display: none !important; }
    iframe[data-session-id="editor-1"] { display: block !important; width: 1280px !important; height: 800px !important; border: 0 !important; }
  ` });

  fs.mkdirSync(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, definition.fileName);
  await page.locator('iframe[data-session-id="editor-1"]').screenshot({
    path: outputPath,
    animations: "disabled",
    caret: "hide",
  });

  if (externalRequests.length) throw new Error(`Documentation capture made external requests:\n${externalRequests.join("\n")}`);
  if (errors.length) throw new Error(`Documentation capture reported browser errors:\n${errors.join("\n")}`);
  await page.close();
  process.stdout.write(`Captured ${path.relative(repoRoot, outputPath)}\n`);
}

async function stopServer(server) {
  if (server.exitCode != null || server.signalCode != null) return;
  server.kill("SIGTERM");
  await Promise.race([
    once(server, "exit"),
    new Promise(resolve => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode == null && server.signalCode == null) server.kill("SIGKILL");
}

async function main() {
  const required = [
    path.join(repoRoot, "publish", "com.asciidoc.joplin-plugin.jpl"),
    path.join(repoRoot, "test-lab-dist", "controller", "index.html"),
  ];
  for (const file of required) {
    if (!fs.existsSync(file)) throw new Error(`Missing ${path.relative(repoRoot, file)}; run npm run docs:screenshots`);
  }

  const captures = [
    {
      fileName: "adoclive-live-preview.png",
      title: "Weekend Field Guide",
      source: readSyntheticExample("weekend-field-guide.adoc"),
      view: "live-preview",
      theme: "light",
      tab: "Text",
    },
    {
      fileName: "adoclive-raw-text.png",
      title: "Small Project Release",
      source: readSyntheticExample("small-project-release.adoc"),
      view: "raw",
      theme: "light",
      tab: "View",
    },
    {
      fileName: "adoclive-dark-theme.png",
      title: "Small Project Release",
      source: readSyntheticExample("small-project-release.adoc"),
      view: "live-preview",
      theme: "dark",
      tab: "Insert",
    },
  ];

  let serverLog = "";
  const server = spawn(process.execPath, ["scripts/lab-server.js", "--artifact"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ADOC_LAB_CONTROLLER_PORT: String(controllerPort),
      ADOC_LAB_EDITOR_PORT: String(editorPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", chunk => { serverLog += chunk.toString(); });
  server.stderr.on("data", chunk => { serverLog += chunk.toString(); });

  let browser;
  try {
    await waitForHealth(() => serverLog);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      locale: "en-US",
      timezoneId: "America/Chicago",
      colorScheme: "light",
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    for (const definition of captures) await capture(context, definition);
    await context.close();
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }

  process.stdout.write("Documentation screenshots contain only repository-owned synthetic examples.\n");
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
