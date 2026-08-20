import { z } from "zod";

export const BASELINE_SCHEMA_VERSION = 1 as const;
export const CANONICAL_PLAYWRIGHT_VERSION = "1.61.1";
export const CANONICAL_CONTAINER = "mcr.microsoft.com/playwright:v1.61.1-noble";
export const VISUAL_CANDIDATE_IDS = [
  "block-gallery",
  "block-editor-modal",
  "dark-live-preview",
  "floating-section-preview",
  "footnote-popup",
  "high-contrast-live-preview",
  "light-live-preview",
  "light-preview",
  "light-raw",
  "light-split",
  "narrow-high-contrast",
  "search-ui",
  "toolbar-dropdown",
] as const;
export const SCROLL_CANDIDATE_ID = "scroll-raw-live-raw-mid-document" as const;
export const REVIEW_ITEM_IDS = [...VISUAL_CANDIDATE_IDS, SCROLL_CANDIDATE_ID] as const;

export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 digest");
export const GitCommitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/, "Expected a full Git commit object id");
export const IsoTimestampSchema = z.string().datetime({ offset: true });
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const SafeRelativePathSchema = z.string().min(1).superRefine((value, context) => {
  if (value.includes("\\") || value.startsWith("/") || /^[a-z]:\//i.test(value) || /[\x00-\x1f\x7f]/.test(value)) {
    context.addIssue({ code: "custom", message: "Artifact paths must be portable relative paths" });
  }
  const segments = value.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) {
    context.addIssue({ code: "custom", message: "Artifact paths may not traverse or contain empty segments" });
  }
});

export const ArtifactReferenceV1Schema = z.object({
  path: SafeRelativePathSchema,
  sha256: Sha256Schema,
  bytes: z.number().int().nonnegative(),
}).strict();

export const VisualMetricsV1Schema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  threshold: z.number().min(0).max(1),
  stabilityEpsilon: z.literal(2),
  maxDiffPixelRatio: z.number().min(0).max(1),
  changedPixels: z.number().int().nonnegative(),
  diffPixelRatio: z.number().min(0).max(1),
  maxChannelDelta: z.number().int().min(0).max(255),
  dimensionsMatch: z.boolean(),
}).strict();

export const VisualCandidateV1Schema = z.object({
  id: z.enum(VISUAL_CANDIDATE_IDS),
  scenario: z.string().min(1),
  before: ArtifactReferenceV1Schema,
  candidate: ArtifactReferenceV1Schema,
  diff: ArtifactReferenceV1Schema,
  metrics: VisualMetricsV1Schema,
}).strict();

export const ScrollCandidateV1Schema = z.object({
  id: z.literal(SCROLL_CANDIDATE_ID),
  scenario: z.literal("raw-live-raw-mid-document"),
  runs: z.literal(30),
  valuesPx: z.array(z.number().nonnegative()).length(30),
  medianPx: z.number().nonnegative(),
  p99Px: z.number().nonnegative(),
  madPx: z.number().nonnegative(),
  rawLineHeightPx: z.number().positive(),
  roundingMarginPx: z.literal(1),
  regressionCeilingPx: z.number().positive(),
  quarterLineSafetyPx: z.number().positive(),
  knownIssues: z.tuple([z.literal("ADL-022"), z.literal("ADL-023")]),
  evidence: ArtifactReferenceV1Schema,
  frames: z.object({
    medianBefore: ArtifactReferenceV1Schema,
    medianAfter: ArtifactReferenceV1Schema,
    worstBefore: ArtifactReferenceV1Schema,
    worstAfter: ArtifactReferenceV1Schema,
  }).strict(),
}).strict().superRefine((value, context) => {
  const expectedCeiling = value.p99Px + Math.max(1, value.madPx);
  if (Math.abs(value.regressionCeilingPx - expectedCeiling) > Number.EPSILON) {
    context.addIssue({
      code: "custom",
      path: ["regressionCeilingPx"],
      message: "Scroll regression ceiling must equal p99 + max(1 px, MAD)",
    });
  }
  if (Math.abs(value.quarterLineSafetyPx - value.rawLineHeightPx / 4) > Number.EPSILON) {
    context.addIssue({
      code: "custom",
      path: ["quarterLineSafetyPx"],
      message: "Quarter-line safety must remain one quarter of the raw line height",
    });
  }
});

