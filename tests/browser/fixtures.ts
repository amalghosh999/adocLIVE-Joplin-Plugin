import { expect, test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const externalRequests: string[] = [];
    const runtimeErrors: string[] = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname) && !["data:", "blob:", "about:"].includes(url.protocol)) {
        externalRequests.push(request.url());
      }
    });
    page.on("pageerror", error => runtimeErrors.push(error.stack || error.message));
    page.on("console", message => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    await use(page);
    const allowedConsole = testInfo.annotations
      .filter(annotation => annotation.type === "allow-console-error" && annotation.description)
      .map(annotation => annotation.description!);
    const unexpectedRuntimeErrors = runtimeErrors.filter(error => !allowedConsole.some(allowed => error.includes(allowed)));
    const privateSession = await page.locator("html").getAttribute("data-private-session").catch(() => "false");
    if (privateSession === "true") {
      expect(testInfo.project.name, "private sessions must run only in the artifact-safe project").toBe("private-artifact-safe");
    } else if ((testInfo.status != null && testInfo.status !== testInfo.expectedStatus) || externalRequests.length > 0 || unexpectedRuntimeErrors.length > 0) {
      const state = await page.evaluate(() => window.__ADOC_LAB__?.getState()).catch(() => null);
      if (state) await testInfo.attach("lab-state.json", { body: JSON.stringify(state, null, 2), contentType: "application/json" });
      const editorFrames = page.frames().filter(frame => frame.url().startsWith("http://127.0.0.1:4174"));
      for (let index = 0; index < editorFrames.length; index += 1) {
        const html = await editorFrames[index].content().catch(() => "");
        if (html) await testInfo.attach(`editor-${index + 1}.html`, { body: html, contentType: "text/html" });
      }
    }
    expect(externalRequests, "automated Test Lab runs must remain offline").toEqual([]);
    expect(unexpectedRuntimeErrors, "console errors and unhandled exceptions fail Test Lab tests").toEqual([]);
  },
});

export { expect } from "@playwright/test";
