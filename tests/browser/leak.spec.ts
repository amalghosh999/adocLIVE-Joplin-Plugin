import { expect, test } from "./fixtures";
import { LabPage } from "./helpers/lab-page";

test("@leak repeated note switching does not retain heap or DOM monotonically", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const lab = new LabPage(page);
  await lab.open();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");

  const sample = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage") as { usedSize: number };
    const dom = await cdp.send("Memory.getDOMCounters") as { nodes: number; documents: number; jsEventListeners: number };
    return { heap: heap.usedSize, nodes: dom.nodes, documents: dom.documents, listeners: dom.jsEventListeners };
  };

  const series = [await sample()];
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const linked = iteration % 2 === 0;
    await lab.push("editor-1", {
      type: "updateNote",
      value: {
        id: linked ? "00000000000000000000000000000002" : "00000000000000000000000000000001",
        body: linked ? "= Linked\n\n== Target\n\nSynthetic." : "= Primary\n\nSynthetic.",
      },
    });
    if ((iteration + 1) % 10 === 0) {
      await lab.editor().locator("body").evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      series.push(await sample());
    }
  }
  const first = series[0];
  const last = series.at(-1)!;
  const heapGrowth = last.heap - first.heap;
  const heapPercent = heapGrowth / first.heap * 100;
  const nodeGrowth = last.nodes - first.nodes;
  const nodePercent = nodeGrowth / first.nodes * 100;
  await testInfo.attach("leak-series.json", { body: JSON.stringify({ series, heapGrowth, heapPercent, nodeGrowth, nodePercent }, null, 2), contentType: "application/json" });
  expect(heapPercent > 10 && heapGrowth > 5 * 1024 * 1024).toBe(false);
  expect(nodePercent > 10 && nodeGrowth > 500).toBe(false);
  const monotonicallyGrowing = series.every((entry, index) => index === 0 || entry.nodes >= series[index - 1].nodes);
  expect(monotonicallyGrowing && nodePercent > 10 && nodeGrowth > 500).toBe(false);
});

test("@leak repeated popup lifecycle releases DOM and listeners", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const lab = new LabPage(page);
  await lab.open();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  const counters: Array<{ nodes: number; jsEventListeners: number }> = [];
  const frame = lab.editor();
  await frame.getByRole("button", { name: "Text", exact: true }).click();
  const dropdownButton = frame.locator('[title="Text case options"]');
  for (let iteration = 0; iteration < 100; iteration += 1) {
    await dropdownButton.click();
    await dropdownButton.click();
    if ((iteration + 1) % 10 === 0) {
      await cdp.send("HeapProfiler.collectGarbage");
      counters.push(await cdp.send("Memory.getDOMCounters") as { nodes: number; jsEventListeners: number });
    }
  }
  await testInfo.attach("popup-dom-series.json", { body: JSON.stringify(counters, null, 2), contentType: "application/json" });
  const first = counters[0];
  const last = counters.at(-1)!;
  expect(last.nodes - first.nodes).toBeLessThanOrEqual(500);
  expect(last.jsEventListeners - first.jsEventListeners).toBeLessThanOrEqual(100);
});
