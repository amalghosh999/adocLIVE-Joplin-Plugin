export type EditorDiagnosticArea =
  | "editor"
  | "transport"
  | "preview"
  | "measurement"
  | "overlay"
  | "mermaid"
  | "resource"
  | "cache";

export interface EditorDiagnosticEvent {
  area: EditorDiagnosticArea;
  name: string;
  phase?: "start" | "end" | "snapshot" | "error";
  timestamp: number;
  detail?: Record<string, unknown>;
}

export interface EditorDiagnosticsPort {
  emit(event: EditorDiagnosticEvent): void;
}

/**
 * The lab opts in with a document marker. Production has no sink/global and pays
 * only this marker check. DOM events keep separately bundled bootstraps isolated.
 */
export function emitEditorDiagnostic(
  area: EditorDiagnosticArea,
  name: string,
  phase?: EditorDiagnosticEvent["phase"],
  detail?: Record<string, unknown>,
): void {
  if (typeof document === "undefined" || document.documentElement.dataset.adocLabDiagnostics !== "true") return;
  document.dispatchEvent(new CustomEvent<EditorDiagnosticEvent>("adoclive:diagnostic", {
    detail: { area, name, phase, timestamp: performance.now(), detail },
  }));
}
