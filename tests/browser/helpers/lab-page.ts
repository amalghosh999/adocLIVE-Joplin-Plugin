import { expect, type FrameLocator, type Page } from "@playwright/test";
import type { EditorHostPush } from "../../../src/shared/editor-host-contracts";

export class LabPage {
  constructor(readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/");
    await expect(this.page).toHaveTitle("adocLIVE Test Lab");
    await this.waitForEditor();
  }

  editor(sessionId = "editor-1"): FrameLocator {
    return this.page.frameLocator(`iframe[data-session-id="${sessionId}"]`);
  }

  async waitForEditor(sessionId = "editor-1"): Promise<void> {
    await expect(this.page.locator(`iframe[data-session-id="${sessionId}"]`)).toHaveCount(1, { timeout: 30_000 });
    await expect(this.editor(sessionId).locator(".cm-editor")).toHaveCount(1, { timeout: 30_000 });
    await expect(this.editor(sessionId).locator("#asciidoc-editor-root")).toBeVisible();
    await this.waitStable(sessionId);
  }

  async waitStable(sessionId = "editor-1"): Promise<void> {
    await this.editor(sessionId).locator("body").evaluate(async () => {
      await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2_000))]);
      await Promise.race([
        new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
        new Promise<void>(resolve => setTimeout(resolve, 1_000)),
      ]);
      await new Promise<void>(resolve => {
        let timer = 0;
        let hardStop = 0;
        const finish = () => {
          clearTimeout(timer);
          clearTimeout(hardStop);
          observer.disconnect();
          resolve();
        };
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = window.setTimeout(finish, 100);
        });
        observer.observe(document.body, { attributes: true, childList: true, subtree: true });
        timer = window.setTimeout(finish, 100);
        hardStop = window.setTimeout(finish, 2_000);
      });
    });
    await expect.poll(async () => (await this.state() as any).pending.length, { timeout: 10_000 }).toBe(0);
  }

  async setFixture(id: string, options: { allowPending?: boolean } = {}): Promise<void> {
    await this.page.evaluate(async fixtureId => window.__ADOC_LAB__!.setFixture(fixtureId), id);
    if (options.allowPending) {
      await expect(this.editor().locator(".cm-editor")).toHaveCount(1, { timeout: 30_000 });
      await expect(this.editor().locator("#asciidoc-editor-root")).toBeVisible();
    } else {
      await this.waitForEditor();
    }
  }

  async setSessions(count: 1 | 2): Promise<void> {
    await this.page.locator("#session-count").selectOption(String(count));
    await this.applyControls();
    await this.waitForEditor("editor-1");
    if (count === 2) await this.waitForEditor("editor-2");
  }

  async setView(view: "live-preview" | "split" | "raw" | "preview"): Promise<void> {
    await this.page.locator("#view-mode").selectOption(view);
    await this.applyControls();
    await this.waitForEditor();
  }

  async applyControls(): Promise<void> {
    const previous = await this.page.locator('iframe[data-session-id="editor-1"]').getAttribute("src").catch(() => null);
    await this.page.locator("#apply-layout").click();
    await expect.poll(() => this.page.locator('iframe[data-session-id="editor-1"]').getAttribute("src"), { timeout: 10_000 }).not.toBe(previous);
  }

  async typeAtEnd(text: string, sessionId = "editor-1"): Promise<void> {
    const editor = this.editor(sessionId).locator(".cm-content");
    await editor.click();
    await editor.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
    await editor.press("End");
    await editor.type(text);
  }

  async state(): Promise<unknown> {
    return this.page.evaluate(() => window.__ADOC_LAB__!.getState());
  }

  async advance(milliseconds: number): Promise<void> {
    await this.page.evaluate(ms => window.__ADOC_LAB__!.advance(ms), milliseconds);
  }

  async push(sessionId: string, push: EditorHostPush): Promise<void> {
    await this.page.evaluate(([id, value]) => window.__ADOC_LAB__!.push(id as string, value as EditorHostPush), [sessionId, push] as const);
  }
}

export function capturePageFailures(page: Page): { errors: string[]; externalRequests: string[] } {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.stack || error.message));
  page.on("request", request => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname) && url.protocol !== "data:" && url.protocol !== "blob:") externalRequests.push(request.url());
  });
  return { errors, externalRequests };
}
