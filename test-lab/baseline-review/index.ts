import {
  ArtifactReferenceV1Schema,
  BaselineCandidateBundleV1Schema,
  BaselineReviewDraftV1Schema,
  BaselineReviewReceiptV1Schema,
  NativePlatformEvidenceV1Schema,
  REVIEW_ITEM_IDS,
  SCROLL_CANDIDATE_ID,
  migrateDraftNotesToBundle,
  type ArtifactReferenceV1,
  type BaselineCandidateBundleV1,
  type BaselineReviewDraftV1,
} from "../../baseline/contracts";

interface RunSummary {
  bundleId: string;
  createdAt: string;
  sourceCommit: string;
  version: string;
  finalizable: boolean;
  draftReasons: string[];
  visualCount: number;
  auditTotal: number;
}

const byId = <T extends Element = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing baseline-review element #${id}`);
  return element as unknown as T;
};

const emptyDelta = () => ({
  installStartup: false,
  representativeRender: false,
  themeAndViewChanges: false,
  hostileFixture: false,
  upgrade: false,
});

let runs: RunSummary[] = [];
let manifest: BaselineCandidateBundleV1 | null = null;
let draft: BaselineReviewDraftV1 | null = null;
let selectedItemId: (typeof REVIEW_ITEM_IDS)[number] = REVIEW_ITEM_IDS[0];
let statusFilter = "all";
let zoom = 100;

function storageKey(digest: string): string {
  return `adoclive:baseline-review:v1:${digest}`;
}

function emptyDraft(bundleDigest: string): BaselineReviewDraftV1 {
  return BaselineReviewDraftV1Schema.parse({
    schemaVersion: 1,
    kind: "BaselineReviewDraft",
    bundleDigest,
    updatedAt: new Date().toISOString(),
    reviewer: "",
    decisions: REVIEW_ITEM_IDS.map(itemId => ({ itemId, decision: "unresolved", note: "" })),
    knownIssueAcknowledgements: { "ADL-022": false, "ADL-023": false },
    platformEvidence: ["windows", "macos"].map(platform => ({
      platform,
      joplinVersion: "",
      osVersion: "",
      date: "",
      verifier: "",
      result: "",
      deviations: "",
      hardenedJplDelta: emptyDelta(),
    })),
    overallRationale: "",
  });
}

function showError(error: unknown): void {
  const target = byId("page-error");
  target.textContent = error instanceof Error ? error.message : String(error);
  target.hidden = false;
}

function clearError(): void {
  byId("page-error").hidden = true;
}

function saveDraft(message = "Draft autosaved locally."): void {
  if (!draft) return;
  draft.updatedAt = new Date().toISOString();
  const parsed = BaselineReviewDraftV1Schema.parse(draft);
  localStorage.setItem(storageKey(parsed.bundleDigest), JSON.stringify(parsed));
  byId("autosave-status").textContent = message;
}

