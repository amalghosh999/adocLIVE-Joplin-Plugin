import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";
import { LabPage } from "./helpers/lab-page";

interface ScrollBaseline {
  approved: boolean;
  scenarios: Record<string, { runs: number; p99Px: number; madPx: number; roundingMarginPx: number; maxDisplacementPx: number }>;
}

const baselinePath = path.resolve("tests/browser/baselines/scroll/scroll-bounds.json");
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as ScrollBaseline;

async function visibleAnchor(lab: LabPage) {
  return lab.editor().locator(".cm-scroller").evaluate(scroller => {
    const scrollerRect = scroller.getBoundingClientRect();
    const lines = [...scroller.querySelectorAll<HTMLElement>(".cm-line")];
    const line = lines.find(candidate => {
      const rect = candidate.getBoundingClientRect();
      return rect.top >= scrollerRect.top + scrollerRect.height * 0.25 && rect.bottom <= scrollerRect.bottom;
    });
    if (!line) throw new Error("No visible source anchor");
    const rect = line.getBoundingClientRect();
    return { text: line.textContent || "", top: rect.top, height: rect.height, scrollTop: (scroller as HTMLElement).scrollTop, scrollHeight: (scroller as HTMLElement).scrollHeight };
  });
}

async function anchorByText(lab: LabPage, text: string) {
  return lab.editor().locator(".cm-scroller").evaluate((scroller, anchorText) => {
    const line = [...scroller.querySelectorAll<HTMLElement>(".cm-line")].find(candidate => candidate.textContent === anchorText);
    if (!line) throw new Error(`Source anchor disappeared: ${anchorText}`);
    const rect = line.getBoundingClientRect();
    return { top: rect.top, height: rect.height, scrollTop: (scroller as HTMLElement).scrollTop, scrollHeight: (scroller as HTMLElement).scrollHeight };
  }, text);
}

async function clickMode(lab: LabPage, testId: string): Promise<void> {
  const frame = lab.editor();
  await frame.getByRole("button", { name: "View", exact: true }).click();
  await frame.locator(`[data-testid="${testId}"]`).click();
  await frame.locator("body").evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await new Promise(resolve => setTimeout(resolve, 100));
  });
}

function percentile(values: number[], p: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * p) - 1)] ?? 0;
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