export const CandidateEnvironmentV1Schema = z.object({
  container: z.string().nullable(),
  playwrightVersion: z.string().min(1),
  browser: z.literal("chromium"),
  os: z.string().min(1),
  architecture: z.string().min(1),
  nodeVersion: z.string().min(1),
  npmVersion: z.string().min(1),
  timezone: z.literal("America/Chicago"),
  locale: z.literal("en-US"),
  deviceScaleFactor: z.literal(1),
  canonical: z.boolean(),
}).strict().superRefine((value, context) => {
  const matchesCanonicalRuntime = value.container === CANONICAL_CONTAINER
    && value.playwrightVersion === CANONICAL_PLAYWRIGHT_VERSION;
  if (value.canonical !== matchesCanonicalRuntime) {
    context.addIssue({
      code: "custom",
      path: ["canonical"],
      message: "Canonical status must agree with the pinned Noble container and Playwright version",
    });
  }
});

export const AdvisoryCountsV1Schema = z.object({
  info: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
  moderate: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  critical: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  const expected = value.info + value.low + value.moderate + value.high + value.critical;
  if (value.total !== expected) {
    context.addIssue({ code: "custom", path: ["total"], message: "Audit total must equal the sum of severity counts" });
  }
});

export const BaselineCandidateBundleV1Schema = z.object({
  schemaVersion: z.literal(BASELINE_SCHEMA_VERSION),
  kind: z.literal("BaselineCandidateBundle"),
  bundleDigest: Sha256Schema,
  createdAt: IsoTimestampSchema,
  source: z.object({
    commit: GitCommitSchema,
    clean: z.boolean(),
  }).strict(),
  package: z.object({
    name: z.string().regex(/^joplin-plugin-[a-z0-9._-]+$/, "Expected the Joplin npm discovery naming contract"),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Expected a semantic package version"),
  }).strict(),
  environment: CandidateEnvironmentV1Schema,
  lockfile: ArtifactReferenceV1Schema,
  visuals: z.array(VisualCandidateV1Schema).length(VISUAL_CANDIDATE_IDS.length).superRefine((items, context) => {
    const ids = items.map(item => item.id);
    if (new Set(ids).size !== VISUAL_CANDIDATE_IDS.length || VISUAL_CANDIDATE_IDS.some(id => !ids.includes(id))) {
      context.addIssue({ code: "custom", message: "Bundle must contain each visual candidate exactly once" });
    }
  }),
  scroll: ScrollCandidateV1Schema,
  audit: z.object({
    report: ArtifactReferenceV1Schema,
    counts: AdvisoryCountsV1Schema,
  }).strict(),
  tests: z.object({
    report: ArtifactReferenceV1Schema,
    passed: z.boolean(),
    scope: z.enum(["candidate", "release"]),
  }).strict(),
  artifacts: z.object({
    jpl: ArtifactReferenceV1Schema,
    npmTarball: ArtifactReferenceV1Schema,
    publishManifest: ArtifactReferenceV1Schema,
    pluginManifest: ArtifactReferenceV1Schema,
  }).strict(),
  finalizable: z.boolean(),
  draftReasons: z.array(z.string().min(1)),
}).strict().superRefine((value, context) => {
  const expectedFinalizable = value.source.clean
    && value.environment.canonical
    && value.audit.counts.total === 0
    && value.tests.passed
    && value.tests.scope === "release";
  if (value.finalizable !== expectedFinalizable) {
    context.addIssue({
      code: "custom",
      path: ["finalizable"],
      message: "Finalizable status must agree with source, environment, audit, and release-test evidence",
    });
  }
  if (value.finalizable && value.draftReasons.length > 0) {
    context.addIssue({ code: "custom", path: ["draftReasons"], message: "A finalizable bundle may not contain draft reasons" });
  }
  if (!value.finalizable && value.draftReasons.length === 0) {
    context.addIssue({ code: "custom", path: ["draftReasons"], message: "A draft bundle must explain why it is not finalizable" });
  }
});

export const ReviewDecisionV1Schema = z.object({
  itemId: z.enum(REVIEW_ITEM_IDS),
  decision: z.enum(["unresolved", "approved", "rejected", "regenerate"]),
  note: z.string(),
}).strict().superRefine((value, context) => {
  if ((value.decision === "rejected" || value.decision === "regenerate") && !value.note.trim()) {
    context.addIssue({ code: "custom", path: ["note"], message: "Reject and regenerate decisions require a note" });
  }
});