function downloadJson(fileName: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function artifactUrl(reference: ArtifactReferenceV1): string {
  if (!manifest) return "";
  const encoded = reference.path.split("/").map(segment => encodeURIComponent(segment)).join("/");
  return `/baseline-review/runs/${manifest.bundleDigest}/files/${encoded}`;
}

function decisionFor(itemId = selectedItemId) {
  const decision = draft?.decisions.find(item => item.itemId === itemId);
  if (!decision) throw new Error(`Draft is missing decision ${itemId}`);
  return decision;
}

function selectedVisual() {
  return manifest?.visuals.find(item => item.id === selectedItemId) || null;
}

function itemScenario(itemId: string): string {
  if (itemId === SCROLL_CANDIDATE_ID) return "30 runs · raw/live/raw mid-document";
  return manifest?.visuals.find(item => item.id === itemId)?.scenario || "visual evidence";
}

function appendDefinition(list: HTMLElement, term: string, description: string): void {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = term;
  dd.textContent = description;
  row.append(dt, dd);
  list.append(row);
}

function renderBundle(): void {
  const hasBundle = Boolean(manifest && draft);
  byId("empty-viewer").hidden = hasBundle;
  byId("visual-viewer").hidden = !hasBundle;
  byId("review-form").toggleAttribute("inert", !hasBundle);
  if (!manifest || !draft) return;

  byId("bundle-digest").textContent = manifest.bundleDigest;
  byId("source-commit").textContent = `${manifest.source.commit}${manifest.source.clean ? " · clean" : " · dirty"}`;
  byId("environment-summary").textContent = `${manifest.environment.playwrightVersion} · ${manifest.environment.container || manifest.environment.os}`;
  const canonicalBadge = byId("canonical-badge");
  canonicalBadge.textContent = manifest.environment.canonical ? "Canonical bundle" : "Draft environment";
  canonicalBadge.className = `badge ${manifest.environment.canonical ? "success" : "neutral"}`;
  byId("audit-badge").textContent = `Audit ${manifest.audit.counts.total}`;
  const reasons = byId("draft-reasons");
  reasons.hidden = manifest.draftReasons.length === 0;
  reasons.textContent = manifest.draftReasons.join(" ");

  const provenance = byId("artifact-provenance");
  provenance.replaceChildren();
  appendDefinition(provenance, "Source", manifest.source.commit);
  appendDefinition(provenance, "Clean", String(manifest.source.clean));
  appendDefinition(provenance, "Container", manifest.environment.container || "noncanonical local environment");
  appendDefinition(provenance, "Lock", manifest.lockfile.sha256);
  appendDefinition(provenance, "JPL", manifest.artifacts.jpl.sha256);
  appendDefinition(provenance, "npm tarball", manifest.artifacts.npmTarball.sha256);
  appendDefinition(provenance, "Manifest", manifest.artifacts.pluginManifest.sha256);
  appendDefinition(provenance, "Audit", `${manifest.audit.counts.total} production advisories · ${manifest.audit.report.sha256}`);
  appendDefinition(provenance, "Tests", `${manifest.tests.scope} · ${manifest.tests.passed ? "passed" : "failed"} · ${manifest.tests.report.sha256}`);
  renderQueue();
  populateDraftFields();
  renderSelectedItem();
  renderFinalization();
}

function renderQueue(): void {
  if (!draft) return;
  const search = byId<HTMLInputElement>("queue-search").value.trim().toLocaleLowerCase();
  const list = byId<HTMLOListElement>("queue-list");
  list.replaceChildren();
  for (const itemId of REVIEW_ITEM_IDS) {
    const decision = decisionFor(itemId);
    const searchable = `${itemId} ${itemScenario(itemId)}`.toLocaleLowerCase();
    const statusMatches = statusFilter === "all"
      || (statusFilter === "approved" && decision.decision === "approved")
      || (statusFilter === "unresolved" && decision.decision !== "approved");
    if (!searchable.includes(search) || !statusMatches) continue;
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "queue-row";
    button.dataset.itemId = itemId;
    button.setAttribute("aria-current", String(itemId === selectedItemId));
    const label = document.createElement("span");
    const name = document.createElement("strong");
    const scenario = document.createElement("span");
    name.textContent = itemId === SCROLL_CANDIDATE_ID ? "Scroll · raw/live/raw" : itemId;
    scenario.className = "scenario";
    scenario.textContent = itemScenario(itemId);
    label.append(name, scenario);
    const status = document.createElement("span");
    status.className = `status ${decision.decision}`;
    status.textContent = decision.decision === "approved" ? "✓ Approved"
      : decision.decision === "rejected" ? "✕ Rejected"
        : decision.decision === "regenerate" ? "↻ Regenerate" : "○ Unresolved";
    button.append(label, status);
    button.addEventListener("click", () => selectItem(itemId));
    row.append(button);
    list.append(row);
  }
  const approved = draft.decisions.filter(item => item.decision === "approved").length;
  const unresolved = draft.decisions.length - approved;
  byId("progress-output").textContent = `${approved} of ${draft.decisions.length} approved`;
  const progress = byId<HTMLProgressElement>("progress");
  progress.max = draft.decisions.length;
  progress.value = approved;
  progress.textContent = `${approved} of ${draft.decisions.length}`;
  byId("top-unresolved").textContent = String(unresolved);
}

function selectItem(itemId: (typeof REVIEW_ITEM_IDS)[number]): void {
  selectedItemId = itemId;
  renderQueue();
  renderSelectedItem();
  const current = document.querySelector<HTMLButtonElement>(`.queue-row[data-item-id="${CSS.escape(itemId)}"]`);
  current?.scrollIntoView({ block: "nearest" });
}

function metric(list: HTMLElement, label: string, value: string): void {
  appendDefinition(list, label, value);
}

function renderSelectedItem(): void {
  if (!manifest || !draft) return;
  const isScroll = selectedItemId === SCROLL_CANDIDATE_ID;
  byId("item-kind").textContent = isScroll ? "Scroll characterization" : "Visual evidence";
  byId("item-heading").textContent = isScroll ? "raw/live/raw · mid-document" : selectedItemId;
  byId("visual-viewer").hidden = isScroll;
  byId("scroll-viewer").hidden = !isScroll;
  const decision = decisionFor();
  byId("decision-status").textContent = decision.decision[0].toUpperCase() + decision.decision.slice(1);
  byId<HTMLTextAreaElement>("item-note").value = decision.note;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-decision]")) {
    button.dataset.active = String(button.dataset.decision === decision.decision);
  }

  if (isScroll) renderScroll();
  else renderVisual();
}

