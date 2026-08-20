import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { BaselineReviewReceiptV1Schema, REVIEW_ITEM_IDS, VISUAL_CANDIDATE_IDS } from "../../baseline/contracts";

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Av7eWQAAAABJRU5ErkJggg==", "base64");
const hash = (character: string) => character.repeat(64);
const reference = (path: string, character = "a") => ({ path, sha256: hash(character), bytes: tinyPng.length });

function bundle(digestCharacter: string) {
  const bundleDigest = hash(digestCharacter);
  const visuals = VISUAL_CANDIDATE_IDS.map((id, index) => ({
    id,
    scenario: `scenario/${id}`,
    before: reference(`visual/before/${id}.png`, ((index + 1) % 10).toString()),
    candidate: reference(`visual/candidate/${id}.png`, ((index + 2) % 10).toString()),
    diff: reference(`visual/diff/${id}.png`, ((index + 3) % 10).toString()),
    metrics: { width: 1279, height: 801, threshold: 0.2, stabilityEpsilon: 2, maxDiffPixelRatio: 0.001, changedPixels: index, diffPixelRatio: index / (1279 * 801), maxChannelDelta: index, dimensionsMatch: true },
  }));
  const valuesPx = [18.3125, 0.25, 653.6875, 689.3125, 363.0625, 520.3125, 383.25, 278.125, 88.3125, 51.9375, ...Array.from({ length: 20 }, () => 54.5625)];
  return {
    schemaVersion: 1,
    kind: "BaselineCandidateBundle",
    bundleDigest,
    createdAt: "2026-08-20T12:00:00.000Z",
    source: { commit: "a".repeat(40), clean: true },
    package: { name: "joplin-plugin-adoclive", version: "1.0.4" },
    environment: {
      container: "mcr.microsoft.com/playwright:v1.61.1-noble",
      playwrightVersion: "1.61.1",
      browser: "chromium",
      os: "Ubuntu 24.04 LTS",
      architecture: "x64",
      nodeVersion: "v26.7.0",
      npmVersion: "12.0.2",
      timezone: "America/Chicago",
      locale: "en-US",
      deviceScaleFactor: 1,
      canonical: true,
    },
    lockfile: reference("metadata/package-lock.json", "b"),
    visuals,
    scroll: {
      id: "scroll-raw-live-raw-mid-document",
      scenario: "raw-live-raw-mid-document",
      runs: 30,
      valuesPx,
      medianPx: 54.5625,
      p99Px: 689.3125,
      madPx: 0,
      rawLineHeightPx: 18.1875,
      roundingMarginPx: 1,
      regressionCeilingPx: 690.3125,
      quarterLineSafetyPx: 4.546875,
      knownIssues: ["ADL-022", "ADL-023"],
      evidence: reference("scroll/scroll-characterization.json", "c"),
      frames: {
        medianBefore: reference("scroll/median-before.png", "d"),
        medianAfter: reference("scroll/median-after.png", "e"),
        worstBefore: reference("scroll/worst-before.png", "f"),
        worstAfter: reference("scroll/worst-after.png", "1"),
      },
    },
    audit: {
      report: reference("reports/production-audit.json", "2"),
      counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
    },
    tests: { report: reference("reports/candidate-tests.json", "3"), passed: true, scope: "release" },
    artifacts: {
      jpl: reference("artifacts/com.asciidoc.joplin-plugin.jpl", "4"),
      npmTarball: reference("artifacts/joplin-plugin-adoclive-1.0.4.tgz", "5"),
      publishManifest: reference("artifacts/com.asciidoc.joplin-plugin.json", "6"),
      pluginManifest: reference("metadata/plugin-manifest.json", "7"),
    },
    finalizable: true,
    draftReasons: [],
  };
}

async function mockReviewApi(page: Page): Promise<void> {
  const candidates = [bundle("8"), bundle("9")];
  await page.route("**/baseline-review/runs**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/baseline-review/runs") {
      await route.fulfill({ json: { schemaVersion: 1, runs: candidates.map(candidate => ({
        bundleId: candidate.bundleDigest,
        createdAt: candidate.createdAt,
        sourceCommit: candidate.source.commit,
        version: candidate.package.version,
        finalizable: candidate.finalizable,
        draftReasons: candidate.draftReasons,
        visualCount: 13,
        auditTotal: 0,
      })) } });
      return;
    }
    const manifestMatch = pathname.match(/^\/baseline-review\/runs\/([a-f0-9]{64})\/manifest$/);
    if (manifestMatch) {
      await route.fulfill({ json: candidates.find(candidate => candidate.bundleDigest === manifestMatch[1]) });
      return;
    }
    if (pathname.includes("/files/")) {
      await route.fulfill({ status: 200, contentType: "image/png", body: tinyPng });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "Not found" } });
  });
}

