export function normalizeNoteIdsFromCommandArgs(args: unknown[]): string[] {
  const firstArg = args[0];
  const rawIds = Array.isArray(firstArg)
    ? firstArg
    : Array.isArray((firstArg as { noteIds?: unknown[] } | null)?.noteIds)
      ? (firstArg as { noteIds: unknown[] }).noteIds
      : typeof firstArg === "string"
        ? [firstArg]
        : [];

  const seen = new Set<string>();
  const noteIds: string[] = [];
  for (const rawId of rawIds) {
    const noteId = String(rawId || "").trim();
    if (!noteId || seen.has(noteId)) continue;
    seen.add(noteId);
    noteIds.push(noteId);
  }
  return noteIds;
}
