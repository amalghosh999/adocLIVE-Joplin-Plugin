import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { LabPage } from "./helpers/lab-page";

async function expectNoAAViolations(page: import("@playwright/test").Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const knownRules: Record<string, string> = {
    "aria-input-field-name": "ADL-019",
    "color-contrast": "ADL-020",
    "target-size": "ADL-021",
    "scrollable-region-focusable": "ADL-024",
  };
  const unexpected = results.violations.filter(violation => !knownRules[violation.id]);
  expect(unexpected.map(violation => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.map(node => node.target) }))).toEqual([]);
}

test("@a11y dashboard and editor modes meet automated WCAG 2.2 AA checks", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  for (const view of ["live-preview", "raw", "split", "preview"] as const) {
    await lab.setView(view);
    await expectNoAAViolations(page);
  }
  for (const theme of ["dark", "high-contrast"] as const) {
    await page.locator("#theme").selectOption(theme);
    await page.locator("#apply-layout").click();
    await lab.waitForEditor();
    await expectNoAAViolations(page);
  }
});

test("@a11y ribbon, search, dropdown, context menu, and modal retain keyboard focus contracts", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  const frame = lab.editor();
  const editor = frame.locator(".cm-content");
  for (const tab of ["Text", "Insert", "Advanced", "View"]) {
    const button = frame.getByRole("button", { name: tab, exact: true });
    await button.focus();
    await expect(button).toBeFocused();
    await button.press("Enter");
    await expect(frame.locator(".ribbon-panel .ribbon-section").first()).toBeVisible();
  }
  await frame.getByRole("button", { name: "View", exact: true }).click();
  const autoHide = frame.getByLabel("Auto-Hide Toolbar");
  await autoHide.focus();
  await autoHide.press("Space");
  await expect(autoHide).toBeChecked();
  await autoHide.press("Space");
  await expect(autoHide).not.toBeChecked();
  await editor.focus();
  await page.keyboard.press("Control+f");
  await expect(frame.locator(".adl-search input[name=search]")).toBeFocused();
  await frame.locator(".adl-search input[name=search]").press("Escape");
  await expect(editor).toBeFocused();

  await frame.getByRole("button", { name: "Text", exact: true }).click();
  await frame.locator('[title="Text case options"]').focus();
  await frame.locator('[title="Text case options"]').press("Enter");
  await expect(frame.locator('.split-dropdown[role="menu"]')).toBeVisible();
  await frame.locator("body").press("Escape");

  await editor.click({ button: "right" });
  await expect(frame.locator(".spell-context-menu")).toHaveCount(0);

  await lab.setFixture("tables-code");
  const renderedBlock = lab.editor().locator(".cm-lp-codeblock").first();
  await expect(renderedBlock).toBeVisible();
  await renderedBlock.dblclick();
  const modal = lab.editor().locator(".cm-lp-block-editor-overlay");
  await expect(modal).toBeVisible();
  await modal.press("Escape");
  await expect(modal).toBeHidden();
  await expectNoAAViolations(page);
});

test("@a11y supports 200% zoom, narrow viewport, reduced motion, and forced colors", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  const lab = new LabPage(page);
  await lab.open();
  await page.locator("#viewport").selectOption("375x667");
  await page.locator("#zoom").fill("200");
  await page.locator("#apply-layout").click();
  await lab.waitForEditor();
  await expect(lab.editor().locator(".cm-content")).toBeVisible();
  await expectNoAAViolations(page);
});