function renderVisual(): void {
  const visual = selectedVisual();
  if (!visual) return;
  const before = artifactUrl(visual.before);
  const candidate = artifactUrl(visual.candidate);
  const diff = artifactUrl(visual.diff);
  for (const [id, source] of [
    ["before-image", before], ["before-thumb", before],
    ["candidate-image", candidate], ["candidate-thumb", candidate],
    ["diff-image", diff], ["diff-thumb", diff],
  ] as const) byId<HTMLImageElement>(id).src = source;
  byId("item-hashes").textContent = `before ${visual.before.sha256}\ncandidate ${visual.candidate.sha256}\ndiff ${visual.diff.sha256}`;
  const metrics = byId("visual-metrics");
  metrics.replaceChildren();
  metric(metrics, "Dimensions", `${visual.metrics.width} × ${visual.metrics.height}`);
  metric(metrics, "Threshold", String(visual.metrics.threshold));
  metric(metrics, "Stability ε", `${visual.metrics.stabilityEpsilon} channel values`);
  metric(metrics, "Max ratio", String(visual.metrics.maxDiffPixelRatio));
  metric(metrics, "Changed pixels", visual.metrics.changedPixels.toLocaleString("en-US"));
  metric(metrics, "Diff ratio", visual.metrics.diffPixelRatio.toFixed(8));
  metric(metrics, "Max channel Δ", String(visual.metrics.maxChannelDelta));
  metric(metrics, "Dimensions match", visual.metrics.dimensionsMatch ? "yes" : "NO");
}