export const NativeDeltaCasesV1Schema = z.object({
  installStartup: z.boolean(),
  representativeRender: z.boolean(),
  themeAndViewChanges: z.boolean(),
  hostileFixture: z.boolean(),
  upgrade: z.boolean(),
}).strict();

export const NativePlatformEvidenceV1Schema = z.object({
  schemaVersion: z.literal(BASELINE_SCHEMA_VERSION),
  platform: z.enum(["windows", "macos"]),
  joplinVersion: z.string().trim().min(1),
  osVersion: z.string().trim().min(1),
  date: IsoDateSchema,
  verifier: z.string().trim().min(1),
  result: z.literal("pass"),
  deviations: z.string().trim().min(1),
  hardenedJplDelta: NativeDeltaCasesV1Schema,
}).strict().superRefine((value, context) => {
  for (const [key, passed] of Object.entries(value.hardenedJplDelta)) {
    if (!passed) context.addIssue({ code: "custom", path: ["hardenedJplDelta", key], message: "Every hardened-JPL delta case must pass" });
  }
});

const DraftNativeEvidenceSchema = z.object({
  platform: z.enum(["windows", "macos"]),
  joplinVersion: z.string(),
  osVersion: z.string(),
  date: z.string(),
  verifier: z.string(),
  result: z.enum(["", "pass", "fail"]),
  deviations: z.string(),
  hardenedJplDelta: z.object({
    installStartup: z.boolean(),
    representativeRender: z.boolean(),
    themeAndViewChanges: z.boolean(),
    hostileFixture: z.boolean(),
    upgrade: z.boolean(),
  }).strict(),
}).strict();

export const BaselineReviewDraftV1Schema = z.object({
  schemaVersion: z.literal(BASELINE_SCHEMA_VERSION),
  kind: z.literal("BaselineReviewDraft"),
  bundleDigest: Sha256Schema,
  updatedAt: IsoTimestampSchema,
  reviewer: z.string(),
  decisions: z.array(ReviewDecisionV1Schema).length(REVIEW_ITEM_IDS.length).superRefine((items, context) => {
    const ids = items.map(item => item.itemId);
    if (new Set(ids).size !== REVIEW_ITEM_IDS.length || REVIEW_ITEM_IDS.some(id => !ids.includes(id))) {
      context.addIssue({ code: "custom", message: "Draft must contain every review item exactly once" });
    }
  }),
  knownIssueAcknowledgements: z.object({
    "ADL-022": z.boolean(),
    "ADL-023": z.boolean(),
  }).strict(),
  platformEvidence: z.tuple([DraftNativeEvidenceSchema, DraftNativeEvidenceSchema]).superRefine((items, context) => {
    const platforms = new Set(items.map(item => item.platform));
    if (!platforms.has("windows") || !platforms.has("macos")) {
      context.addIssue({ code: "custom", message: "Draft requires one Windows and one macOS record" });
    }
  }),
  overallRationale: z.string(),
}).strict();

export const BaselineReviewReceiptV1Schema = z.object({
  schemaVersion: z.literal(BASELINE_SCHEMA_VERSION),
  kind: z.literal("BaselineReviewReceipt"),
  bundleDigest: Sha256Schema,
  sourceCommit: GitCommitSchema,
  artifactHashes: z.record(z.string(), Sha256Schema),
  reviewer: z.string().trim().min(1),
  reviewedAt: IsoTimestampSchema,
  decisions: z.array(ReviewDecisionV1Schema).length(REVIEW_ITEM_IDS.length).superRefine((items, context) => {
    const ids = items.map(item => item.itemId);
    if (new Set(ids).size !== REVIEW_ITEM_IDS.length || REVIEW_ITEM_IDS.some(id => !ids.includes(id))) {
      context.addIssue({ code: "custom", message: "Receipt must decide every review item exactly once" });
    }
    if (items.some(item => item.decision !== "approved")) {
      context.addIssue({ code: "custom", message: "Every receipt decision must be approved" });
    }
  }),
  knownIssueAcknowledgements: z.object({
    "ADL-022": z.literal(true),
    "ADL-023": z.literal(true),
  }).strict(),
  platformEvidence: z.tuple([NativePlatformEvidenceV1Schema, NativePlatformEvidenceV1Schema]).superRefine((items, context) => {
    const platforms = new Set(items.map(item => item.platform));
    if (!platforms.has("windows") || !platforms.has("macos")) {
      context.addIssue({ code: "custom", message: "Receipt requires one Windows and one macOS record" });
    }
  }),
  overallRationale: z.string().trim().min(1),
}).strict();

