import {
  EDITOR_HOST_PROTOCOL,
  EDITOR_HOST_PROTOCOL_VERSION,
  EditorRequestEnvelopeSchema,
  EditorProtocolError,
  type EditorErrorEnvelope,
  type EditorHostPush,
  type EditorPushEnvelope,
  type EditorResponseEnvelope,
} from "../../src/shared/editor-host-contracts";
import { EditorRpcService } from "../../src/host/editor-rpc-service";
import { LabDiagnosticEnvelopeSchema, LabTimelineEnvelopeSchema } from "../shared/lab-protocol";
import type { LabDiagnosticEvent } from "../shared/lab-schemas";
import type { LabTimelineEvent } from "../shared/scenario";
import { LabControllerStore } from "./store";

export interface LabSessionBridgeOptions {
  sessionId: string;
  nonce: string;
  port: MessagePort;
  store: LabControllerStore;
  onDiagnostic?: (event: LabDiagnosticEvent) => void;
  onTimeline?: (event: LabTimelineEvent) => void;
  onPendingChange?: () => void;
}

export class LabSessionBridge {
  private readonly service: EditorRpcService;
  private readonly seenRequestIds = new Set<string>();
  private readonly abortController = new AbortController();
  private pushSequence = 0;
  private diagnosticSequence = 0;
  private timelineSequence = 0;
  private unsubscribePush: (() => void) | null = null;
  private closed = false;

  constructor(private readonly options: LabSessionBridgeOptions) {
    this.service = new EditorRpcService(options.store.operations);
    options.store.ensureSession(options.sessionId);
    this.unsubscribePush = options.store.subscribe(options.sessionId, push => this.sendPush(push));
    options.port.addEventListener("message", this.handleMessage);
    options.port.start();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abortController.abort();
    this.unsubscribePush?.();
    this.unsubscribePush = null;
    this.options.port.removeEventListener("message", this.handleMessage);
    this.options.port.close();
    this.options.store.destroySession(this.options.sessionId);
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    const timeline = LabTimelineEnvelopeSchema.safeParse(event.data);
    if (timeline.success) {
      if (!this.matches(timeline.data)) return;
      if (timeline.data.sequence !== this.timelineSequence + 1) {
        this.sendError("MISSING_SEQUENCE", `Expected timeline sequence ${this.timelineSequence + 1}`, undefined);
        return;
      }
      this.timelineSequence = timeline.data.sequence;
      this.options.onTimeline?.({
        ...timeline.data.payload,
        sessionId: this.options.sessionId,
        at: this.options.store.scheduler.now,
      });
      return;
    }

    const diagnostic = LabDiagnosticEnvelopeSchema.safeParse(event.data);
    if (diagnostic.success) {
      if (!this.matches(diagnostic.data)) return;
      if (diagnostic.data.sequence !== this.diagnosticSequence + 1) {
        this.sendError("MISSING_SEQUENCE", `Expected diagnostic sequence ${this.diagnosticSequence + 1}`, undefined);
        return;
      }
      this.diagnosticSequence = diagnostic.data.sequence;
      this.options.onDiagnostic?.({
        ...diagnostic.data.payload,
        sessionId: this.options.sessionId,
        sequence: diagnostic.data.sequence,
      });
      return;
    }

    const parsed = EditorRequestEnvelopeSchema.safeParse(event.data);
    if (!parsed.success) {
      this.sendError("INVALID_ENVELOPE", "Malformed request envelope", undefined, parsed.error.flatten());
      return;
    }
    const envelope = parsed.data;
    if (!this.matches(envelope)) return;
    if (this.seenRequestIds.has(envelope.requestId)) {
      this.sendError("DUPLICATE_REQUEST", `Duplicate request ID ${envelope.requestId}`, envelope.requestId);
      return;
    }
    this.seenRequestIds.add(envelope.requestId);
    this.options.store.recordRequest(envelope.payload.type, this.options.sessionId, { requestId: envelope.requestId });

    const failure = this.options.store.faultPolicy.failRequests[envelope.payload.type];
    if (failure) {
      this.options.store.recordError(envelope.payload.type, this.options.sessionId, failure);
      this.sendError("HOST_FAILURE", failure, envelope.requestId);
      return;
    }

    const execute = async () => {
      try {
        const payload = await this.service.request(envelope.payload, {
          sessionId: this.options.sessionId,
          signal: this.abortController.signal,
        });
        if (this.closed) return;
        const response: EditorResponseEnvelope = {
          protocol: EDITOR_HOST_PROTOCOL,
          version: EDITOR_HOST_PROTOCOL_VERSION,
          kind: "response",
          sessionId: this.options.sessionId,
          nonce: this.options.nonce,
          requestId: envelope.requestId,
          requestType: envelope.payload.type,
          payload,
        };
        this.options.port.postMessage(response);
        if (this.options.store.faultPolicy.duplicateRequests.includes(envelope.payload.type)) {
          queueMicrotask(() => this.options.port.postMessage(response));
        }
      } catch (error) {
        this.options.store.recordError(envelope.payload.type, this.options.sessionId, error);
        const protocolError = error instanceof EditorProtocolError
          ? error
          : new EditorProtocolError("HOST_FAILURE", error instanceof Error ? error.message : String(error), error);
        this.sendError(protocolError.code, protocolError.message, envelope.requestId, protocolError.details);
      } finally {
        this.options.onPendingChange?.();
      }
    };

    const policy = this.options.store.faultPolicy;
    if (policy.deferRequests.includes(envelope.payload.type) || policy.ordering === "manual" || policy.latencyMs > 0) {
      this.options.store.scheduler.schedule(`rpc:${this.options.sessionId}:${envelope.payload.type}:${envelope.requestId}`, policy.latencyMs, execute);
      if (policy.ordering === "reverse") {
        this.options.store.scheduler.reorder(this.options.store.scheduler.pending.map(task => task.id).reverse());
      }
      this.options.onPendingChange?.();
    } else {
      void execute();
    }
  };

  private sendPush(push: EditorHostPush): void {
    if (this.closed) return;
    const envelope: EditorPushEnvelope = {
      protocol: EDITOR_HOST_PROTOCOL,
      version: EDITOR_HOST_PROTOCOL_VERSION,
      kind: "push",
      sessionId: this.options.sessionId,
      nonce: this.options.nonce,
      sequence: ++this.pushSequence,
      payload: push,
    };
    this.options.port.postMessage(envelope);
  }

  private sendError(code: EditorErrorEnvelope["code"], message: string, requestId?: string, details?: unknown): void {
    if (this.closed) return;
    const envelope: EditorErrorEnvelope = {
      protocol: EDITOR_HOST_PROTOCOL,
      version: EDITOR_HOST_PROTOCOL_VERSION,
      kind: "error",
      sessionId: this.options.sessionId,
      nonce: this.options.nonce,
      requestId,
      code,
      message,
      details,
    };
    this.options.port.postMessage(envelope);
  }

  private matches(envelope: { sessionId: string; nonce: string }): boolean {
    if (envelope.sessionId === this.options.sessionId && envelope.nonce === this.options.nonce) return true;
    this.sendError("INVALID_ENVELOPE", "Session or nonce mismatch", undefined);
    return false;
  }
}
