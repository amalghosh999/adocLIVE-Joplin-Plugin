import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { LabPage } from "./helpers/lab-page";
import { visualScenario } from "../../baseline/visual-scenarios";

async function maskCaret(lab: LabPage): Promise<void> {
  await lab.editor().locator("html").evaluate(element => {
    element.classList.add("visual-test");
    const style = document.createElement("style");
    style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important}.cm-cursor{visibility:hidden!important}";
    document.head.appendChild(style);
  });
}

async function captureVisual(lab: LabPage, page: Page, id: Parameters<typeof visualScenario>[0]): Promise<void> {
  await maskCaret(lab);
  const descriptor = visualScenario(id);
  const frame = page.locator("iframe[data-session-id=editor-1]");
  const candidateDir = process.env.ADOC_BASELINE_CANDIDATE_DIR;
  if (candidateDir) {
    fs.mkdirSync(candidateDir, { recursive: true });
    await frame.screenshot({ path: path.join(candidateDir, descriptor.fileName), animations: "disabled", caret: "hide" });
    return;
  }
  await expect(frame).toHaveScreenshot(descriptor.fileName);
}

test("@visual representative light view modes", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  for (const view of ["live-preview", "raw", "split", "preview"] as const) {
    await lab.setView(view);
    await captureVisual(lab, page, `light-${view}` as Parameters<typeof visualScenario>[0]);
  }
});

test("@visual dark, high-contrast, and narrow editor states", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  for (const theme of ["dark", "high-contrast"] as const) {
    await page.locator("#theme").selectOption(theme);
    await page.locator("#apply-layout").click();
    await lab.waitForEditor();
    await captureVisual(lab, page, `${theme}-live-preview` as Parameters<typeof visualScenario>[0]);
  }
  await page.locator("#viewport").selectOption("375x667");
  await page.locator("#apply-layout").click();
  await lab.waitForEditor();
  await captureVisual(lab, page, "narrow-high-contrast");
});

test("@visual block and overlay gallery", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  await lab.setFixture("block-gallery");
  await captureVisual(lab, page, "block-gallery");

  await lab.setFixture("tables-code");
  const block = lab.editor().locator(".cm-lp-codeblock").first();
  await expect(block).toBeVisible();
  await block.dblclick();
  const modal = lab.editor().locator(".cm-lp-block-editor-overlay");
  await expect(modal).toBeVisible();
  await captureVisual(lab, page, "block-editor-modal");
});

test("@visual toolbar, dropdown, search, and floating UI", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  const frame = lab.editor();
  await frame.getByRole("button", { name: "Text", exact: true }).click();
  await frame.locator('[title="Text case options"]').click();
  await captureVisual(lab, page, "toolbar-dropdown");
  await frame.locator("body").press("Escape");
  await frame.locator(".cm-content").focus();
  await page.keyboard.press("Control+f");
  await frame.locator(".adl-search input[name=search]").fill("section");
  await captureVisual(lab, page, "search-ui");
  await frame.locator(".adl-search input[name=search]").press("Escape");
  const footnote = frame.locator(".cm-lp-footnote").first();
  await expect(footnote).toBeVisible();
  await footnote.click();
  await expect(frame.locator(".cm-lp-footnote-popup")).toBeVisible();
  await captureVisual(lab, page, "footnote-popup");
  await frame.locator(".cm-content").click();

  const toggle = frame.locator(".cm-lp-section-toggle").last();
  await expect(toggle).toBeVisible();
  await toggle.click();
  const preview = frame.locator(".cm-lp-floating-section-preview");
  await expect(preview).toBeVisible();
  await expect(preview).not.toContainText("Loading section");
  await captureVisual(lab, page, "floating-section-preview");
});
