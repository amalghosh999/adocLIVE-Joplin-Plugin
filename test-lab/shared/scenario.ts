import { z } from "zod";
import { EditorHostPushSchema } from "../../src/shared/editor-host-contracts";

export const LAB_SCENARIO_VERSION = 1 as const;

const id = z.string().min(1);
const timelineBase = { at: z.number().int().nonnegative(), sessionId: z.string().optional() };
const localStorageSeed = z.record(z.string().max(200), z.string().max(10_000)).refine(
  value => Object.keys(value).length <= 100,
  "Editor local-storage seeds are limited to 100 entries",
);

export const LabTimelineEventSchema = z.discriminatedUnion("action", [
  z.object({ ...timelineBase, action: z.literal("editor.type"), text: z.string() }),
  z.object({ ...timelineBase, action: z.literal("editor.select"), from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }),
  z.object({ ...timelineBase, action: z.literal("editor.sourceClick"), line: z.number().int().positive(), column: z.number().int().nonnegative().default(0) }),
  z.object({ ...timelineBase, action: z.literal("editor.scroll"), deltaY: z.number() }),
  z.object({ ...timelineBase, action: z.literal("editor.key"), key: z.string(), modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).default([]) }),
  z.object({ ...timelineBase, action: z.literal("editor.toolbar"), command: z.string() }),
  z.object({ ...timelineBase, action: z.literal("host.push"), push: EditorHostPushSchema }),
  z.object({ ...timelineBase, action: z.literal("host.navigate"), noteId: id }),
  z.object({ ...timelineBase, action: z.literal("host.mutate"), noteId: id, body: z.string(), title: z.string().optional() }),
  z.object({ ...timelineBase, action: z.literal("request.resolve"), requestId: id }),
  z.object({ ...timelineBase, action: z.literal("request.reject"), requestId: id, message: z.string() }),
  z.object({ ...timelineBase, action: z.literal("request.reorder"), requestIds: z.array(id) }),
  z.object({ ...timelineBase, action: z.literal("clock.advance"), milliseconds: z.number().int().nonnegative() }),
]);
export type LabTimelineEvent = z.infer<typeof LabTimelineEventSchema>;

export const LabFaultPolicySchema = z.object({
  latencyMs: z.number().int().nonnegative().default(0),
  deferRequests: z.array(z.string()).default([]),
  failRequests: z.record(z.string(), z.string()).default({}),
  duplicateRequests: z.array(z.string()).default([]),
  ordering: z.enum(["fifo", "manual", "reverse"]).default("fifo"),
  saveEcho: z.enum(["none", "same", "others", "all"]).default("others"),
  notifyExternalMutations: z.boolean().default(true),
});
export type LabFaultPolicy = z.infer<typeof LabFaultPolicySchema>;

