import { expect, test } from "./fixtures";
import { LabPage } from "./helpers/lab-page";

test("converts fenced Markdown code through the real context-menu flow", async ({ page, context }) => {
  test.fail(true, "ADL-018: the nspell crash currently blocks the custom converted-paste context menu");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const lab = new LabPage(page);
  await lab.open();
  await page.locator("#spellcheck").check();
  await lab.applyControls();
  await lab.waitForEditor();
  await page.evaluate(() => navigator.clipboard.writeText("```javascript\nconst value = 1;\n```") );
  const frame = lab.editor();
  const editor = frame.locator(".cm-content");
  await editor.click({ button: "right" });
  await expect(frame.getByText("Convert from Markdown & Paste", { exact: true })).toBeVisible({ timeout: 5_000 });
  await frame.getByText("Convert from Markdown & Paste", { exact: true }).click();
  await expect(editor).toContainText("source,javascript");
  await expect(editor).toContainText("const value = 1;");
});

test("ADL-018 nspell decoration ranges remain sorted during context-menu refresh", async ({ page }) => {
  test.fail(true, "ADL-018: enabling nspell currently crashes its CodeMirror decoration refresh");
  const lab = new LabPage(page);
  await lab.open();
  await page.locator("#spellcheck").check();
  await lab.applyControls();
  await lab.waitForEditor();
  const editor = lab.editor().locator(".cm-content");
  await editor.click();
  await editor.type(" mispelled synthetic token");
  await editor.click({ button: "right" });
  await expect(lab.editor().locator(".cm-editor")).toBeVisible();
  const state = await lab.state() as any;
  expect(state.diagnostics.filter((event: any) => event.phase === "error")).toEqual([]);
});

test("ADL-015 complex table editor does not destructively rewrite unsupported structure", async ({ page }) => {
  test.fail(true, "ADL-015: complex-table no-op round trip is an audited desired-behavior failure");
  const lab = new LabPage(page);
  await lab.open();
  await lab.setFixture("tables-code");
  const before = await lab.editor().locator(".cm-content").textContent();
  const table = lab.editor().locator(".cm-lp-table, .cm-lp-table-widget").last();
  await table.dblclick();
  const modal = lab.editor().locator(".cm-lp-block-editor-overlay");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /save|apply/i }).click();
  await expect(lab.editor().locator(".cm-content")).toHaveText(before || "");
});
