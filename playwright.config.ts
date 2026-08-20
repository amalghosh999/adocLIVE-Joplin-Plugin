import { defineConfig, devices } from "@playwright/test";

const artifactMode = process.env.ADOC_LAB_ARTIFACT === "1";
const noServer = process.env.ADOC_LAB_NO_SERVER === "1";
const controllerPort = process.env.ADOC_LAB_CONTROLLER_PORT || "4173";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { threshold: 0.2, maxDiffPixelRatio: 0.001, animations: "disabled", caret: "hide" },
  },
  outputDir: "test-results",
  snapshotPathTemplate: "{testDir}/baselines/visual/{testFilePath}/{arg}{ext}",
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${controllerPort}`,
    browserName: "chromium",
    locale: "en-US",
    timezoneId: "America/Chicago",
    colorScheme: "light",
    contextOptions: { reducedMotion: "no-preference" },
    deviceScaleFactor: 1,
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", grepInvert: /@private/ },
    {
      name: "private-artifact-safe",
      grep: /@private/,
      use: { trace: "off", screenshot: "off", video: "off" },
    },
  ],
  webServer: noServer ? undefined : {
    command: artifactMode
      ? "npm run lab:build && npm run lab:serve:artifact"
      : "npm run lab:build && npm run lab:serve",
    url: `http://127.0.0.1:${controllerPort}/health`,
    reuseExistingServer: !process.env.CI && !artifactMode,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
