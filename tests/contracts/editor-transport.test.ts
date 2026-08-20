import { describe, expect, it } from "vitest";
import { MessagePortEditorTransport, ProductionWebviewTransport } from "../../src/lib/editor-transport";
import { EDITOR_HOST_PROTOCOL, EDITOR_HOST_PROTOCOL_VERSION, type EditorHostEnvelope, type EditorHostPush } from "../../src/shared/editor-host-contracts";

const sessionId = "editor-transport-test";
const nonce = "0123456789abcdef0123456789abcdef";

function channelTransport(errors: Array<{ code: string }> = []) {
  const channel = new MessageChannel();
  const transport = new MessagePortEditorTransport({ sessionId, nonce, port: channel.port1, onProtocolError: error => errors.push(error) });
  channel.port2.start();
  return { channel, transport };
}

describe("editor transports", () => {
  it("maps production request responses and validates pushes", async () => {
    let onMessage: (message: unknown) => void = () => {};
    const api = {
      postMessage: async (request: any) => request.type === "ready" ? { isDark: false } : undefined,
      onMessage: (callback: (message: unknown) => void) => { onMessage = callback; },
    };
    const transport = new ProductionWebviewTransport(api);
    await expect(transport.request({ type: "ready" })).resolves.toEqual({ isDark: false });
    const pushes: EditorHostPush[] = [];
    transport.subscribe(push => pushes.push(push));
    onMessage({ message: { type: "updateCompactSpacing", value: true } });
    onMessage({ message: { type: "unknown" } });
    expect(pushes).toEqual([{ type: "updateCompactSpacing", value: true }]);
  });

  it("validates response type and message-specific payload", async () => {
    const { channel, transport } = channelTransport();
    channel.port2.addEventListener("message", event => {
      const request = event.data as any;
      channel.port2.postMessage({
        protocol: EDITOR_HOST_PROTOCOL,
        version: EDITOR_HOST_PROTOCOL_VERSION,
        kind: "response",
        sessionId,
        nonce,
        requestId: request.requestId,
        requestType: "ready",
        payload: { isDark: true },
      } satisfies EditorHostEnvelope);
    });
    await expect(transport.request({ type: "ready" })).resolves.toEqual({ isDark: true });
    transport.close();
  });

  it("rejects malformed responses and closes pending requests", async () => {
    const { channel, transport } = channelTransport();
    channel.port2.addEventListener("message", event => {
      const request = event.data as any;
      channel.port2.postMessage({
        protocol: EDITOR_HOST_PROTOCOL, version: EDITOR_HOST_PROTOCOL_VERSION, kind: "response",
        sessionId, nonce, requestId: request.requestId, requestType: "saveNote", payload: { status: "wat" },
      });
    }, { once: true });
    await expect(transport.request({ type: "saveNote", noteId: "note", body: "body" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    const pending = transport.request({ type: "ready" });
    transport.close();
    await expect(pending).rejects.toMatchObject({ code: "SESSION_CLOSED" });
  });

  it("rejects duplicate, stale, missing, wrong-session, and malformed push envelopes", async () => {
    const errors: Array<{ code: string }> = [];
    const { channel, transport } = channelTransport(errors);
    const pushes: EditorHostPush[] = [];
    transport.subscribe(push => pushes.push(push));
    const push = (sequence: number, overrides: Record<string, unknown> = {}) => channel.port2.postMessage({
      protocol: EDITOR_HOST_PROTOCOL,
      version: EDITOR_HOST_PROTOCOL_VERSION,
      kind: "push",
      sessionId,
      nonce,
      sequence,
      payload: { type: "updateCompactSpacing", value: true },
      ...overrides,
    });
    push(1);
    push(1);
    push(3);
    push(2, { sessionId: "wrong" });
    push(2);
    channel.port2.postMessage({ malformed: true });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(pushes).toHaveLength(2);
    expect(errors.map(error => error.code)).toEqual(expect.arrayContaining(["STALE_SEQUENCE", "MISSING_SEQUENCE", "INVALID_ENVELOPE"]));
    transport.close();
  });
});