export const LabScenarioV1Schema = z.object({
  schemaVersion: z.literal(LAB_SCENARIO_VERSION),
  id,
  title: z.string(),
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
  sessions: z.array(z.object({
    id,
    selectedNoteId: id,
    localStorage: localStorageSeed.default({}),
  })).min(1),
  notes: z.array(z.object({
    id,
    parentId: z.string().default("root"),
    title: z.string(),
    body: z.string(),
    revision: z.number().int().nonnegative().default(0),
    updatedAt: z.number().int().nonnegative().default(0),
  })).min(1),
  folders: z.array(z.object({ id, title: z.string(), parentId: z.string().nullable().default(null) })).default([]),
  resources: z.array(z.object({
    id,
    title: z.string(),
    mime: z.string(),
    dataUrl: z.string().max(1_500_000, "Inline fixture resources are limited to 1.5 MB").optional(),
    fixturePath: z.string().max(240).refine(value => /^assets\/[a-z0-9_./-]+$/i.test(value) && !value.split("/").includes(".."), "Fixture path must stay under assets/").optional(),
    delayMs: z.number().int().nonnegative().default(0),
    failure: z.string().optional(),
  }).refine(resource => Boolean(resource.dataUrl) !== Boolean(resource.fixturePath), "Resource needs exactly one data source")).default([]),
  templates: z.array(z.object({ noteId: id })).default([]),
  snippets: z.array(z.object({ id, name: z.string(), content: z.string() })).default([]),
  dictionary: z.array(z.string()).default([]),
  settings: z.object({
    compactSpacing: z.boolean().default(false),
    attributeAutocomplete: z.boolean().default(true),
    spellCheck: z.boolean().default(false),
    spellcheckMode: z.enum(["nspell", "native"]).default("native"),
    editorTheme: z.string().default("follow"),
    mermaidThemeVariables: z.string().default("{}"),
  }),
  theme: z.object({ hostDark: z.boolean().default(false), name: z.string().default("follow") }),
  faults: LabFaultPolicySchema,
  timeline: z.array(LabTimelineEventSchema).default([]),
  expectedKnownIssues: z.array(z.string().regex(/^ADL-\d{3}$/)).default([]),
  stabilization: z.object({
    mutationQuietMs: z.number().int().nonnegative().default(100),
    timeoutMs: z.number().int().positive().default(10_000),
    animationFrames: z.number().int().min(2).default(2),
  }),
});
export type LabScenarioV1 = z.infer<typeof LabScenarioV1Schema>;

type Migration = (input: Record<string, unknown>) => unknown;

const migrations = new Map<number, Migration>([
  [0, (legacy) => ({
    schemaVersion: 1,
    id: legacy.id ?? "migrated-scenario",
    title: legacy.title ?? "Migrated scenario",
    description: legacy.description ?? "Migrated from the pre-versioned laboratory format.",
    tags: legacy.tags ?? ["migrated"],
    sessions: legacy.sessions ?? [{ id: "editor-1", selectedNoteId: (legacy.note as any)?.id ?? "00000000000000000000000000000001", localStorage: {} }],
    notes: legacy.notes ?? [legacy.note ?? { id: "00000000000000000000000000000001", title: "Migrated", body: "= Migrated", parentId: "root" }],
    folders: legacy.folders ?? [{ id: "root", title: "Notes", parentId: null }],
    resources: legacy.resources ?? [],
    templates: legacy.templates ?? [],
    snippets: legacy.snippets ?? [],
    dictionary: legacy.dictionary ?? [],
    settings: legacy.settings ?? {},
    theme: legacy.theme ?? {},
    faults: legacy.faults ?? {},
    timeline: legacy.timeline ?? [],
    expectedKnownIssues: legacy.expectedKnownIssues ?? [],
    stabilization: legacy.stabilization ?? {},
  })],
]);

export function migrateLabScenario(input: unknown): LabScenarioV1 {
  if (!input || typeof input !== "object") throw new Error("Scenario must be an object");
  let candidate = input as Record<string, unknown>;
  const version = Number(candidate.schemaVersion ?? 0);
  if (!Number.isInteger(version) || version < 0) throw new Error(`Invalid scenario schema version: ${candidate.schemaVersion}`);
  if (version > LAB_SCENARIO_VERSION) throw new Error(`Unsupported future scenario schema version: ${version}`);
  for (let current = version; current < LAB_SCENARIO_VERSION; current += 1) {
    const migrate = migrations.get(current);
    if (!migrate) throw new Error(`No migration registered from scenario version ${current}`);
    candidate = migrate(candidate) as Record<string, unknown>;
  }
  return LabScenarioV1Schema.parse(candidate);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, sortJson(child)]));
}

export function serializeLabScenario(scenario: LabScenarioV1): string {
  return `${JSON.stringify(sortJson(LabScenarioV1Schema.parse(scenario)), null, 2)}\n`;
}

export function parseLabScenario(json: string): LabScenarioV1 {
  return migrateLabScenario(JSON.parse(json));
}