export const ProductionAuditExceptionV1Schema = z.object({
  schemaVersion: z.literal(BASELINE_SCHEMA_VERSION),
  severity: z.literal("high"),
  owner: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  compensatingControls: z.string().trim().min(1),
  advisoryIds: z.array(z.string().regex(/^(?:GHSA-[a-z0-9-]+|\d+)$/i)).min(1),
  createdAt: IsoTimestampSchema,
  expiresAt: IsoTimestampSchema,
}).strict().superRefine((value, context) => {
  const created = Date.parse(value.createdAt);
  const expires = Date.parse(value.expiresAt);
  if (expires <= created || expires - created > 30 * 24 * 60 * 60 * 1000) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "Audit exceptions must expire within 30 days" });
  }
});

export const ProductionAuditExceptionCatalogV1Schema = z.object({
  schemaVersion: z.literal(BASELINE_SCHEMA_VERSION),
  exceptions: z.array(ProductionAuditExceptionV1Schema),
}).strict();

export type ArtifactReferenceV1 = z.infer<typeof ArtifactReferenceV1Schema>;
export type BaselineCandidateBundleV1 = z.infer<typeof BaselineCandidateBundleV1Schema>;
export type BaselineReviewDraftV1 = z.infer<typeof BaselineReviewDraftV1Schema>;
export type BaselineReviewReceiptV1 = z.infer<typeof BaselineReviewReceiptV1Schema>;
export type NativePlatformEvidenceV1 = z.infer<typeof NativePlatformEvidenceV1Schema>;
export type ProductionAuditExceptionV1 = z.infer<typeof ProductionAuditExceptionV1Schema>;

export function parseKnownBaselineContract(value: unknown):
  | BaselineCandidateBundleV1
  | BaselineReviewDraftV1
  | BaselineReviewReceiptV1
  | NativePlatformEvidenceV1
  | ProductionAuditExceptionV1 {
  if (!value || typeof value !== "object" || (value as { schemaVersion?: unknown }).schemaVersion !== BASELINE_SCHEMA_VERSION) {
    throw new Error(`Unsupported baseline schema version: ${String((value as { schemaVersion?: unknown } | null)?.schemaVersion)}`);
  }
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "BaselineCandidateBundle") return BaselineCandidateBundleV1Schema.parse(value);
  if (kind === "BaselineReviewDraft") return BaselineReviewDraftV1Schema.parse(value);
  if (kind === "BaselineReviewReceipt") return BaselineReviewReceiptV1Schema.parse(value);
  if ((value as { platform?: unknown }).platform) return NativePlatformEvidenceV1Schema.parse(value);
  if ((value as { severity?: unknown }).severity) return ProductionAuditExceptionV1Schema.parse(value);
  throw new Error(`Unsupported baseline contract kind: ${String(kind)}`);
}

export function migrateDraftNotesToBundle(
  previous: BaselineReviewDraftV1,
  bundleDigest: string,
  updatedAt: string,
): BaselineReviewDraftV1 {
  const notes = new Map(previous.decisions.map(item => [item.itemId, item.note]));
  return BaselineReviewDraftV1Schema.parse({
    ...previous,
    bundleDigest,
    updatedAt,
    decisions: REVIEW_ITEM_IDS.map(itemId => ({ itemId, decision: "unresolved", note: notes.get(itemId) || "" })),
    knownIssueAcknowledgements: { "ADL-022": false, "ADL-023": false },
    platformEvidence: (["windows", "macos"] as const).map(platform => ({
      platform,
      joplinVersion: "",
      osVersion: "",
      date: "",
      verifier: "",
      result: "",
      deviations: "",
      hardenedJplDelta: {
        installStartup: false,
        representativeRender: false,
        themeAndViewChanges: false,
        hostileFixture: false,
        upgrade: false,
      },
    })),
    overallRationale: "",
  });
}
