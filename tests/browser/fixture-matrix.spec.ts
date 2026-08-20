import { expect, test } from "./fixtures";
import { LabPage } from "./helpers/lab-page";

const fixtures = [
  "inline-sections",
  "block-gallery",
  "tables-code",
  "math-mermaid",
  "media",
  "includes",
  "unicode",
  "hostile",
  "scroll-characterization",
];

test("@fixture-matrix boots the complete deterministic fixture library", async ({ page }) => {
  test.setTimeout(180_000);
  test.info().annotations.push({ type: "allow-console-error", description: "Failed to load resource" });
  test.info().annotations.push({
    type: "allow-console-error",
    description: "Executing inline event handler violates the following Content Security Policy directive",
  });
  const lab = new LabPage(page);
  await lab.open();
  for (const fixture of fixtures) {
    await lab.setFixture(fixture, { allowPending: fixture === "media" });
    if (fixture === "media") {
      for (let step = 0; step < 3; step += 1) await lab.advance(100);
      await lab.waitStable();
    }
    await expect(lab.editor().locator(".cm-editor")).toHaveCount(1);
    const state = await lab.state() as any;
    expect(state.scenario.id).toBe(fixture);
    expect(state.scenario.notes.length).toBeGreaterThan(0);
  }
});
