import { z } from "zod";

export const EDITOR_HOST_PROTOCOL = "adoclive.editor-host" as const;
export const EDITOR_HOST_PROTOCOL_VERSION = 1 as const;

const nonEmptyString = z.string().min(1);
const statusSchema = z.enum(["ok", "saved", "error"]);

export const NoteValueSchema = z.object({
  id: nonEmptyString,
  body: z.string(),
  html: z.string().optional(),
});

export const SnippetSchema = z.object({
  id: nonEmptyString,
  name: z.string(),
  content: z.string(),
});

export const ResolvedXrefTargetSchema = z.object({
  noteId: nonEmptyString,
  title: z.string(),
  sectionAnchor: z.string().optional(),
  targetLine: z.number().int().positive().optional(),
});

export const IncludeTargetSchema = z.object({
  id: nonEmptyString,
  title: z.string(),
  displayPath: z.string(),
  insertText: z.string(),
});

const requestSchemas = {
  ready: z.object({ type: z.literal("ready") }),
  saveNote: z.object({ type: z.literal("saveNote"), noteId: z.string().optional(), body: z.string() }),
  getNoteContent: z.object({ type: z.literal("getNoteContent"), noteId: nonEmptyString }),
  renderAsciidoc: z.object({ type: z.literal("renderAsciidoc"), source: z.string() }),
  requestResources: z.object({ type: z.literal("requestResources"), resourceIds: z.array(nonEmptyString) }),
  openImageDialog: z.object({ type: z.literal("openImageDialog") }),
  openVideoDialog: z.object({ type: z.literal("openVideoDialog") }),
  openAudioDialog: z.object({ type: z.literal("openAudioDialog") }),
  createResourceFromFile: z.object({ type: z.literal("createResourceFromFile"), filePath: nonEmptyString }),
  createResourceFromBytes: z.object({
    type: z.literal("createResourceFromBytes"),
    fileName: nonEmptyString,
    mimeType: z.string(),
    dataBase64: z.string(),
  }),
  searchNotes: z.object({
    type: z.literal("searchNotes"),
    query: z.string(),
    mode: z.enum(["autocomplete", "search"]).optional(),
    fromNoteId: z.string().optional(),
  }),
  getIncludeTargets: z.object({ type: z.literal("getIncludeTargets"), fromNoteId: z.string(), query: z.string() }),
  resolveXrefTarget: z.object({ type: z.literal("resolveXrefTarget"), fromNoteId: z.string(), target: z.string() }),
  getNoteSections: z.object({ type: z.literal("getNoteSections"), noteId: nonEmptyString }),
  navigateToNote: z.object({ type: z.literal("navigateToNote"), noteId: nonEmptyString }),
  getTemplates: z.object({ type: z.literal("getTemplates") }),
  getTemplateContent: z.object({ type: z.literal("getTemplateContent"), noteId: nonEmptyString }),
  markAsTemplate: z.object({ type: z.literal("markAsTemplate") }),
  removeTemplate: z.object({ type: z.literal("removeTemplate"), noteId: nonEmptyString }),
  getSpellcheckSettings: z.object({ type: z.literal("getSpellcheckSettings") }),
  getPersonalDictionary: z.object({ type: z.literal("getPersonalDictionary") }),
  addWordToPersonalDictionary: z.object({ type: z.literal("addWordToPersonalDictionary"), word: nonEmptyString }),
  getSnippets: z.object({ type: z.literal("getSnippets") }),
  addSnippet: z.object({ type: z.literal("addSnippet"), name: nonEmptyString, content: z.string() }),
  updateSnippet: z.object({ type: z.literal("updateSnippet"), id: nonEmptyString, name: nonEmptyString, content: z.string() }),
  removeSnippet: z.object({ type: z.literal("removeSnippet"), id: nonEmptyString }),
  setFullscreenMode: z.object({ type: z.literal("setFullscreenMode"), enabled: z.boolean() }),
  convertMarkdownPaste: z.object({ type: z.literal("convertMarkdownPaste"), markdown: z.string() }),
} as const;

