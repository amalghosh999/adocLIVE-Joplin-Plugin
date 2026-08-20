import { expect, test } from "./fixtures";
import { capturePageFailures, LabPage } from "./helpers/lab-page";

test("@artifact boots panel and CSS from the extracted generated JPL", async ({ page }) => {
  const failures = capturePageFailures(page);
  const missing: string[] = [];
  page.on("response", response => { if (response.status() >= 400) missing.push(`${response.status()} ${response.url()}`); });
  const lab = new LabPage(page);
  await lab.open();
  await expect(page.locator("#artifact-badge")).toBeVisible();
  await expect(lab.editor().locator(".cm-editor")).toHaveCount(1);
  await expect(lab.editor().locator(".cm-content")).toContainText("Document title");
  await expect(lab.editor().locator(".ribbon")).toBeVisible();
  expect(missing).toEqual([]);
  expect(failures.errors).toEqual([]);
  expect(failures.externalRequests).toEqual([]);
});