test("@scroll characterizes 30 raw/live/raw source-anchor transitions", async ({ page }, testInfo) => {
  test.fail(true, "ADL-022: current raw/live/raw transition exceeds the unexplained quarter-line bound");
  test.setTimeout(120_000);
  const lab = new LabPage(page);
  await lab.open();
  await lab.setFixture("scroll-characterization");
  await lab.setView("raw");
  await lab.editor().locator(".cm-scroller").evaluate(scroller => {
    (scroller as HTMLElement).scrollTop = ((scroller as HTMLElement).scrollHeight - (scroller as HTMLElement).clientHeight) * 0.5;
  });
  await lab.editor().locator("body").evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const displacements: number[] = [];
  const candidateDir = process.env.ADOC_SCROLL_CANDIDATE_DIR;
  const runFrameDir = candidateDir ? path.join(candidateDir, "run-frames") : "";
  if (candidateDir) {
    fs.mkdirSync(runFrameDir, { recursive: true });
    await lab.editor().locator("html").evaluate(element => {
      element.classList.add("visual-test");
      const style = document.createElement("style");
      style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important}.cm-cursor{visibility:hidden!important}";
      document.head.appendChild(style);
    });
  }
  let representativeLineHeight = 0;
  for (let run = 0; run < 30; run += 1) {
    const before = await visibleAnchor(lab);
    representativeLineHeight = before.height;
    if (candidateDir) await page.locator("iframe[data-session-id=editor-1]").screenshot({ path: path.join(runFrameDir, `${run}-before.png`), animations: "disabled", caret: "hide" });
    await clickMode(lab, "view-mode-live-preview");
    await clickMode(lab, "view-mode-raw-only");
    const after = await anchorByText(lab, before.text);
    const displacement = Math.abs(after.top - before.top);
    displacements.push(displacement);
    if (candidateDir) await page.locator("iframe[data-session-id=editor-1]").screenshot({ path: path.join(runFrameDir, `${run}-after.png`), animations: "disabled", caret: "hide" });
  }

  const result = {
    scenario: "raw-live-raw-mid-document",
    runs: displacements.length,
    valuesPx: displacements,
    medianPx: median(displacements),
    p99Px: percentile(displacements, 0.99),
    madPx: median(displacements.map(value => Math.abs(value - median(displacements)))),
    rawLineHeightPx: representativeLineHeight,
    browser: testInfo.project.name,
    approvedBaseline: baseline.approved,
  };
  if (process.env.ADOC_LAB_PRINT_METRICS === "1") console.log(`ADOC_SCROLL_METRICS=${JSON.stringify(result)}`);
  await testInfo.attach("scroll-characterization.json", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  if (candidateDir) {
    const medianIndex = displacements.reduce((best, value, index) => Math.abs(value - result.medianPx) < Math.abs(displacements[best] - result.medianPx) ? index : best, 0);
    const worstIndex = displacements.reduce((best, value, index) => value > displacements[best] ? index : best, 0);
    for (const [target, run, phase] of [
      ["median-before.png", medianIndex, "before"],
      ["median-after.png", medianIndex, "after"],
      ["worst-before.png", worstIndex, "before"],
      ["worst-after.png", worstIndex, "after"],
    ] as const) fs.copyFileSync(path.join(runFrameDir, `${run}-${phase}.png`), path.join(candidateDir, target));
    fs.writeFileSync(path.join(candidateDir, "scroll-characterization.json"), `${JSON.stringify({ ...result, medianRun: medianIndex + 1, worstRun: worstIndex + 1 }, null, 2)}\n`);
    fs.rmSync(runFrameDir, { recursive: true, force: true });
  }
  expect(Math.max(...displacements), "an unexplained jump exceeded one quarter of a raw line").toBeLessThanOrEqual(representativeLineHeight / 4 + 0.5);
  if (baseline.approved) {
    expect(result.p99Px).toBeLessThanOrEqual(baseline.scenarios[result.scenario].maxDisplacementPx);
  }
});

test("@scroll honors mathematically clamped top and bottom view transitions", async ({ page }) => {
  test.fail(true, "ADL-023: current bottom clamp is not retained across view transitions");
  const lab = new LabPage(page);
  await lab.open();
  await lab.setFixture("scroll-characterization");
  await lab.setView("raw");
  const scroller = lab.editor().locator(".cm-scroller");
  for (const edge of ["top", "bottom"] as const) {
    await scroller.evaluate((element, target) => {
      const value = element as HTMLElement;
      value.scrollTop = target === "top" ? 0 : value.scrollHeight - value.clientHeight;
    }, edge);
    await clickMode(lab, "view-mode-live-preview");
    await clickMode(lab, "view-mode-raw-only");
    const geometry = await scroller.evaluate(element => ({ scrollTop: (element as HTMLElement).scrollTop, max: (element as HTMLElement).scrollHeight - (element as HTMLElement).clientHeight }));
    if (edge === "top") expect(geometry.scrollTop).toBeGreaterThanOrEqual(0);
    else expect(Math.abs(geometry.max - geometry.scrollTop)).toBeLessThanOrEqual(1);
  }
});

