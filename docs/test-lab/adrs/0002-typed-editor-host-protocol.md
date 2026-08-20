# ADR 0002: Use a typed editor-host protocol and adapter boundary

Status: accepted

All 28 requests, message-specific responses, six pushes, and transport envelopes are Zod contracts. `EditorTransport` provides typed request and subscription operations. `EditorRpcService` validates and routes with explicit session context; concrete Joplin and in-memory operations live behind ports. Malformed, unknown, duplicate, stale, and out-of-order traffic fails with structured errors. The external Joplin plugin API and manifest do not change.
