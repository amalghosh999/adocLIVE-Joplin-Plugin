import { z } from "zod";

export const EditorDiagnosticEventSchema = z.object({
  area: z.enum(["editor", "transport", "preview", "measurement", "overlay", "mermaid", "resource", "cache"]),
  name: z.string(),
  phase: z.enum(["start", "end", "snapshot", "error"]).optional(),
  timestamp: z.number(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export type LabDiagnosticEvent = z.infer<typeof EditorDiagnosticEventSchema> & {
  sessionId: string;
  sequence: number;
};
