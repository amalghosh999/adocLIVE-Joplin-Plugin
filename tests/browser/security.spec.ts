import { expect, test } from "./fixtures";
import { LabPage } from "./helpers/lab-page";

async function injectionState(lab: LabPage): Promise<boolean> {
  return lab.editor().locator("body").evaluate(() => (globalThis as any).__ADOC_INJECTION__ === true);
}

test("controller state is unavailable to cross-origin rendered note DOM", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  const result = await lab.editor().locator("body").evaluate(() => {
    let parentState = false;
    try { parentState = Boolean((parent as any).__ADOC_LAB__); } catch {}
    return { parentState, ownState: Boolean((globalThis as any).__ADOC_LAB__) };
  });
  expect(result).toEqual({ parentState: false, ownState: false });
  expect(new URL(page.url()).origin).not.toBe(new URL(page.frames()[1].url()).origin);
});

test("ADL-008 numeric entities cannot construct executable markup", async ({ page }) => {
  test.fail(true, "ADL-008: numeric entity injection is an audited desired-behavior failure");
  const lab = new LabPage(page);
  await lab.open();
  await lab.setFixture("hostile");
  await lab.editor().locator("body").evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
  expect(await injectionState(lab)).toBe(false);
  await expect(lab.editor().locator('img[onerror*="ADOC_INJECTION"]')).toHaveCount(0);
});

test("ADL-009 xref labels are rendered as text, not injected DOM", async ({ page }) => {
  test.fail(true, "ADL-009: xref label injection is an audited desired-behavior failure");
  const lab = new LabPage(page);
  await lab.open();
  await lab.setFixture("hostile");
  await expect(lab.editor().locator('img[onerror*="ADOC_INJECTION"]')).toHaveCount(0);
  expect(await injectionState(lab)).toBe(false);
});

test("ADL-010 passthrough HTML remains inert under the editor security policy", async ({ page }) => {
  test.fail(true, "ADL-010: passthrough policy is an audited desired-behavior failure");
  const lab = new LabPage(page);
  await lab.open();
  await lab.setFixture("hostile");
  const injected = lab.editor().locator('button[onclick*="ADOC_INJECTION"]');
  await expect(injected).toHaveCount(0);
  expect(await injectionState(lab)).toBe(false);
});

test("ADL-011 dangerous URL schemes cannot navigate or execute", async ({ page }) => {
  test.fail(true, "ADL-011: dangerous URL allowlisting is an audited desired-behavior failure");
  const lab = new LabPage(page);
  await lab.open();
  await lab.setFixture("hostile");
  await expect(lab.editor().locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(await injectionState(lab)).toBe(false);
});

test("ADL-012 snippet fields cannot inject editor UI", async ({ page }) => {
  test.fail(true, "ADL-012: snippet names and previews are currently assigned with innerHTML");
  const lab = new LabPage(page);
  await lab.open();
  await lab.setFixture("hostile");
  const frame = lab.editor();
  await frame.getByRole("button", { name: "Insert", exact: true }).click();
  await frame.locator('[title="Template options"]').click();
  await expect(frame.locator(".template-options")).toBeVisible();
  await expect(frame.locator('.template-option img[onerror*="ADOC_INJECTION"], .template-option svg[onload*="ADOC_INJECTION"]')).toHaveCount(0);
  expect(await injectionState(lab)).toBe(false);
});

test("ADL-013 bibliography labels cannot inject citation UI", async ({ page }) => {
  test.fail(true, "ADL-013: citation choices currently interpolate bibliography labels with innerHTML");
  const lab = new LabPage(page);
  await lab.open();
  await lab.setFixture("hostile");
  const frame = lab.editor();
  await frame.getByRole("button", { name: "Advanced", exact: true }).click();
  const cite = frame.locator('[title="Insert citation reference (<<ref>>)"]');
  await cite.locator("..").locator(".split-arrow").click();
  await expect(cite.locator("..").locator('.split-dropdown img[onerror*="ADOC_INJECTION"]')).toHaveCount(0);
  expect(await injectionState(lab)).toBe(false);
});

test("dialog-derived values remain data and cannot construct editor UI", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  await page.evaluate(() => window.__ADOC_LAB__!.setFileSelection('<img src=x onerror="globalThis.__ADOC_INJECTION__=true">'));
  const frame = lab.editor();
  await frame.getByRole("button", { name: "Insert", exact: true }).click();
  await frame.locator('[title="Image options"]').click();
  await frame.getByRole("button", { name: "Local", exact: true }).click();
  await frame.getByRole("button", { name: "Browse...", exact: true }).click();
  await expect(frame.locator('img[onerror*="ADOC_INJECTION"]')).toHaveCount(0);
  expect(await injectionState(lab)).toBe(false);
});

test("malformed MessageChannel and window traffic is rejected", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  const editorFrame = page.frames().find(frame => frame.url().startsWith("http://127.0.0.1:4174"))!;
  await editorFrame.evaluate(() => parent.postMessage({ type: "adoclive:lab-editor-ready", sessionId: "editor-1", nonce: "wrong-wrong-wrong-wrong" }, "http://127.0.0.1:4173"));
  await page.evaluate(() => window.postMessage({ protocol: "adoclive.editor-host", version: 99, kind: "push" }, "*"));
  await expect(lab.editor().locator(".cm-editor")).toHaveCount(1);
  const state = await lab.state() as any;
  expect(state.events.filter((event: any) => event.name === "session-destroyed")).toHaveLength(0);
});