export const EditorHostRequestSchema = z.discriminatedUnion("type", [
  requestSchemas.ready,
  requestSchemas.saveNote,
  requestSchemas.getNoteContent,
  requestSchemas.renderAsciidoc,
  requestSchemas.requestResources,
  requestSchemas.openImageDialog,
  requestSchemas.openVideoDialog,
  requestSchemas.openAudioDialog,
  requestSchemas.createResourceFromFile,
  requestSchemas.createResourceFromBytes,
  requestSchemas.searchNotes,
  requestSchemas.getIncludeTargets,
  requestSchemas.resolveXrefTarget,
  requestSchemas.getNoteSections,
  requestSchemas.navigateToNote,
  requestSchemas.getTemplates,
  requestSchemas.getTemplateContent,
  requestSchemas.markAsTemplate,
  requestSchemas.removeTemplate,
  requestSchemas.getSpellcheckSettings,
  requestSchemas.getPersonalDictionary,
  requestSchemas.addWordToPersonalDictionary,
  requestSchemas.getSnippets,
  requestSchemas.addSnippet,
  requestSchemas.updateSnippet,
  requestSchemas.removeSnippet,
  requestSchemas.setFullscreenMode,
  requestSchemas.convertMarkdownPaste,
]);
export type EditorHostRequest = z.infer<typeof EditorHostRequestSchema>;
export type EditorHostRequestType = EditorHostRequest["type"];
export type EditorHostRequestOf<T extends EditorHostRequestType> = Extract<EditorHostRequest, { type: T }>;
export const EDITOR_HOST_REQUEST_TYPES = Object.freeze(Object.keys(requestSchemas) as EditorHostRequestType[]);

const noteSearchItemSchema = z.object({
  id: nonEmptyString,
  title: z.string(),
  isAsciiDoc: z.boolean().default(false),
}).passthrough();

const resourceResultSchema = z.object({
  resourceId: z.string().default(""),
  title: z.string().default(""),
  dataUrl: z.string().optional(),
  error: z.string().optional(),
});

export const EditorHostResponseSchemas = {
  ready: z.object({
    isDark: z.boolean().optional(),
    compactSpacing: z.boolean().optional(),
    attributeAutocomplete: z.boolean().optional(),
    spellCheck: z.boolean().optional(),
    spellcheckMode: z.enum(["nspell", "native"]).optional(),
    editorTheme: z.string().optional(),
    mermaidThemeVariables: z.string().optional(),
    note: NoteValueSchema.optional(),
  }),
  saveNote: z.object({ status: statusSchema, error: z.string().optional() }),
  getNoteContent: z.object({ id: z.string(), title: z.string(), body: z.string() }),
  renderAsciidoc: z.object({ html: z.string() }),
  requestResources: z.object({ resources: z.array(z.object({ id: nonEmptyString, dataUrl: z.string() })) }),
  openImageDialog: z.object({ filePath: z.string().nullable() }),
  openVideoDialog: z.object({ filePath: z.string().nullable() }),
  openAudioDialog: z.object({ filePath: z.string().nullable() }),
  createResourceFromFile: resourceResultSchema,
  createResourceFromBytes: resourceResultSchema,
  searchNotes: z.object({ notes: z.array(noteSearchItemSchema) }),
  getIncludeTargets: z.object({ targets: z.array(IncludeTargetSchema) }),
  resolveXrefTarget: z.object({ target: ResolvedXrefTargetSchema.nullable() }),
  getNoteSections: z.object({ sections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    level: z.number().int().positive(),
    lineNumber: z.number().int().positive().optional(),
    reftext: z.string().optional(),
  })) }),
  navigateToNote: z.object({ status: statusSchema }),
  getTemplates: z.object({ templates: z.array(z.object({ id: nonEmptyString, title: z.string() }).passthrough()) }),
  getTemplateContent: z.object({ content: z.string(), error: z.string().optional() }),
  markAsTemplate: z.object({ status: statusSchema }),
  removeTemplate: z.object({ status: statusSchema }),
  getSpellcheckSettings: z.object({ pluralSingular: z.boolean(), mode: z.enum(["nspell", "native"]).optional() }),
  getPersonalDictionary: z.object({ words: z.array(z.string()) }),
  addWordToPersonalDictionary: z.object({ status: statusSchema }),
  getSnippets: z.object({ snippets: z.array(SnippetSchema) }),
  addSnippet: z.object({ status: statusSchema, snippet: SnippetSchema.optional(), error: z.string().optional() }),
  updateSnippet: z.object({ status: statusSchema, error: z.string().optional() }),
  removeSnippet: z.object({ status: statusSchema }),
  setFullscreenMode: z.object({ status: statusSchema }),
  convertMarkdownPaste: z.object({ asciidoc: z.string() }),
} as const satisfies Record<EditorHostRequestType, z.ZodType>;

