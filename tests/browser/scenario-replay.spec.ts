import { expect, test } from "./fixtures";
import { LabPage } from "./helpers/lab-page";

test("@private records, exports, imports, and replays semantic host events deterministically", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  await page.locator("#record").click();
  await page.locator("#mutation-body").fill("= Recorded update\n\nDeterministic body.");
  await page.locator("#external-update").click();
  await expect(lab.editor().locator(".cm-content")).toContainText("Recorded update");
  await lab.typeAtEnd("\nRECORDED-EDITOR-TEXT");
  await page.locator("#clock-step").fill("50");
  await page.locator("#advance-clock").click();
  await page.locator("#record").click();
  await expect(lab.editor().locator(".cm-content")).toContainText("Recorded update");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export").click({ force: true });
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = Buffer.concat(chunks);
  const firstJson = exported.toString("utf8");
  expect(JSON.parse(firstJson).schemaVersion).toBe(1);
  expect(JSON.parse(firstJson).timeline.map((event: any) => event.action)).toContain("host.mutate");
  expect(JSON.parse(firstJson).timeline.map((event: any) => event.action)).toContain("editor.type");

  await page.locator("#import-file").setInputFiles({ name: "roundtrip.json", mimeType: "application/json", buffer: exported });
  await lab.waitForEditor();
  await page.locator("#replay").click();
  await expect(lab.editor().locator(".cm-content")).toContainText("Recorded update");
  await expect(lab.editor().locator(".cm-content")).toContainText("RECORDED-EDITOR-TEXT");
});
