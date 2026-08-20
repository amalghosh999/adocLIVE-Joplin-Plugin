import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";
import { LabPage } from "./helpers/lab-page";

const baseline = JSON.parse(fs.readFileSync(path.resolve("tests/browser/baselines/performance.json"), "utf8")) as {
  approved: boolean;
  inputMedianMs: Record<string, number>;
  relativeRegressionPercent: number;
  relativeMinimumMs: number;
};
const ceilings: Record<number, number> = { 1_000: 50, 5_000: 100, 10_000: 200, 20_000: 400 };

const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];

async function inputToNextPaint(lab: LabPage): Promise<number> {
  const content = lab.editor().locator(".cm-content");
  await content.click();
  await content.evaluate(element => {
    (globalThis as any).__adocInputMeasurement = null;
    let start = 0;
    const onKey = () => { start = performance.now(); };
    const onInput = () => requestAnimationFrame(() => { (globalThis as any).__adocInputMeasurement = performance.now() - start; });
    element.addEventListener("keydown", onKey, { once: true, capture: true });
    element.addEventListener("input", onInput, { once: true });
  });
  await content.press("a");
  await expect.poll(() => content.evaluate(() => (globalThis as any).__adocInputMeasurement), { timeout: 5_000 }).not.toBeNull();
  return content.evaluate(() => (globalThis as any).__adocInputMeasurement as number);
}