const svgNamespace = "http://www.w3.org/2000/svg";
function svgElement(name: string, attributes: Record<string, string>): SVGElement {
  const element = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function renderRunOrder(values: number[], ceiling: number): void {
  const svg = byId<SVGSVGElement>("run-order-chart");
  svg.replaceChildren();
  svg.setAttribute("viewBox", "0 0 600 180");
  const left = 34, right = 588, top = 12, bottom = 158;
  const maximum = Math.max(ceiling, ...values, 1);
  const x = (index: number) => left + index * (right - left) / (values.length - 1);
  const y = (value: number) => bottom - value / maximum * (bottom - top);
  svg.append(svgElement("line", { x1: String(left), y1: String(bottom), x2: String(right), y2: String(bottom), class: "chart-axis" }));
  svg.append(svgElement("line", { x1: String(left), y1: String(top), x2: String(left), y2: String(bottom), class: "chart-axis" }));
  svg.append(svgElement("line", { x1: String(left), y1: String(y(ceiling)), x2: String(right), y2: String(y(ceiling)), class: "chart-ceiling" }));
  const polyline = svgElement("polyline", { points: values.map((value, index) => `${x(index)},${y(value)}`).join(" "), fill: "none", class: "chart-mark" });
  svg.append(polyline);
  values.forEach((value, index) => svg.append(svgElement("circle", { cx: String(x(index)), cy: String(y(value)), r: "2.5", class: "chart-mark" })));
  for (const [label, tx, ty] of [["0", 12, bottom + 3], [ceiling.toFixed(1), 2, y(ceiling) + 3], ["run 1", left, 174], ["run 30", right - 34, 174]] as const) {
    const text = svgElement("text", { x: String(tx), y: String(ty), class: "chart-text" });
    text.textContent = label;
    svg.append(text);
  }
}

function renderDistribution(values: number[]): void {
  const svg = byId<SVGSVGElement>("distribution-chart");
  svg.replaceChildren();
  svg.setAttribute("viewBox", "0 0 280 180");
  const bins = 8;
  const maximum = Math.max(...values, 1);
  const counts = Array.from({ length: bins }, () => 0);
  for (const value of values) counts[Math.min(bins - 1, Math.floor(value / maximum * bins))] += 1;
  const top = 12, bottom = 158, left = 28, right = 270;
  const maxCount = Math.max(...counts, 1);
  svg.append(svgElement("line", { x1: String(left), y1: String(bottom), x2: String(right), y2: String(bottom), class: "chart-axis" }));
  counts.forEach((count, index) => {
    const width = (right - left) / bins - 3;
    const height = count / maxCount * (bottom - top);
    svg.append(svgElement("rect", { x: String(left + index * (right - left) / bins + 1), y: String(bottom - height), width: String(width), height: String(height), class: "chart-mark" }));
  });
  for (const [label, tx] of [["0 px", left], [`${maximum.toFixed(0)} px`, right - 42]] as const) {
    const text = svgElement("text", { x: String(tx), y: "174", class: "chart-text" });
    text.textContent = label;
    svg.append(text);
  }
}

function renderScroll(): void {
  if (!manifest) return;
  const scroll = manifest.scroll;
  byId("item-hashes").textContent = `evidence ${scroll.evidence.sha256}\nmedian frames ${scroll.frames.medianBefore.sha256.slice(0, 16)}…\nworst frames ${scroll.frames.worstBefore.sha256.slice(0, 16)}…`;
  const metrics = byId("scroll-metrics");
  metrics.replaceChildren();
  metric(metrics, "Runs", String(scroll.runs));
  metric(metrics, "Median", `${scroll.medianPx} px`);
  metric(metrics, "p99", `${scroll.p99Px} px`);
  metric(metrics, "MAD", `${scroll.madPx} px`);
  metric(metrics, "Raw line height", `${scroll.rawLineHeightPx} px`);
  metric(metrics, "Rounding margin", `${scroll.roundingMarginPx} px`);
  metric(metrics, "Regression ceiling", `${scroll.regressionCeilingPx} px`);
  metric(metrics, "Quarter-line safety", `${scroll.quarterLineSafetyPx} px · expected failing`);
  renderRunOrder(scroll.valuesPx, scroll.regressionCeilingPx);
  renderDistribution(scroll.valuesPx);
  const body = byId<HTMLTableSectionElement>("scroll-values");
  body.replaceChildren(...scroll.valuesPx.map((value, index) => {
    const row = document.createElement("tr");
    const run = document.createElement("td");
    const displacement = document.createElement("td");
    run.textContent = String(index + 1);
    displacement.textContent = String(value);
    row.append(run, displacement);
    return row;
  }));
  const frames = byId("scroll-frames");
  frames.replaceChildren();
  for (const [label, reference] of [
    ["Median · before", scroll.frames.medianBefore],
    ["Median · after", scroll.frames.medianAfter],
    ["Worst · before", scroll.frames.worstBefore],
    ["Worst · after", scroll.frames.worstAfter],
  ] as const) {
    const figure = document.createElement("figure");
    const caption = document.createElement("figcaption");
    const image = document.createElement("img");
    caption.textContent = label;
    image.alt = `${label} scroll key frame`;
    image.src = artifactUrl(reference);
    figure.append(caption, image);
    frames.append(figure);
  }
}

function nativeForm(platform: "windows" | "macos"): HTMLElement {
  const form = document.querySelector<HTMLElement>(`.native-evidence[data-platform="${platform}"]`);
  if (!form) throw new Error(`Missing ${platform} evidence form`);
  return form;
}

function readNativeForm(platform: "windows" | "macos") {
  const form = nativeForm(platform);
  const value = (name: string) => form.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`)!.value;
  const checked = (name: string) => form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.checked;
  return {
    platform,
    joplinVersion: value("joplinVersion"),
    osVersion: value("osVersion"),
    date: value("date"),
    verifier: value("verifier"),
    result: value("result"),
    deviations: value("deviations"),
    hardenedJplDelta: {
      installStartup: checked("installStartup"),
      representativeRender: checked("representativeRender"),
      themeAndViewChanges: checked("themeAndViewChanges"),
      hostileFixture: checked("hostileFixture"),
      upgrade: checked("upgrade"),
    },
  };
}

function populateNativeForm(platform: "windows" | "macos"): void {
  if (!draft) return;
  const evidence = draft.platformEvidence.find(item => item.platform === platform)!;
  const form = nativeForm(platform);
  for (const name of ["joplinVersion", "osVersion", "date", "verifier", "result", "deviations"] as const) {
    form.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`)!.value = evidence[name];
  }
  for (const [name, checked] of Object.entries(evidence.hardenedJplDelta)) form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.checked = checked;
}

