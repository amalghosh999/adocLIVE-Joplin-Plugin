import { expect, test } from "./fixtures";
import { LabPage } from "./helpers/lab-page";

test("ADL-001 cross-note undo isolation", async ({ page }) => {
  test.fail(true, "ADL-001: current editor history is not isolated by note");
  const lab = new LabPage(page);
  await lab.open();
  await lab.typeAtEnd("\nUNIQUE-FIRST-NOTE");
  await lab.push("editor-1", { type: "updateNote", value: { id: "00000000000000000000000000000002", body: "= Second note\n\nSECOND-NOTE-CONTENT" } });
  await expect(lab.editor().locator(".cm-content")).toContainText("SECOND-NOTE-CONTENT");
  await lab.editor().locator(".cm-content").press("Control+z");
  await expect(lab.editor().locator(".cm-content")).toContainText("SECOND-NOTE-CONTENT");
  await expect(lab.editor().locator(".cm-content")).not.toContainText("UNIQUE-FIRST-NOTE");
});

test("ADL-002 dirty same-note external update surfaces a conflict", async ({ page }) => {
  test.fail(true, "ADL-002: no conflict UI exists for dirty same-note updates");
  const lab = new LabPage(page);
  await lab.open();
  await lab.typeAtEnd("\nLOCAL-UNSAVED");
  await page.locator("#mutation-body").fill("= Host version\n\nEXTERNAL-VERSION");
  await page.locator("#external-update").click();
  await expect(lab.editor().getByRole("alert")).toContainText(/conflict|external update/i);
  await expect(lab.editor().locator(".cm-content")).toContainText("LOCAL-UNSAVED");
});

test("ready and pushed update reordering converges to the newest note", async ({ page }) => {
  test.fail(true, "ADL-025: a late ready response currently overwrites a newer pushed body");
  const lab = new LabPage(page);
  await lab.open();
  await page.locator("#failure-request").selectOption("ready");
  await page.locator("#manual-defer").check();
  await page.locator("#failure-message").fill("");
  await page.locator("#apply-layout").click();
  await expect.poll(async () => ((await lab.state() as any).pending as any[]).some(task => task.label.includes("ready"))).toBe(true);
  await lab.push("editor-1", { type: "updateNote", value: { id: "00000000000000000000000000000002", body: "= Pushed newest\n\nNEWEST" } });
  await page.locator("#resolve-all").click();
  await lab.waitForEditor();
  await expect(lab.editor().locator(".cm-content")).toContainText("NEWEST");
});

test("split render A/B reordering commits only the latest source", async ({ page }) => {
  test.fail(true, "ADL-003: reordered split renders do not reliably commit the latest source");
  const lab = new LabPage(page);
  await lab.open();
  await lab.setView("split");
  await page.locator("#failure-request").selectOption("renderAsciidoc");
  await page.locator("#failure-message").fill("");
  await page.locator("#manual-defer").check();
  await page.locator("#apply-layout").click();
  await expect(lab.editor().locator(".cm-editor")).toHaveCount(1);
  await lab.typeAtEnd("\n\n== Render A");
  await lab.typeAtEnd("\n\n== Render B");
  await expect.poll(async () => ((await lab.state() as any).pending as any[]).filter(task => task.label.includes("renderAsciidoc")).length).toBeGreaterThanOrEqual(1);
  await page.locator("#reverse-pending").click();
  await page.locator("#resolve-all").click();
  await expect(lab.editor().locator("#preview-pane")).toContainText("Render B");
});

test("ADL-004 linked-section A/B reordering commits only the latest target", async ({ page }) => {
  test.fail(true, "ADL-004: linked-section completion is not guarded by a request generation");
  const lab = new LabPage(page);
  await lab.open();
  await page.locator("#failure-request").selectOption("getNoteContent");
  await page.locator("#failure-message").fill("");
  await page.locator("#manual-defer").check();
  await lab.applyControls();
  await lab.waitForEditor();
  await page.evaluate(() => window.__ADOC_LAB__!.mutateNote(
    "00000000000000000000000000000002",
    "= Linked\n\n== First\n\nFIRST-LINKED-SECTION\n\n== Second\n\nSECOND-LINKED-SECTION",
  ));
  await lab.push("editor-1", {
    type: "updateNote",
    value: {
      id: "00000000000000000000000000000001",
      body: "= Link race\n\nxref:00000000000000000000000000000002#first[First] and xref:00000000000000000000000000000002#second[Second]",
    },
  });
  const toggles = lab.editor().locator(".cm-lp-section-toggle");
  await expect(toggles).toHaveCount(2);
  await toggles.nth(0).click();
  await toggles.nth(1).click();
  await expect.poll(async () => ((await lab.state() as any).pending as any[]).filter(task => task.label.includes("getNoteContent")).length).toBe(2);
  await page.locator("#reverse-pending").click();
  await page.locator("#resolve-all").click();
  const preview = lab.editor().locator(".cm-lp-floating-section-preview");
  await expect(preview).toContainText("SECOND-LINKED-SECTION");
  await expect(preview).not.toContainText("FIRST-LINKED-SECTION");
});

