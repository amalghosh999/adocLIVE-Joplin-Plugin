const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawnSync } = require("child_process");
const { artifactReferences, validateBundleDirectory } = require("../baseline/node-utils.ts");

const root = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const host = process.env.ADOC_LAB_HOST || "127.0.0.1";
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error(`The Test Lab is loopback-only; refusing ADOC_LAB_HOST=${host}`);
}
const controllerPort = Number(process.env.ADOC_LAB_CONTROLLER_PORT || 4173);
const editorPort = Number(process.env.ADOC_LAB_EDITOR_PORT || 4174);
const allowRemote = process.env.ADOC_LAB_ALLOW_REMOTE === "1";
const artifactMode = args.has("--artifact");
const distMode = args.has("--dist");
const controllerRoot = path.join(root, "test-lab-dist", "controller");
const editorRoot = path.join(root, "test-lab-dist", "editor");
const candidateRoot = path.resolve(root, process.env.ADOC_BASELINE_CANDIDATE_ROOT || ".baseline-candidates");

let artifactRoot = "";
if (artifactMode) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "src", "manifest.json"), "utf8"));
  const archive = path.join(root, "publish", `${manifest.id}.jpl`);
  if (!fs.existsSync(archive)) throw new Error(`Missing ${archive}; run npm run dist first`);
  artifactRoot = path.join(root, "test-lab-dist", "artifact");
  fs.rmSync(artifactRoot, { recursive: true, force: true });
  fs.mkdirSync(artifactRoot, { recursive: true });
  const extracted = spawnSync("tar", ["-xzf", archive, "-C", artifactRoot], { stdio: "inherit" });
  if (extracted.status !== 0) throw new Error(`Failed to extract ${archive}`);
} else if (distMode) {
  artifactRoot = path.join(root, "dist");
}

const requiredLabFiles = [path.join(controllerRoot, "index.html"), path.join(editorRoot, "editor.html"), path.join(editorRoot, "bootstrap.js")];

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function safeFile(base, requestPath) {
  try {
    const normalized = path.posix.normalize(decodeURIComponent(requestPath.split("?")[0])).replace(/^\/+/, "");
    const file = path.resolve(base, normalized || "index.html");
    return file === base || file.startsWith(`${base}${path.sep}`) ? file : null;
  } catch {
    return null;
  }
}

function securityHeaders(editor = false) {
  return {
    "Cache-Control": "no-store",
    "Cross-Origin-Resource-Policy": editor ? "same-origin" : "same-site",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": editor
      ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'none'; form-action 'none'",
  };
}

function sendFile(request, response, file, editor = false) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  let body = fs.readFileSync(file);
  if (editor && allowRemote && path.basename(file) === "editor.html") {
    body = Buffer.from(body.toString("utf8")
      .replace("img-src 'self' data: blob:", "img-src 'self' data: blob: http: https:")
      .replace("media-src 'self' data: blob:", "media-src 'self' data: blob: http: https:")
      .replace("connect-src 'none'", "connect-src http: https:"));
  }
  response.writeHead(200, {
    "Content-Type": mime[path.extname(file)] || "application/octet-stream",
    ...securityHeaders(editor),
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

function sendJson(request, response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...securityHeaders(false) });
  response.end(request.method === "HEAD" ? undefined : `${JSON.stringify(value)}\n`);
}

function loadCandidate(bundleId) {
  if (!/^[a-f0-9]{64}$/.test(bundleId)) throw new Error("Invalid candidate bundle id");
  const directory = path.join(candidateRoot, bundleId);
  return { directory, manifest: validateBundleDirectory(directory, true) };
}

function listCandidates() {
  if (!fs.existsSync(candidateRoot)) return [];
  return fs.readdirSync(candidateRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
    .flatMap(entry => {
      try {
        const { manifest } = loadCandidate(entry.name);
        return [{
          bundleId: manifest.bundleDigest,
          createdAt: manifest.createdAt,
          sourceCommit: manifest.source.commit,
          version: manifest.package.version,
          finalizable: manifest.finalizable,
          draftReasons: manifest.draftReasons,
          visualCount: manifest.visuals.length,
          auditTotal: manifest.audit.counts.total,
        }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.bundleId.localeCompare(left.bundleId));
}

const controllerOrigin = `http://${host}:${controllerPort}`;
const editorOrigin = `http://${host}:${editorPort}`;

const controller = http.createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD", ...securityHeaders(false) });
    response.end("Method not allowed");
    return;
  }
  const requestPath = new URL(request.url, controllerOrigin).pathname;
  if (requestPath === "/baseline-review/runs") {
    sendJson(request, response, 200, { schemaVersion: 1, runs: listCandidates() });
    return;
  }
  const candidateMatch = requestPath.match(/^\/baseline-review\/runs\/([a-f0-9]{64})\/(manifest|files\/(.+))$/);
  if (candidateMatch) {
    try {
      const { directory, manifest } = loadCandidate(candidateMatch[1]);
      if (candidateMatch[2] === "manifest") {
        sendJson(request, response, 200, manifest);
        return;
      }
      const relativePath = decodeURIComponent(candidateMatch[3]);
      const allowed = new Set(artifactReferences(manifest).map(reference => reference.path));
      if (!allowed.has(relativePath)) {
        sendJson(request, response, 404, { error: "Artifact is not whitelisted by the validated bundle manifest" });
        return;
      }
      sendFile(request, response, safeFile(directory, relativePath));
      return;
    } catch (error) {
      sendJson(request, response, 404, { error: error instanceof Error ? error.message : "Invalid candidate bundle" });
      return;
    }
  }
  if (requestPath === "/lab-config.json") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ controllerOrigin, editorOrigin, allowRemote, artifactMode: artifactMode || distMode }));
    return;
  }
  if (requestPath === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ok");
    return;
  }
  sendFile(request, response, safeFile(controllerRoot, requestPath === "/baseline-review/" ? "/baseline-review/index.html" : requestPath));
});

const editor = http.createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD", ...securityHeaders(true) });
    response.end("Method not allowed");
    return;
  }
  const requestPath = new URL(request.url, editorOrigin).pathname;
  if (requestPath === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ok");
    return;
  }
  if (artifactRoot && (requestPath === "/panel.js" || requestPath.startsWith("/styles/") || requestPath === "/manifest.json")) {
    sendFile(request, response, safeFile(artifactRoot, requestPath), true);
    return;
  }
  sendFile(request, response, safeFile(editorRoot, requestPath === "/" ? "/editor.html" : requestPath), true);
});

function listen(server, port, label) {
  server.listen(port, host, () => console.log(`[adocLIVE lab] ${label}: http://${host}:${port}`));
}

function shutdown() {
  controller.close();
  editor.close();
}

if (require.main === module) {
  for (const required of requiredLabFiles) {
    if (!fs.existsSync(required)) throw new Error(`Missing ${required}; run npm run lab:build first`);
  }
  listen(controller, controllerPort, "controller");
  listen(editor, editorPort, "editor");
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

module.exports = { artifactReferences, controller, editor, listCandidates, loadCandidate, safeFile, securityHeaders };
