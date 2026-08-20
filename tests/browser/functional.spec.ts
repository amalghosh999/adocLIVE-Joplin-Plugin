import { expect, test } from "./fixtures";
import { LabPage } from "./helpers/lab-page";

test("supports editing, deletion, selection, undo/redo, and debounced save", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  const content = lab.editor().locator(".cm-content");
  await content.click();
  await content.press("Control+End");
  await content.press("End");
  await content.type("\n\nSynthetic edit");
  await expect(content).toContainText("Synthetic edit");
  await content.press("Shift+Control+ArrowLeft");
  await content.press("Backspace");
  await expect(content).not.toContainText("edit");
  await content.press("Control+z");
  await expect(content).toContainText("Synthetic edit");
  await content.press("Control+Shift+z");
  await expect(content).not.toContainText("Synthetic edit");
  await content.type("saved");
  await expect.poll(async () => ((await lab.state() as any).events as any[]).some(event => event.name === "note-saved"), { timeout: 5_000 }).toBe(true);
});

test("opens find/replace and exercises real keyboard navigation", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  const content = lab.editor().locator(".cm-content");
  await content.focus();
  await page.keyboard.press("Control+f");
  const searchPanel = lab.editor().locator(".adl-search");
  await expect(searchPanel).toBeVisible();
  const search = searchPanel.locator("input[name=search]");
  await search.fill("section");
  await search.press("Enter");
  await expect(searchPanel.locator(".adl-search__counter")).toContainText("of");
  await search.press("Escape");
  await expect(searchPanel).toBeHidden();
});

test("exercises every ribbon family, dropdown, context menu, and source insertion", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  const frame = lab.editor();
  for (const tab of ["Text", "Insert", "Advanced", "View"]) {
    await frame.getByRole("button", { name: tab, exact: true }).click();
    await expect(frame.locator(".ribbon-panel .ribbon-section").first()).toBeVisible();
  }

  for (const tab of ["Text", "Insert", "Advanced"]) {
    await frame.getByRole("button", { name: tab, exact: true }).click();
    const arrows = frame.locator(".ribbon-panel .split-arrow");
    const count = await arrows.count();
    expect(count, `${tab} must expose its split-button controls`).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      await arrows.nth(index).click();
      await expect(frame.locator('.split-dropdown.open[role="menu"]')).toBeVisible();
      await frame.locator("body").press("Escape");
      if (await frame.locator(".split-dropdown.open").count()) await arrows.nth(index).click();
      await expect(frame.locator(".split-dropdown.open")).toHaveCount(0);
    }
  }

  await frame.getByRole("button", { name: "Text", exact: true }).click();
  await frame.locator('[title="Text case options"]').click();
  await expect(frame.locator('.split-dropdown[role="menu"]')).toBeVisible();
  await frame.locator("body").press("Escape");

  await frame.getByRole("button", { name: "Insert", exact: true }).click();
  const editor = frame.locator(".cm-content");
  await editor.click();
  await frame.locator('[title="Source Block"]').click();
  await expect(editor).toContainText("JAVASCRIPT");

  await editor.click({ button: "right" });
  // Native mode delegates the context menu to Electron/Chromium.
  await expect(frame.locator(".spell-context-menu")).toHaveCount(0);
});

test("opens attribute autocomplete through the real CodeMirror command", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  const editor = lab.editor().locator(".cm-content");
  await editor.click();
  await editor.press("Control+End");
  await editor.press("End");
  await editor.type("\n{cu");
  await editor.press("Control+Space");
  await expect(lab.editor().locator(".cm-tooltip-autocomplete")).toBeVisible();
  await expect(lab.editor().locator(".cm-tooltip-autocomplete")).toContainText("custom");
  await editor.press("Escape");
});

test("resizes the real split divider with pointer input", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  await lab.setView("split");
  const divider = lab.editor().locator("#editor-split-divider");
  const before = await divider.boundingBox();
  expect(before).not.toBeNull();
  await divider.hover();
  await page.mouse.down();
  await page.mouse.move(before!.x + 120, before!.y, { steps: 5 });
  await page.mouse.up();
  const after = await divider.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.x - before!.x)).toBeGreaterThan(50);
});

test("pastes through Chromium clipboard permissions and handles media drag/drop", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const lab = new LabPage(page);
  await lab.open();
  const content = lab.editor().locator(".cm-content");
  await page.evaluate(() => navigator.clipboard.writeText("clipboard synthetic text"));
  await content.click();
  await content.press("Control+End");
  await content.press("Control+v");
  await expect(content).toContainText("clipboard synthetic text");

  await content.evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], "tiny.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(lab.editor().getByRole("img", { name: "tiny" })).toBeVisible();
  await expect.poll(async () => ((await lab.state() as any).events as any[])
    .some(event => event.category === "rpc" && event.name === "createResourceFromBytes")).toBe(true);
});

test("propagates saves to another editor session while preserving separate realms", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  await lab.setSessions(2);
  await lab.typeAtEnd("\n\nShared edit", "editor-1");
  await expect(lab.editor("editor-2").locator(".cm-content")).toContainText("Shared edit", { timeout: 5_000 });
  const state = await lab.state() as any;
  expect(state.scenario.notes.find((note: any) => note.id === "00000000000000000000000000000001").revision).toBeGreaterThan(1);
});