export type EditorHostResponseMap = {
  [K in EditorHostRequestType]: z.infer<(typeof EditorHostResponseSchemas)[K]>;
};
export type EditorHostResponse<T extends EditorHostRequestType> = EditorHostResponseMap[T];

export const EditorHostPushSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("updateNote"), value: NoteValueSchema }),
  z.object({ type: z.literal("updateTheme"), value: z.enum(["light", "dark"]) }),
  z.object({
    type: z.literal("updateEditorTheme"),
    editorTheme: z.string(),
    mermaidThemeVariables: z.string(),
    isDark: z.boolean(),
  }),
  z.object({ type: z.literal("updateCompactSpacing"), value: z.boolean() }),
  z.object({ type: z.literal("updateAttributeAutocomplete"), enabled: z.boolean() }),
  z.object({ type: z.literal("updateSpellCheck"), enabled: z.boolean(), mode: z.enum(["nspell", "native"]).optional() }),
]);
export type EditorHostPush = z.infer<typeof EditorHostPushSchema>;

const envelopeBase = {
  protocol: z.literal(EDITOR_HOST_PROTOCOL),
  version: z.literal(EDITOR_HOST_PROTOCOL_VERSION),
  sessionId: nonEmptyString,
  nonce: nonEmptyString,
};

export const EditorRequestEnvelopeSchema = z.object({
  ...envelopeBase,
  kind: z.literal("request"),
  requestId: nonEmptyString,
  payload: EditorHostRequestSchema,
});

export const EditorResponseEnvelopeSchema = z.object({
  ...envelopeBase,
  kind: z.literal("response"),
  requestId: nonEmptyString,
  requestType: z.enum(Object.keys(requestSchemas) as [EditorHostRequestType, ...EditorHostRequestType[]]),
  payload: z.unknown(),
});

export const EditorErrorEnvelopeSchema = z.object({
  ...envelopeBase,
  kind: z.literal("error"),
  requestId: z.string().optional(),
  code: z.enum(["INVALID_ENVELOPE", "INVALID_REQUEST", "INVALID_RESPONSE", "DUPLICATE_REQUEST", "STALE_SEQUENCE", "MISSING_SEQUENCE", "HOST_FAILURE", "SESSION_CLOSED"]),
  message: z.string(),
  details: z.unknown().optional(),
});

export const EditorPushEnvelopeSchema = z.object({
  ...envelopeBase,
  kind: z.literal("push"),
  sequence: z.number().int().positive(),
  payload: EditorHostPushSchema,
});

export const EditorHostEnvelopeSchema = z.discriminatedUnion("kind", [
  EditorRequestEnvelopeSchema,
  EditorResponseEnvelopeSchema,
  EditorErrorEnvelopeSchema,
  EditorPushEnvelopeSchema,
]);

export type EditorRequestEnvelope = z.infer<typeof EditorRequestEnvelopeSchema>;
export type EditorResponseEnvelope = z.infer<typeof EditorResponseEnvelopeSchema>;
export type EditorErrorEnvelope = z.infer<typeof EditorErrorEnvelopeSchema>;
export type EditorPushEnvelope = z.infer<typeof EditorPushEnvelopeSchema>;
export type EditorHostEnvelope = z.infer<typeof EditorHostEnvelopeSchema>;

export function parseEditorHostResponse<T extends EditorHostRequestType>(type: T, value: unknown): EditorHostResponse<T> {
  return EditorHostResponseSchemas[type].parse(value) as EditorHostResponse<T>;
}

export class EditorProtocolError extends Error {
  constructor(
    readonly code: z.infer<typeof EditorErrorEnvelopeSchema>["code"],
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "EditorProtocolError";
  }
}