async function openReview(page: Page): Promise<void> {
  await mockReviewApi(page);
  await page.goto("/baseline-review/");
  await expect(page.locator("#queue-list .queue-row")).toHaveCount(14);
}

test("baseline review renders every visual and the full scroll characterization offline", async ({ page }) => {
  const external: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) external.push(request.url());
  });
  await openReview(page);
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/");
  await expect(page.locator("#queue-list input[type=checkbox]")).toHaveCount(0);
  await page.getByRole("button", { name: /Scroll · raw\/live\/raw/ }).click();
  await expect(page.locator("#scroll-values tr")).toHaveCount(30);
  await expect(page.locator("#scroll-viewer")).toContainText("ADL-022 quarter-line safety");
  await expect(page.locator("#scroll-viewer")).toContainText("ADL-023 bottom-clamp");
  await expect(page.locator("#run-order-chart circle")).toHaveCount(30);
  expect(external).toEqual([]);
});

test("decisions are individual, keyboard shortcuts pause in notes, and replacement bundles reset decisions but retain notes", async ({ page }) => {
  await openReview(page);
  const firstHeading = await page.locator("#item-heading").textContent();
  await page.locator("#item-note").focus();
  await page.keyboard.press("j");
  await expect(page.locator("#item-heading")).toHaveText(firstHeading || "");
  await page.locator("#item-note").fill("Intentional renderer adjustment.");
  await page.locator("#overall-rationale").fill("Rationale tied to the first bundle.");
  await page.locator('.native-evidence[data-platform="windows"] [name="joplinVersion"]').fill("3.4.12");
  await page.locator("#approve").click();
  await expect(page.locator("#progress-output")).toContainText("1 of 14");
  await expect(page.locator("#item-heading")).not.toHaveText(firstHeading || "");

  await page.locator("#bundle-select").selectOption(hash("9"));
  await expect(page.locator("#item-note")).toHaveValue("Intentional renderer adjustment.");
  await expect(page.locator("#decision-status")).toHaveText("Unresolved");
  await expect(page.locator("#progress-output")).toContainText("0 of 14");
  await expect(page.locator("#overall-rationale")).toHaveValue("");
  await expect(page.locator('.native-evidence[data-platform="windows"] [name="joplinVersion"]')).toHaveValue("");

  await page.reload();
  await expect(page.locator("#queue-list .queue-row")).toHaveCount(14);
  await page.locator("#bundle-select").selectOption(hash("9"));
  await expect(page.locator("#item-note")).toHaveValue("Intentional renderer adjustment.");
});

test("reject and regenerate require a note", async ({ page }) => {
  await openReview(page);
  await page.locator("#reject").click();
  await expect(page.locator("#decision-status")).toHaveText("Unresolved");
  await expect(page.locator("#item-note")).toBeFocused();
  await page.locator("#item-note").fill("Candidate clipped the source gutter.");
  await page.locator("#regenerate").click();
  await expect(page.locator("#decision-status")).toHaveText("Regenerate");
  await expect(page.locator("#finalize")).toBeDisabled();
});

test("a complete review downloads a canonical hash-bound receipt without repository mutation", async ({ page }) => {
  await openReview(page);
  for (let index = 0; index < REVIEW_ITEM_IDS.length; index += 1) await page.locator("#approve").click();
  await page.locator("#ack-adl-022").check();
  await page.locator("#ack-adl-023").check();
  await page.locator("#reviewer").fill("Release Reviewer");
  await page.locator("#overall-rationale").fill("All visual, scroll, audit, artifact, and native evidence is consistent with the 1.0.4 source candidate.");
  for (const platform of ["windows", "macos"]) {
    const form = page.locator(`.native-evidence[data-platform=${platform}]`);
    await form.locator("[name=joplinVersion]").fill("3.4.12");
    await form.locator("[name=osVersion]").fill(platform === "windows" ? "Windows 11 24H2" : "macOS 15.6");
    await form.locator("[name=date]").fill("2026-08-20");
    await form.locator("[name=verifier]").fill("Release Reviewer");
    await form.locator("[name=result]").selectOption("pass");
    await form.locator("[name=deviations]").fill("None");
    for (const name of ["installStartup", "representativeRender", "themeAndViewChanges", "hostileFixture", "upgrade"]) await form.locator(`[name=${name}]`).check();
  }
  await expect(page.locator("#finalize")).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#finalize").click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const receipt = BaselineReviewReceiptV1Schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  expect(receipt.reviewer).toBe("Release Reviewer");
  expect(receipt.decisions).toHaveLength(14);
  expect(receipt.decisions.every(decision => decision.decision === "approved")).toBe(true);
  expect(Object.keys(receipt.artifactHashes).length).toBeGreaterThan(40);
});

test("@a11y baseline review supports WCAG automation, forced colors, reduced motion, and narrow reflow", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 1000 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await openReview(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator(".review-grid")).toHaveCSS("display", "block");
});
