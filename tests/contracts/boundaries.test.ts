import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildEditorShell } from "../../src/shared/editor-shell";
import { emitEditorDiagnostic } from "../../src/shared/editor-diagnostics";

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : entry.name.endsWith(".ts") ? [target] : [];
  });
}

describe("production/laboratory boundaries", () => {
  it("keeps production imports independent of test-lab and browser suites", () => {
    const violations = sourceFiles(path.resolve("src")).flatMap(file => {
      const source = fs.readFileSync(file, "utf8");
      return /(?:from\s+|require\()["'][^"']*(?:test-lab|tests\/browser)/.test(source) ? [path.relative(process.cwd(), file)] : [];
    });
    expect(violations).toEqual([]);
  });

  it("builds stable shared shell semantics for both themes", () => {
    const light = buildEditorShell({ themeClass: "light-theme" });
    const dark = buildEditorShell({ themeClass: "dark-theme" });
    for (const id of ["asciidoc-editor-root", "ribbon-container", "editor-layout", "editor-pane", "editor-split-divider", "preview-pane-container", "preview-pane"]) {
      expect(light).toContain(`id="${id}"`);
      expect(dark).toContain(`id="${id}"`);
    }
    expect(light.replace("light-theme", "THEME")).toBe(dark.replace("dark-theme", "THEME"));
  });

  it("keeps diagnostics disabled without an opted-in document", () => {
    const dispatch = vi.fn();
    const previous = (globalThis as any).document;
    (globalThis as any).document = { documentElement: { dataset: {} }, dispatchEvent: dispatch };
    try {
      emitEditorDiagnostic("editor", "test", "start");
      expect(dispatch).not.toHaveBeenCalled();
      expect((globalThis as any).__ADOC_DIAGNOSTICS__).toBeUndefined();
    } finally {
      (globalThis as any).document = previous;
    }
  });
});