test("resource completion after a note switch cannot alter the selected note", async ({ page }) => {
  test.info().annotations.push({ type: "allow-console-error", description: "Failed to load resource" });
  const lab = new LabPage(page);
  await lab.open();
  await lab.setFixture("media", { allowPending: true });
  await lab.push("editor-1", {
    type: "updateNote",
    value: { id: "00000000000000000000000000000002", body: "= Switched while resources pending\n\nNEW-NOTE-WINS" },
  });
  for (let step = 0; step < 4; step += 1) await lab.advance(100);
  await lab.waitStable();
  await expect(lab.editor().locator(".cm-content")).toContainText("NEW-NOTE-WINS");
  await expect(lab.editor().locator(".cm-lp-image, .cm-lp-audio, .cm-lp-video")).toHaveCount(0);
});

test("a theme change during Mermaid rendering commits only the latest generation", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  await lab.setFixture("math-mermaid");
  await lab.push("editor-1", { type: "updateEditorTheme", editorTheme: "dark", mermaidThemeVariables: "{}", isDark: true });
  await lab.push("editor-1", { type: "updateEditorTheme", editorTheme: "light", mermaidThemeVariables: "{}", isDark: false });
  await expect(lab.editor().locator("#asciidoc-editor-root")).toHaveClass(/light-theme/);
  await expect.poll(async () => ((await lab.state() as any).diagnostics as any[])
    .filter(event => event.area === "mermaid" && event.name === "theme-generation").length).toBeGreaterThanOrEqual(2);
  const events = ((await lab.state() as any).diagnostics as any[]).filter(event => event.area === "mermaid");
  const latestThemeIndex = events.length - 1 - [...events].reverse().findIndex((event: any) => event.name === "theme-generation");
  const latestGeneration = events[latestThemeIndex].detail.generation;
  const staleCompletions = events.slice(latestThemeIndex + 1)
    .filter(event => event.name === "render" && event.phase === "end" && event.detail.generation < latestGeneration);
  expect(staleCompletions).toEqual([]);
});

test("closed asynchronous file overlays ignore late host completion", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  await page.locator("#failure-request").selectOption("openImageDialog");
  await page.locator("#failure-message").fill("");
  await page.locator("#manual-defer").check();
  await lab.applyControls();
  await lab.waitForEditor();
  await page.evaluate(() => window.__ADOC_LAB__!.setFileSelection("/synthetic/late image.png"));
  const frame = lab.editor();
  await frame.getByRole("button", { name: "Insert", exact: true }).click();
  await frame.locator('[title="Image options"]').click();
  await frame.getByRole("button", { name: "Local", exact: true }).click();
  await frame.getByRole("button", { name: "Browse...", exact: true }).click();
  await expect.poll(async () => ((await lab.state() as any).pending as any[]).some(task => task.label.includes("openImageDialog"))).toBe(true);
  await frame.getByRole("button", { name: "Text", exact: true }).click();
  await page.locator("#resolve-all").click();
  await expect(frame.locator(".img-form, .image-local-path")).toHaveCount(0);
});

test("save rejection, retry, echo, continued typing, and two-handle updates stay observable", async ({ page }) => {
  test.info().annotations.push({ type: "allow-console-error", description: "Save failed" });
  const lab = new LabPage(page);
  await lab.open();
  await lab.setSessions(2);
  await page.locator("#failure-request").selectOption("saveNote");
  await page.locator("#failure-message").fill("Synthetic save rejection");
  await page.locator("#apply-layout").click();
  await lab.waitForEditor("editor-1");
  await lab.waitForEditor("editor-2");
  await lab.typeAtEnd("\nREJECTED-SAVE", "editor-1");
  await expect.poll(async () => ((await lab.state() as any).events as any[]).some(event => event.category === "error" && event.name === "saveNote"), { timeout: 5_000 }).toBe(true);
  await page.locator("#failure-request").selectOption("");
  await lab.applyControls();
  await lab.waitForEditor("editor-1");
  await lab.typeAtEnd("\nRETRY-SAVE", "editor-1");
  await expect(lab.editor("editor-2").locator(".cm-content")).toContainText("RETRY-SAVE", { timeout: 5_000 });
});

test("save debounce preserves continued typing across a delayed acknowledgement", async ({ page }) => {
  const lab = new LabPage(page);
  await lab.open();
  await lab.setSessions(2);
  await page.locator("#failure-request").selectOption("saveNote");
  await page.locator("#failure-message").fill("");
  await page.locator("#manual-defer").check();
  await lab.applyControls();
  await lab.waitForEditor("editor-1");
  await lab.waitForEditor("editor-2");
  await lab.typeAtEnd("\nFIRST-PENDING-SAVE", "editor-1");
  await expect.poll(async () => ((await lab.state() as any).pending as any[]).filter(task => task.label.includes("saveNote")).length, { timeout: 8_000 }).toBe(1);
  await lab.typeAtEnd("\nSECOND-WHILE-PENDING", "editor-1");
  await page.locator("#resolve-all").click();
  await expect.poll(async () => ((await lab.state() as any).pending as any[]).filter(task => task.label.includes("saveNote")).length, { timeout: 8_000 }).toBe(1);
  await page.locator("#resolve-all").click();
  await expect(lab.editor("editor-2").locator(".cm-content")).toContainText("SECOND-WHILE-PENDING", { timeout: 8_000 });
  const state = await lab.state() as any;
  expect(state.scenario.notes.find((note: any) => note.id === "00000000000000000000000000000001").body).toContain("SECOND-WHILE-PENDING");
});