async function calibration(lab: LabPage): Promise<number> {
  return lab.editor().locator("body").evaluate(() => new Promise<number>(resolve => {
    const samples: number[] = [];
    let previous = performance.now();
    const tick = (now: number) => {
      samples.push(now - previous);
      previous = now;
      if (samples.length === 10) resolve(samples.sort((a, b) => a - b)[4]);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}

for (const lines of [1_000, 5_000, 10_000, 20_000]) {
  test(`@perf ${lines} lines input p95 meets the absolute and relative contract`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const lab = new LabPage(page);
    await lab.open();
    await lab.setFixture(`scale-${lines}`);
    await lab.editor().locator("html").evaluate(element => { element.dataset.adocLabDiagnostics = "false"; });
    let calibrationMs = await calibration(lab);
    if (calibrationMs < 5 || calibrationMs > 40) calibrationMs = await calibration(lab);
    expect(calibrationMs, "persistent calibration failure").toBeGreaterThanOrEqual(5);
    expect(calibrationMs, "persistent calibration failure").toBeLessThanOrEqual(40);

    for (let warmup = 0; warmup < 3; warmup += 1) await inputToNextPaint(lab);
    const samples: number[] = [];
    for (let sample = 0; sample < 12; sample += 1) samples.push(await inputToNextPaint(lab));
    const median = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);
    if (process.env.ADOC_LAB_PRINT_METRICS === "1") console.log(`ADOC_PERF_METRICS=${JSON.stringify({ lines, calibrationMs, samples, median, p95 })}`);
    await testInfo.attach(`performance-${lines}.json`, {
      body: JSON.stringify({ lines, calibrationMs, samples, median, p95 }, null, 2),
      contentType: "application/json",
    });
    expect(p95).toBeLessThanOrEqual(ceilings[lines]);
    if (baseline.approved) {
      const approved = baseline.inputMedianMs[String(lines)];
      const delta = median - approved;
      const percent = approved > 0 ? delta / approved * 100 : 0;
      expect(percent > baseline.relativeRegressionPercent && delta >= baseline.relativeMinimumMs, `median ${median} ms regressed from ${approved} ms`).toBe(false);
    }
  });
}

test("@perf records cursor, mode, overlay, mutation, long-task, and layout responsiveness", async ({ page }, testInfo) => {
  const lab = new LabPage(page);
  await lab.open();
  await lab.setFixture("scale-1000");
  const content = lab.editor().locator(".cm-content");
  const observations = await lab.editor().locator("body").evaluate(() => {
    const state = { mutations: 0, longTasks: [] as number[], layoutShifts: [] as number[] };
    new MutationObserver(records => { state.mutations += records.length; }).observe(document.body, { subtree: true, attributes: true, childList: true });
    try {
      new PerformanceObserver(list => state.longTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: "longtask", buffered: true });
      new PerformanceObserver(list => state.layoutShifts.push(...list.getEntries().map(entry => (entry as any).value || 0))).observe({ type: "layout-shift", buffered: true });
    } catch {}
    (globalThis as any).__adocPerfObservations = state;
    return true;
  });
  expect(observations).toBe(true);

  await content.evaluate(element => {
    (globalThis as any).__adocCursorMeasurement = null;
    let start = 0;
    element.addEventListener("keydown", () => { start = performance.now(); }, { once: true, capture: true });
    element.addEventListener("keyup", () => requestAnimationFrame(() => { (globalThis as any).__adocCursorMeasurement = performance.now() - start; }), { once: true });
  });
  await content.press("ArrowDown");
  await expect.poll(() => content.evaluate(() => (globalThis as any).__adocCursorMeasurement)).not.toBeNull();
  const cursorMs = await content.evaluate(() => (globalThis as any).__adocCursorMeasurement as number);

  const measureEditKey = async (key: string, slot: string): Promise<number> => {
    await content.evaluate((element, name) => {
      (globalThis as any)[name] = null;
      element.addEventListener("keydown", () => {
        const start = performance.now();
        requestAnimationFrame(() => { (globalThis as any)[name] = performance.now() - start; });
      }, { once: true, capture: true });
    }, slot);
    await content.press(key);
    await expect.poll(() => content.evaluate((_element, name) => (globalThis as any)[name] ?? -1, slot)).toBeGreaterThanOrEqual(0);
    return content.evaluate((_element, name) => (globalThis as any)[name] as number, slot);
  };
  const lineInsertMs = await measureEditKey("Enter", "__adocLineInsertMeasurement");
  const lineRemoveMs = await measureEditKey("Backspace", "__adocLineRemoveMeasurement");

  await lab.editor().getByRole("button", { name: "View", exact: true }).click();
  const modeButton = lab.editor().locator('[data-testid="view-mode-split"]');
  await modeButton.evaluate(element => {
    (globalThis as any).__adocModeMeasurement = null;
    element.addEventListener("click", () => {
      const start = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => { (globalThis as any).__adocModeMeasurement = performance.now() - start; }));
    }, { once: true });
  });
  await modeButton.click();
  await expect.poll(() => modeButton.evaluate(() => (globalThis as any).__adocModeMeasurement)).not.toBeNull();
  const modeMs = await modeButton.evaluate(() => (globalThis as any).__adocModeMeasurement as number);
  const captured = await lab.editor().locator("body").evaluate(() => (globalThis as any).__adocPerfObservations);

  const themeStart = performance.now();
  await lab.push("editor-1", { type: "updateEditorTheme", editorTheme: "dark", mermaidThemeVariables: "{}", isDark: true });
  await expect(lab.editor().locator("#asciidoc-editor-root")).toHaveClass(/dark-theme/);
  const themeMs = performance.now() - themeStart;

  await lab.editor().getByRole("button", { name: "View", exact: true }).click();
  const zoom = lab.editor().locator(".ribbon-zoom-slider");
  const zoomStart = performance.now();
  await zoom.fill("120");
  await lab.editor().locator("body").evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const zoomMs = performance.now() - zoomStart;

  const rafGaps = await lab.editor().locator("body").evaluate(() => new Promise<number[]>(resolve => {
    const values: number[] = [];
    let previous = performance.now();
    const next = (now: number) => {
      values.push(now - previous);
      previous = now;
      if (values.length >= 30) resolve(values);
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  }));

  await lab.setFixture("tables-code");
  const block = lab.editor().locator(".cm-lp-codeblock").first();
  await expect(block).toBeVisible();
  const overlayStart = performance.now();
  await block.dblclick();
  await expect(lab.editor().locator(".cm-lp-block-editor-overlay")).toBeVisible();
  const overlayMs = performance.now() - overlayStart;

  const diagnostics = ((await lab.state() as any).diagnostics as any[]);
  const diagnosticDurations = diagnostics.flatMap((start: any, index: number) => {
    if (start.phase !== "start") return [];
    const end = diagnostics.slice(index + 1).find((candidate: any) => candidate.sessionId === start.sessionId
      && candidate.area === start.area && candidate.name === start.name && candidate.phase === "end");
    return end ? [{ area: start.area, name: start.name, duration: end.timestamp - start.timestamp }] : [];
  });
  await testInfo.attach("responsiveness.json", {
    body: JSON.stringify({ cursorMs, lineInsertMs, lineRemoveMs, modeMs, themeMs, zoomMs, overlayMs, rafGaps, diagnosticDurations, ...captured }, null, 2),
    contentType: "application/json",
  });
  expect(cursorMs).toBeLessThan(100);
  expect(lineInsertMs).toBeLessThan(100);
  expect(lineRemoveMs).toBeLessThan(100);
  expect(modeMs).toBeLessThan(400);
  expect(themeMs).toBeLessThan(400);
  expect(zoomMs).toBeLessThan(400);
  expect(overlayMs).toBeLessThan(400);
  expect(percentile(rafGaps, 0.95)).toBeLessThan(100);
});
