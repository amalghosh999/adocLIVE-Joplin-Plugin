import {
  EDITOR_HOST_PROTOCOL,
  EDITOR_HOST_PROTOCOL_VERSION,
  EditorErrorEnvelopeSchema,
  EditorHostPushSchema,
  EditorPushEnvelopeSchema,
  EditorResponseEnvelopeSchema,
  EditorProtocolError,
  parseEditorHostResponse,
  type EditorHostPush,
  type EditorHostRequest,
  type EditorHostRequestOf,
  type EditorHostRequestType,
  type EditorHostResponse,
  type EditorRequestEnvelope,
} from "../shared/editor-host-contracts";
import { emitEditorDiagnostic } from "../shared/editor-diagnostics";

export interface EditorTransport {
  request<T extends EditorHostRequestType>(request: EditorHostRequestOf<T>): Promise<EditorHostResponse<T>>;
  subscribe(callback: (push: EditorHostPush) => void): () => void;
  close?(): void;
}

export interface JoplinWebviewApi {
  postMessage(message: unknown): Promise<unknown>;
  onMessage(callback: (message: unknown) => void): void;
}

export class ProductionWebviewTransport implements EditorTransport {
  private readonly subscribers = new Set<(push: EditorHostPush) => void>();

  constructor(private readonly api: JoplinWebviewApi) {
    api.onMessage((message) => {
      const unwrapped = typeof message === "object" && message !== null && "message" in message
        ? (message as { message: unknown }).message
        : message;
      const parsed = EditorHostPushSchema.safeParse(unwrapped);
      if (!parsed.success) {
        console.error("[adocLIVE] Rejected malformed host push", parsed.error);
        emitEditorDiagnostic("transport", "push-rejected", "error", { issues: parsed.error.issues.length });
        return;
      }
      emitEditorDiagnostic("transport", parsed.data.type, "end", { direction: "push" });
      for (const subscriber of this.subscribers) subscriber(parsed.data);
    });
  }

  async request<T extends EditorHostRequestType>(request: EditorHostRequestOf<T>): Promise<EditorHostResponse<T>> {
    emitEditorDiagnostic("transport", request.type, "start", { direction: "request" });
    const raw = await this.api.postMessage(request);
    const parsed = parseEditorHostResponse(request.type, raw);
    emitEditorDiagnostic("transport", request.type, "end", { direction: "response" });
    return parsed;
  }

  subscribe(callback: (push: EditorHostPush) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
}

interface PendingRequest {
  type: EditorHostRequestType;
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

export interface MessagePortEditorTransportOptions {
  sessionId: string;
  nonce: string;
  port: MessagePort;
  requestId?: () => string;
  onProtocolError?: (error: EditorProtocolError) => void;
}

export class MessagePortEditorTransport implements EditorTransport {
  private readonly subscribers = new Set<(push: EditorHostPush) => void>();
  private readonly pending = new Map<string, PendingRequest>();
  private requestSequence = 0;
  private pushSequence = 0;
  private closed = false;
  private readonly nextRequestId: () => string;

  constructor(private readonly options: MessagePortEditorTransportOptions) {
    this.nextRequestId = options.requestId ?? (() => `${options.sessionId}:${++this.requestSequence}`);
    options.port.addEventListener("message", this.handleMessage);
    options.port.start();
  }

  request<T extends EditorHostRequestType>(request: EditorHostRequestOf<T>): Promise<EditorHostResponse<T>> {
    if (this.closed) return Promise.reject(new EditorProtocolError("SESSION_CLOSED", "Editor transport is closed"));
    const requestId = this.nextRequestId();
    const envelope: EditorRequestEnvelope = {
      protocol: EDITOR_HOST_PROTOCOL,
      version: EDITOR_HOST_PROTOCOL_VERSION,
      kind: "request",
      sessionId: this.options.sessionId,
      nonce: this.options.nonce,
      requestId,
      payload: request as EditorHostRequest,
    };
    return new Promise<EditorHostResponse<T>>((resolve, reject) => {
      this.pending.set(requestId, {
        type: request.type,
        resolve: value => resolve(value as EditorHostResponse<T>),
        reject,
      });
      emitEditorDiagnostic("transport", request.type, "start", { requestId });
      this.options.port.postMessage(envelope);
    });
  }

