import {
  EDITOR_HOST_REQUEST_TYPES,
  EditorHostRequestSchema,
  EditorProtocolError,
  parseEditorHostResponse,
  type EditorHostRequest,
  type EditorHostRequestOf,
  type EditorHostRequestType,
  type EditorHostResponse,
} from "../shared/editor-host-contracts";

export interface EditorSessionContext {
  sessionId: string;
  handleId?: string;
  selectedNoteId?: string;
  signal?: AbortSignal;
}

export function createEditorHostOperations(
  handler: (request: EditorHostRequest, context: EditorSessionContext) => Promise<unknown> | unknown,
): EditorHostOperations {
  return Object.fromEntries(EDITOR_HOST_REQUEST_TYPES.map(type => [
    type,
    (request: EditorHostRequest, context: EditorSessionContext) => handler(request, context),
  ])) as EditorHostOperations;
}

export type EditorHostOperation<K extends EditorHostRequestType> = (
  request: EditorHostRequestOf<K>,
  context: EditorSessionContext,
) => Promise<EditorHostResponse<K>> | EditorHostResponse<K>;

export type EditorHostOperations = {
  [K in EditorHostRequestType]: EditorHostOperation<K>;
};

/** Shared validation/routing core used by production and laboratory adapters. */
export class EditorRpcService {
  constructor(private readonly operations: EditorHostOperations) {}

  async request(input: unknown, context: EditorSessionContext): Promise<unknown> {
    if (context.signal?.aborted) throw new EditorProtocolError("SESSION_CLOSED", "Editor session is closed");
    const parsed = EditorHostRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new EditorProtocolError("INVALID_REQUEST", "Invalid editor-host request", parsed.error.flatten());
    }
    const request = parsed.data;
    const operation = this.operations[request.type] as (
      value: EditorHostRequest,
      session: EditorSessionContext,
    ) => Promise<unknown> | unknown;
    try {
      const result = await operation(request, context);
      return parseEditorHostResponse(request.type, result);
    } catch (error) {
      if (error instanceof EditorProtocolError) throw error;
      throw new EditorProtocolError("HOST_FAILURE", `Host operation ${request.type} failed`, error);
    }
  }
}
