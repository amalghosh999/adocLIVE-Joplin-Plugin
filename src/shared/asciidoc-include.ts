export type AsciidocDiagnosticSeverity = "error" | "warning";

export interface AsciidocDiagnostic {
  severity: AsciidocDiagnosticSeverity;
  message: string;
  lineNumber?: number;
  target?: string;
}

export interface AsciidocRenderResult {
  html: string;
  diagnostics: AsciidocDiagnostic[];
  dependencyNoteIds: string[];
  baseDirUrl?: string;
}

export interface IncludePreviewEntry {
  lineNumber: number;
  target: string;
  source: string;
  html: string;
  diagnostics: AsciidocDiagnostic[];
}

export interface IncludeAnalysisResult {
  entries: IncludePreviewEntry[];
  dependencyNoteIds: string[];
}