  subscribe(callback: (push: EditorHostPush) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.options.port.removeEventListener("message", this.handleMessage);
    this.options.port.close();
    const error = new EditorProtocolError("SESSION_CLOSED", "Editor transport closed");
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.subscribers.clear();
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    const response = EditorResponseEnvelopeSchema.safeParse(event.data);
    if (response.success) {
      if (!this.matchesSession(response.data)) return;
      const pending = this.pending.get(response.data.requestId);
      if (!pending) {
        this.report(new EditorProtocolError("DUPLICATE_REQUEST", `Unknown or duplicate response ${response.data.requestId}`));
        return;
      }
      if (pending.type !== response.data.requestType) {
        this.pending.delete(response.data.requestId);
        pending.reject(new EditorProtocolError("INVALID_RESPONSE", "Response type does not match request"));
        return;
      }
      try {
        const payload = parseEditorHostResponse(pending.type, response.data.payload);
        this.pending.delete(response.data.requestId);
        emitEditorDiagnostic("transport", pending.type, "end", { requestId: response.data.requestId });
        pending.resolve(payload);
      } catch (error) {
        this.pending.delete(response.data.requestId);
        pending.reject(new EditorProtocolError("INVALID_RESPONSE", "Host returned an invalid response", error));
      }
      return;
    }

    const push = EditorPushEnvelopeSchema.safeParse(event.data);
    if (push.success) {
      if (!this.matchesSession(push.data)) return;
      const expected = this.pushSequence + 1;
      if (push.data.sequence < expected) {
        this.report(new EditorProtocolError("STALE_SEQUENCE", `Stale push sequence ${push.data.sequence}`));
        return;
      }
      if (push.data.sequence > expected) {
        this.report(new EditorProtocolError("MISSING_SEQUENCE", `Expected push sequence ${expected}, received ${push.data.sequence}`));
        return;
      }
      this.pushSequence = push.data.sequence;
      emitEditorDiagnostic("transport", push.data.payload.type, "end", { sequence: push.data.sequence });
      for (const subscriber of this.subscribers) subscriber(push.data.payload);
      return;
    }

    const failure = EditorErrorEnvelopeSchema.safeParse(event.data);
    if (failure.success) {
      if (!this.matchesSession(failure.data)) return;
      const error = new EditorProtocolError(failure.data.code, failure.data.message, failure.data.details);
      if (failure.data.requestId) {
        const pending = this.pending.get(failure.data.requestId);
        if (pending) {
          this.pending.delete(failure.data.requestId);
          pending.reject(error);
          return;
        }
      }
      this.report(error);
      return;
    }

    this.report(new EditorProtocolError("INVALID_ENVELOPE", "Received malformed editor-host envelope", event.data));
  };

  private matchesSession(envelope: { sessionId: string; nonce: string }): boolean {
    if (envelope.sessionId === this.options.sessionId && envelope.nonce === this.options.nonce) return true;
    this.report(new EditorProtocolError("INVALID_ENVELOPE", "Envelope session or nonce mismatch"));
    return false;
  }

  private report(error: EditorProtocolError): void {
    emitEditorDiagnostic("transport", "protocol-error", "error", { code: error.code, message: error.message });
    this.options.onProtocolError?.(error);
  }
}

let configuredTransport: EditorTransport | null = null;

declare global {
  // Installed only by the separate Test Lab bootstrap before panel.js loads.
  var __ADOC_EDITOR_TRANSPORT__: EditorTransport | undefined;
  var webviewApi: JoplinWebviewApi | undefined;
}

export function configureEditorTransport(transport: EditorTransport): void {
  configuredTransport?.close?.();
  configuredTransport = transport;
}

export function getEditorTransport(): EditorTransport {
  if (configuredTransport) return configuredTransport;
  if (globalThis.__ADOC_EDITOR_TRANSPORT__) {
    configuredTransport = globalThis.__ADOC_EDITOR_TRANSPORT__;
    return configuredTransport;
  }
  if (!globalThis.webviewApi) throw new Error("adocLIVE editor transport is unavailable");
  configuredTransport = new ProductionWebviewTransport(globalThis.webviewApi);
  return configuredTransport;
}

export function subscribeToHostPush(callback: (push: EditorHostPush) => void): () => void {
  return getEditorTransport().subscribe(callback);
}