function populateDraftFields(): void {
  if (!draft) return;
  byId<HTMLInputElement>("reviewer").value = draft.reviewer;
  byId<HTMLTextAreaElement>("overall-rationale").value = draft.overallRationale;
  byId<HTMLInputElement>("ack-adl-022").checked = draft.knownIssueAcknowledgements["ADL-022"];
  byId<HTMLInputElement>("ack-adl-023").checked = draft.knownIssueAcknowledgements["ADL-023"];
  populateNativeForm("windows");
  populateNativeForm("macos");
}

function syncDraftFromForm(): void {
  if (!draft) return;
  draft.reviewer = byId<HTMLInputElement>("reviewer").value;
  draft.overallRationale = byId<HTMLTextAreaElement>("overall-rationale").value;
  draft.knownIssueAcknowledgements = {
    "ADL-022": byId<HTMLInputElement>("ack-adl-022").checked,
    "ADL-023": byId<HTMLInputElement>("ack-adl-023").checked,
  };
  draft.platformEvidence = [readNativeForm("windows"), readNativeForm("macos")] as BaselineReviewDraftV1["platformEvidence"];
}

function nativeReceipt(platform: "windows" | "macos") {
  return NativePlatformEvidenceV1Schema.safeParse({ schemaVersion: 1, ...readNativeForm(platform) });
}