test("@scroll survives real wheel input during delayed measurement and repeated pointer toggles", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  await lab.setFixture("scroll-characterization");
  const scroller = lab.editor().locator(".cm-scroller");
  await scroller.hover();
  await page.mouse.wheel(0, 800);
  const before = await visibleAnchor(lab);
  await clickMode(lab, "view-mode-raw-only");
  await scroller.hover();
  await page.mouse.wheel(0, 120);
  await clickMode(lab, "view-mode-live-preview");
  await clickMode(lab, "view-mode-raw-only");
  const geometry = await scroller.evaluate(element => ({ top: (element as HTMLElement).scrollTop, max: (element as HTMLElement).scrollHeight - (element as HTMLElement).clientHeight }));
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.top).toBeLessThanOrEqual(geometry.max + 1);
  expect(before.height).toBeGreaterThan(0);
});

test("@scroll covers source clicks, keyboard navigation, range drag, pointer cancel, TOC, zoom, margin, and theme", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  const frame = lab.editor();
  const tocLink = frame.locator(".cm-lp-toc-link").last();
  await expect(tocLink).toBeVisible();
  await tocLink.click();
  const scroller = frame.locator(".cm-scroller");
  const afterToc = await scroller.evaluate(element => (element as HTMLElement).scrollTop);
  expect(afterToc).toBeGreaterThanOrEqual(0);

  const previewLine = frame.locator(".cm-live-preview-line").first();
  await previewLine.click();
  await frame.locator(".cm-content").press("ArrowDown");
  await frame.locator(".cm-content").press("ArrowUp");
  await expect(frame.locator(".cm-content")).toBeFocused();

  await lab.setFixture("scroll-characterization");
  await lab.setView("raw");
  const lines = lab.editor().locator(".cm-line");
  const start = await lines.nth(2).boundingBox();
  const end = await lines.nth(5).boundingBox();
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  await lab.editor().locator("body").evaluate(() => {
    (globalThis as any).__adocPointerEvidence = { down: 0, move: 0, up: 0, cancel: 0 };
    for (const [name, key] of [["mousedown", "down"], ["mousemove", "move"], ["mouseup", "up"], ["pointercancel", "cancel"]] as const) {
      window.addEventListener(name, () => { (globalThis as any).__adocPointerEvidence[key] += 1; }, true);
    }
  });
  await lines.nth(2).hover({ position: { x: 8, y: start!.height / 2 } });
  await page.mouse.down();
  await lines.nth(5).hover({ position: { x: Math.min(80, end!.width - 4), y: end!.height / 2 } });
  await page.mouse.up();
  const dragEvidence = await lab.editor().locator("body").evaluate(() => ({
    ...(globalThis as any).__adocPointerEvidence,
    selection: getSelection()?.toString() || "",
    selectionLayers: document.querySelectorAll(".cm-selectionBackground").length,
  }));
  expect(dragEvidence.down).toBeGreaterThan(0);
  expect(dragEvidence.move).toBeGreaterThan(0);
  expect(dragEvidence.up).toBeGreaterThan(0);
  await lines.nth(2).hover({ position: { x: 8, y: start!.height / 2 } });
  await page.mouse.down();
  await lines.nth(5).hover({ position: { x: 20, y: end!.height / 2 } });
  await lab.editor().locator("body").evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 })));
  await page.mouse.up();
  await expect.poll(() => lab.editor().locator("body").evaluate(() => (globalThis as any).__adocPointerEvidence.cancel)).toBeGreaterThan(0);

  await page.locator("#theme").selectOption("dark");
  await page.locator("#zoom").fill("150");
  await page.locator("#margin").fill("48");
  await lab.applyControls();
  await lab.waitForEditor();
  const themedScroller = lab.editor().locator(".cm-scroller");
  await themedScroller.hover();
  await page.mouse.wheel(0, 600);
  const geometry = await themedScroller.evaluate(element => ({
    top: (element as HTMLElement).scrollTop,
    max: (element as HTMLElement).scrollHeight - (element as HTMLElement).clientHeight,
  }));
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.top).toBeLessThanOrEqual(geometry.max + 1);
  await expect(lab.editor().locator("#asciidoc-editor-root")).toHaveClass(/dark-theme/);
});
