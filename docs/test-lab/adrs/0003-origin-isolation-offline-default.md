# ADR 0003: Isolate editor origins and default to offline

Status: accepted

The dashboard and editor use separate loopback origins. A checked window handshake transfers one `MessagePort`; subsequent RPC never uses ambient cross-origin state. Note-rendered DOM cannot access the controller store. Automated runs deny non-loopback requests and use committed assets. Remote content is a visibly warned, explicit manual opt-in and is excluded from baseline approval.