function finalizationBlockers(): string[] {
  if (!manifest || !draft) return ["No validated candidate bundle is selected."];
  const blockers: string[] = [];
  if (!manifest.finalizable) blockers.push(...manifest.draftReasons);
  if (!manifest.environment.canonical) blockers.push("The candidate environment is not canonical Playwright 1.61.1 Noble.");
  if (!manifest.source.clean) blockers.push("The candidate source was not a clean commit.");
  if (manifest.audit.counts.total !== 0) blockers.push("The candidate contains production dependency advisories.");
  const unresolved = draft.decisions.filter(item => item.decision !== "approved");
  if (unresolved.length) blockers.push(`${unresolved.length} evidence item(s) remain unresolved, rejected, or marked regenerate.`);
  if (!draft.knownIssueAcknowledgements["ADL-022"] || !draft.knownIssueAcknowledgements["ADL-023"]) blockers.push("Both ADL-022 and ADL-023 acknowledgements are required.");
  if (!draft.reviewer.trim()) blockers.push("A named reviewer is required.");
  if (!draft.overallRationale.trim()) blockers.push("An overall review rationale is required.");
  for (const platform of ["windows", "macos"] as const) {
    const result = nativeReceipt(platform);
    const error = nativeForm(platform).querySelector<HTMLElement>(".platform-error")!;
    error.textContent = result.success ? "" : `${platform === "windows" ? "Windows" : "macOS"} evidence is incomplete or does not pass every delta case.`;
    for (const field of nativeForm(platform).querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")) {
      field.setAttribute("aria-invalid", String(!result.success));
    }
    if (!result.success) blockers.push(error.textContent);
  }
  return [...new Set(blockers)];
}

function renderFinalization(): void {
  const blockers = finalizationBlockers();
  const list = byId("finalization-blockers");
  list.replaceChildren(...blockers.map(message => {
    const item = document.createElement("li");
    item.textContent = message;
    return item;
  }));
  byId<HTMLButtonElement>("finalize").disabled = blockers.length > 0;
}

