import { z } from "zod";
import { EditorDiagnosticEventSchema } from "./lab-schemas";
import { LabTimelineEventSchema } from "./scenario";

export const LabEditorReadySchema = z.object({
  type: z.literal("adoclive:lab-editor-ready"),
  sessionId: z.string().min(1),
  nonce: z.string().min(16),
});

export const LabConnectSchema = z.object({
  type: z.literal("adoclive:lab-connect"),
  sessionId: z.string().min(1),
  nonce: z.string().min(16),
});

export const LabDiagnosticEnvelopeSchema = z.object({
  protocol: z.literal("adoclive.lab-diagnostics"),
  version: z.literal(1),
  kind: z.literal("diagnostic"),
  sessionId: z.string().min(1),
  nonce: z.string().min(16),
  sequence: z.number().int().positive(),
  payload: EditorDiagnosticEventSchema,
});

export type LabDiagnosticEnvelope = z.infer<typeof LabDiagnosticEnvelopeSchema>;

export const LabTimelineEnvelopeSchema = z.object({
  protocol: z.literal("adoclive.lab-timeline"),
  version: z.literal(1),
  kind: z.literal("event"),
  sessionId: z.string().min(1),
  nonce: z.string().min(16),
  sequence: z.number().int().positive(),
  payload: LabTimelineEventSchema,
});

export const LabControlRequestSchema = z.object({
  protocol: z.literal("adoclive.lab-control"),
  version: z.literal(1),
  kind: z.literal("action"),
  sessionId: z.string().min(1),
  nonce: z.string().min(16),
  actionId: z.string().min(1),
  payload: LabTimelineEventSchema,
});

export const LabControlResultSchema = z.object({
  protocol: z.literal("adoclive.lab-control"),
  version: z.literal(1),
  kind: z.literal("result"),
  sessionId: z.string().min(1),
  nonce: z.string().min(16),
  actionId: z.string().min(1),
  ok: z.boolean(),
  error: z.string().optional(),
});

export type LabTimelineEnvelope = z.infer<typeof LabTimelineEnvelopeSchema>;
export type LabControlRequest = z.infer<typeof LabControlRequestSchema>;
export type LabControlResult = z.infer<typeof LabControlResultSchema>;
