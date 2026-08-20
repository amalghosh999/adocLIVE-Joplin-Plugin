# Fixture, Scenario, and Replay Authoring

Scenarios are parsed by `LabScenarioV1Schema`. Always start from an existing fixture or the schema defaults, use deterministic 32-character note/resource IDs where Joplin syntax requires them, and serialize with `serializeLabScenario` so key ordering and trailing newline are stable.

A committed scenario must use synthetic text and original tiny local assets. Resource entries select exactly one size-limited data URL or committed fixture path. Network URLs, personal notes, secrets, and copied media are prohibited. Hostile strings must be inert and tagged `security`/`hostile`.

Timeline events use logical time and semantic actions. Prefer `editor.type`, `editor.key`, `editor.toolbar`, `host.push`, `host.mutate`, and `clock.advance`; never encode DOM selectors or wall-clock sleeps as scenario semantics. Requests may be resolved, rejected, or reordered by stable request IDs. Every prior committed schema version requires a forward migration and round-trip test. Unknown future versions fail closed.

Scale fixtures are generated deterministically at runtime. Keep ordinary PR fixtures compact; reserve 5k–20k coverage for the performance job unless a regression specifically requires it.