function referencedHashes(value: unknown, output: Record<string, string> = {}): Record<string, string> {
  if (Array.isArray(value)) {
    value.forEach(child => referencedHashes(child, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const reference = ArtifactReferenceV1Schema.safeParse(value);
  if (reference.success) {
    output[reference.data.path] = reference.data.sha256;
    return output;
  }
  Object.values(value as Record<string, unknown>).forEach(child => referencedHashes(child, output));
  return output;
}

function finalizeReceipt(): void {
  if (!manifest || !draft) return;
  syncDraftFromForm();
  const blockers = finalizationBlockers();
  if (blockers.length) {
    renderFinalization();
    throw new Error(`Receipt remains blocked:\n- ${blockers.join("\n- ")}`);
  }
  const receipt = BaselineReviewReceiptV1Schema.parse({
    schemaVersion: 1,
    kind: "BaselineReviewReceipt",
    bundleDigest: manifest.bundleDigest,
    sourceCommit: manifest.source.commit,
    artifactHashes: referencedHashes(manifest),
    reviewer: draft.reviewer,
    reviewedAt: new Date().toISOString(),
    decisions: draft.decisions,
    knownIssueAcknowledgements: draft.knownIssueAcknowledgements,
    platformEvidence: [nativeReceipt("windows").data, nativeReceipt("macos").data],
    overallRationale: draft.overallRationale,
  });
  downloadJson(`adoclive-baseline-receipt-${manifest.bundleDigest}.json`, receipt);
  byId("autosave-status").textContent = "Hash-bound receipt generated. The repository has not been modified.";
}

async function selectBundle(bundleId: string): Promise<void> {
  clearError();
  const previousDraft = draft;
  const response = await fetch(`/baseline-review/runs/${encodeURIComponent(bundleId)}/manifest`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load bundle ${bundleId}: ${response.status}`);
  manifest = BaselineCandidateBundleV1Schema.parse(await response.json());
  const stored = localStorage.getItem(storageKey(manifest.bundleDigest));
  if (stored) {
    draft = BaselineReviewDraftV1Schema.parse(JSON.parse(stored));
    byId("autosave-status").textContent = "Recovered the locally autosaved draft for this digest.";
  } else if (previousDraft && previousDraft.bundleDigest !== manifest.bundleDigest) {
    draft = migrateDraftNotesToBundle(previousDraft, manifest.bundleDigest, new Date().toISOString());
    saveDraft("Migrated item notes to the replacement bundle; every decision was reset.");
  } else {
    draft = emptyDraft(manifest.bundleDigest);
    saveDraft("Started a new local review draft.");
  }
  selectedItemId = REVIEW_ITEM_IDS[0];
  renderBundle();
}

async function loadRuns(): Promise<void> {
  const response = await fetch("/baseline-review/runs", { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to list candidate bundles: ${response.status}`);
  const input = await response.json() as { schemaVersion?: unknown; runs?: unknown };
  if (input.schemaVersion !== 1 || !Array.isArray(input.runs)) throw new Error("Candidate-run API returned an unsupported schema");
  runs = input.runs as RunSummary[];
  const select = byId<HTMLSelectElement>("bundle-select");
  select.replaceChildren();
  if (!runs.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No validated candidate bundles";
    select.append(option);
    byId("empty-viewer").hidden = false;
    return;
  }
  for (const run of runs) {
    const option = document.createElement("option");
    option.value = run.bundleId;
    option.textContent = `${run.version} · ${run.createdAt.slice(0, 10)} · ${run.finalizable ? "canonical" : "draft"} · ${run.bundleId.slice(0, 12)}…`;
    select.append(option);
  }
  await selectBundle(runs[0].bundleId);
}

function changeDecision(decision: "approved" | "rejected" | "regenerate"): void {
  if (!draft) return;
  const current = decisionFor();
  const note = byId<HTMLTextAreaElement>("item-note");
  if ((decision === "rejected" || decision === "regenerate") && !note.value.trim()) {
    note.setCustomValidity("A note is required to reject or request regeneration.");
    note.reportValidity();
    note.focus();
    return;
  }
  note.setCustomValidity("");
  current.note = note.value;
  current.decision = decision;
  saveDraft();
  renderQueue();
  renderSelectedItem();
  renderFinalization();
  const currentIndex = REVIEW_ITEM_IDS.indexOf(selectedItemId);
  const next = REVIEW_ITEM_IDS.slice(currentIndex + 1).find(itemId => decisionFor(itemId).decision !== "approved")
    || REVIEW_ITEM_IDS.find(itemId => decisionFor(itemId).decision !== "approved");
  if (decision === "approved" && next) selectItem(next);
}

function wireControls(): void {
  byId<HTMLSelectElement>("bundle-select").addEventListener("change", event => void selectBundle((event.target as HTMLSelectElement).value).catch(showError));
  byId<HTMLInputElement>("queue-search").addEventListener("input", renderQueue);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-status-filter]")) button.addEventListener("click", () => {
    statusFilter = button.dataset.statusFilter || "all";
    document.querySelectorAll<HTMLButtonElement>("[data-status-filter]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    renderQueue();
  });
  byId("approve").addEventListener("click", () => changeDecision("approved"));
  byId("reject").addEventListener("click", () => changeDecision("rejected"));
  byId("regenerate").addEventListener("click", () => changeDecision("regenerate"));
  byId<HTMLTextAreaElement>("item-note").addEventListener("input", event => {
    if (!draft) return;
    const current = decisionFor();
    current.note = (event.target as HTMLTextAreaElement).value;
    if (!current.note.trim() && (current.decision === "rejected" || current.decision === "regenerate")) current.decision = "unresolved";
    saveDraft();
    renderQueue();
    renderFinalization();
  });
  byId("review-form").addEventListener("input", () => {
    if (!draft) return;
    syncDraftFromForm();
    saveDraft();
    renderFinalization();
  });
  byId("review-form").addEventListener("change", () => {
    if (!draft) return;
    syncDraftFromForm();
    saveDraft();
    renderFinalization();
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view-mode]")) button.addEventListener("click", () => {
    const mode = button.dataset.viewMode || "split";
    byId("image-stage").dataset.mode = mode;
    document.querySelectorAll<HTMLButtonElement>("[data-view-mode]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    byId<HTMLInputElement>("overlay-opacity").disabled = mode !== "overlay";
    byId<HTMLImageElement>("candidate-image").style.opacity = mode === "overlay"
      ? String(Number(byId<HTMLInputElement>("overlay-opacity").value) / 100)
      : "1";
  });
  const applyZoom = () => {
    const stage = byId("image-stage");
    stage.style.transform = `scale(${zoom / 100})`;
    stage.style.width = `${10000 / zoom}%`;
    byId("zoom-output").textContent = `${zoom}%`;
  };
  byId("zoom-out").addEventListener("click", () => { zoom = Math.max(50, zoom - 10); applyZoom(); });
  byId("zoom-in").addEventListener("click", () => { zoom = Math.min(200, zoom + 10); applyZoom(); });
  byId("zoom-fit").addEventListener("click", () => {
    const image = byId<HTMLImageElement>("before-image");
    const viewport = byId("comparison-viewport");
    zoom = image.naturalWidth > 0 ? Math.max(50, Math.min(200, Math.floor(viewport.clientWidth / image.naturalWidth * 100))) : 100;
    applyZoom();
  });
  byId("zoom-reset").addEventListener("click", () => { zoom = 100; applyZoom(); byId("comparison-viewport").scrollTo(0, 0); });
  byId<HTMLInputElement>("overlay-opacity").addEventListener("input", event => {
    byId<HTMLImageElement>("candidate-image").style.opacity = String(Number((event.target as HTMLInputElement).value) / 100);
  });

  byId("export-draft").addEventListener("click", () => {
    if (!draft) return;
    syncDraftFromForm();
    saveDraft();
    downloadJson(`adoclive-baseline-draft-${draft.bundleDigest}.json`, draft);
  });
  byId<HTMLInputElement>("import-draft").addEventListener("change", async event => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !manifest) return;
    try {
      const imported = BaselineReviewDraftV1Schema.parse(JSON.parse(await file.text()));
      draft = imported.bundleDigest === manifest.bundleDigest
        ? imported
        : migrateDraftNotesToBundle(imported, manifest.bundleDigest, new Date().toISOString());
      saveDraft(imported.bundleDigest === manifest.bundleDigest ? "Imported and autosaved this bundle's draft." : "Imported notes from another bundle; every decision was reset.");
      renderBundle();
    } catch (error) {
      showError(error);
    } finally {
      (event.target as HTMLInputElement).value = "";
    }
  });
  byId("finalize").addEventListener("click", () => {
    try { finalizeReceipt(); } catch (error) { showError(error); }
  });

  document.addEventListener("keydown", event => {
    const target = event.target as HTMLElement | null;
    if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
    const index = REVIEW_ITEM_IDS.indexOf(selectedItemId);
    let next: (typeof REVIEW_ITEM_IDS)[number] | undefined;
    if (event.key.toLocaleLowerCase() === "j") next = REVIEW_ITEM_IDS[(index + 1) % REVIEW_ITEM_IDS.length];
    if (event.key.toLocaleLowerCase() === "k") next = REVIEW_ITEM_IDS[(index - 1 + REVIEW_ITEM_IDS.length) % REVIEW_ITEM_IDS.length];
    if (event.key.toLocaleLowerCase() === "u" && draft) next = REVIEW_ITEM_IDS.slice(index + 1).find(itemId => decisionFor(itemId).decision !== "approved")
      || REVIEW_ITEM_IDS.find(itemId => decisionFor(itemId).decision !== "approved");
    if (next) {
      event.preventDefault();
      selectItem(next);
      document.querySelector<HTMLButtonElement>(`.queue-row[data-item-id="${CSS.escape(next)}"]`)?.focus();
    }
  });
}

wireControls();
loadRuns().catch(showError);
