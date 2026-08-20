import { expect, test } from "./fixtures";
import { LabPage } from "./helpers/lab-page";

test("@private local imports suppress persistence and require export confirmation", async ({ page }) => {
  const secret = "PRIVATE-TEST-NOTE-7f5ea3f8";
  const lab = new LabPage(page);
  await lab.open();
  await page.locator("#import-file").setInputFiles({
    name: "private-note.adoc",
    mimeType: "text/plain",
    buffer: Buffer.from(`= Private note\n\n${secret}`),
  });
  await lab.waitForEditor();
  await expect(page.locator("#private-banner")).toBeVisible();
  await expect(lab.editor().locator(".cm-content")).toContainText(secret);
  expect((await lab.state() as any).privateSession).toBe(true);

  const persisted = await Promise.all(page.frames().map(frame => frame.evaluate(value => ({
    local: Object.values(localStorage).some(item => item.includes(value)),
    session: Object.values(sessionStorage).some(item => item.includes(value)),
  }), secret).catch(() => ({ local: false, session: false }))));
  expect(persisted.some(result => result.local || result.session)).toBe(false);

  page.on("dialog", dialog => dialog.dismiss());
  const download = page.waitForEvent("download", { timeout: 1_000 }).then(() => true).catch(() => false);
  await page.locator("#export").click({ force: true });
  expect(await download).toBe(false);

  await page.locator("#reset").click();
  await lab.waitForEditor();
  await expect(lab.editor().locator(".cm-content")).not.toContainText(secret);
  await expect(page.locator("#private-banner")).toBeHidden();

  await page.locator("#import-file").setInputFiles({
    name: "private-note.adoc",
    mimeType: "text/plain",
    buffer: Buffer.from(`= Private note\n\n${secret}`),
  });
  await lab.waitForEditor();

  await page.reload();
  await lab.waitForEditor();
  await expect(lab.editor().locator(".cm-content")).not.toContainText(secret);
  await expect(page.locator("#private-banner")).toBeHidden();
});
