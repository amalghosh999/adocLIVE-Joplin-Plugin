import type { EditorHostRequestType } from "../shared/editor-host-contracts";
import type { EditorHostOperations } from "./editor-rpc-service";

const CAPABILITY_REQUESTS = {
  notes: ["ready", "saveNote", "getNoteContent", "searchNotes", "getNoteSections"],
  resources: ["requestResources", "openImageDialog", "openVideoDialog", "openAudioDialog", "createResourceFromFile", "createResourceFromBytes"],
  rendering: ["renderAsciidoc", "convertMarkdownPaste"],
  links: ["getIncludeTargets", "resolveXrefTarget"],
  templates: ["getTemplates", "getTemplateContent", "markAsTemplate", "removeTemplate"],
  settings: ["getSpellcheckSettings", "getPersonalDictionary", "addWordToPersonalDictionary", "getSnippets", "addSnippet", "updateSnippet", "removeSnippet"],
  navigation: ["navigateToNote"],
  layout: ["setFullscreenMode"],
} as const satisfies Record<string, readonly EditorHostRequestType[]>;

type RequestsFor<K extends keyof typeof CAPABILITY_REQUESTS> = (typeof CAPABILITY_REQUESTS)[K][number];
type CapabilityPort<K extends keyof typeof CAPABILITY_REQUESTS> = Pick<EditorHostOperations, RequestsFor<K>>;

export interface EditorHostPorts {
  notes: CapabilityPort<"notes">;
  resources: CapabilityPort<"resources">;
  rendering: CapabilityPort<"rendering">;
  links: CapabilityPort<"links">;
  templates: CapabilityPort<"templates">;
  settings: CapabilityPort<"settings">;
  navigation: CapabilityPort<"navigation">;
  layout: CapabilityPort<"layout">;
}

export interface EditorHostClockPort {
  now(): number;
}

export interface EditorHostIdPort {
  next(prefix: string): string;
}

function pickOperations<K extends keyof typeof CAPABILITY_REQUESTS>(
  operations: EditorHostOperations,
  capability: K,
): CapabilityPort<K> {
  return Object.fromEntries(CAPABILITY_REQUESTS[capability].map(type => [type, operations[type]])) as CapabilityPort<K>;
}

/**
 * Builds the capability boundary used by both the concrete Joplin adapter and
 * the deterministic in-memory adapter. Each request belongs to exactly one
 * port; EditorRpcService remains the validation and session-aware routing core.
 */
export function createEditorHostPorts(operations: EditorHostOperations): EditorHostPorts {
  return {
    notes: pickOperations(operations, "notes"),
    resources: pickOperations(operations, "resources"),
    rendering: pickOperations(operations, "rendering"),
    links: pickOperations(operations, "links"),
    templates: pickOperations(operations, "templates"),
    settings: pickOperations(operations, "settings"),
    navigation: pickOperations(operations, "navigation"),
    layout: pickOperations(operations, "layout"),
  };
}

export function createEditorHostApplication(ports: EditorHostPorts): EditorHostOperations {
  return {
    ...ports.notes,
    ...ports.resources,
    ...ports.rendering,
    ...ports.links,
    ...ports.templates,
    ...ports.settings,
    ...ports.navigation,
    ...ports.layout,
  };
}

export const EDITOR_HOST_CAPABILITY_REQUESTS = CAPABILITY_REQUESTS;
