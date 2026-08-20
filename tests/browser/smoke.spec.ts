import { expect, test } from "./fixtures";
import { capturePageFailures, LabPage } from "./helpers/lab-page";

test("boots the exact editor shell and real CodeMirror panel without external requests", async ({ page }) => {
  const failures = capturePageFailures(page);
  const lab = new LabPage(page);
  await lab.open();
  await expect(lab.editor().locator("#asciidoc-editor-root")).toBeVisible();
  await expect(lab.editor().locator("#ribbon-container .ribbon")).toBeVisible();
  await expect(lab.editor().locator(".cm-editor")).toBeVisible();
  await expect(lab.editor().locator(".cm-content")).toContainText("Document title");
  expect(failures.externalRequests).toEqual([]);
  expect(failures.errors).toEqual([]);
});

test("supports live, raw, split, and rendered-preview modes", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  for (const view of ["live-preview", "raw", "split", "preview"] as const) {
    await lab.setView(view);
    const expectedMode = view === "live-preview" ? "live-preview" : "split";
    const layout = lab.editor().locator("#editor-layout");
    await expect(layout).toHaveAttribute("data-view-mode", expectedMode);
    if (view !== "live-preview") await expect(layout).toHaveAttribute("data-split-view-submode", view);
    if (view === "preview") await expect(lab.editor().locator("#editor-pane")).toBeHidden();
    else await expect(lab.editor().locator("#editor-pane")).toBeVisible();
    if (view === "split" || view === "preview") await expect(lab.editor().locator("#preview-pane-container")).toBeVisible();
    else await expect(lab.editor().locator("#preview-pane-container")).toBeHidden();
  }
});

test("creates two isolated editor realms over one shared host store", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  await lab.setSessions(2);
  await expect(lab.editor("editor-1").locator(".cm-editor")).toBeVisible();
  await expect(lab.editor("editor-2").locator(".cm-editor")).toBeVisible();
  const frameUrls = page.frames().filter(frame => frame !== page.mainFrame()).map(frame => new URL(frame.url()));
  expect(frameUrls).toHaveLength(2);
  expect(frameUrls[0].origin).not.toBe(new URL(page.url()).origin);
  expect(frameUrls[0].searchParams.get("session")).not.toBe(frameUrls[1].searchParams.get("session"));
  const firstSeed = await lab.editor("editor-1").locator("body").evaluate(() => localStorage.getItem("adoclab-session-seed"));
  const secondSeed = await lab.editor("editor-2").locator("body").evaluate(() => localStorage.getItem("adoclab-session-seed"));
  expect(firstSeed).toBe("editor-1");
  expect(secondSeed).toBe("editor-2");
});

test("applies theme, viewport, zoom, margins, and feature controls", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  await page.locator("#theme").selectOption("dark");
  await page.locator("#viewport").selectOption("640x800");
  await page.locator("#zoom").fill("120");
  await page.locator("#margin").fill("32");
  await page.locator("#compact").check();
  await page.locator("#apply-layout").click();
  await lab.waitForEditor();
  await expect(lab.editor().locator("#asciidoc-editor-root")).toHaveClass(/dark-theme/);
  await expect(lab.editor().locator(".cm-editor")).toHaveCSS("font-size", /.+/);
  await expect(page.locator("iframe[data-session-id=editor-1]")).toHaveCSS("height", "800px");
});
