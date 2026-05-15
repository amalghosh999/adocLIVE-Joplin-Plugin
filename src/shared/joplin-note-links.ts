export interface JoplinNoteLinkCandidate {
  id: string;
  title?: string;
  body?: string;
  updated_time?: number;
}

export interface JoplinNoteLinkResult {
  id: string;
  title: string;
  isAsciiDoc: boolean;
}

export interface JoplinNoteLinkFilterOptions {
  currentNoteId?: string;
  query?: string;
  limit?: number;
}

export function isAsciiDocNoteBody(body: unknown): boolean {
  return typeof body === "string" && body.includes("```asciidoc-settings");
}

function normalizeSearchText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function noteTitle(note: JoplinNoteLinkCandidate): string {
  return String(note.title || note.id || "Untitled").replace(/[\r\n]+/g, " ").trim() || note.id;
}

function matchRank(note: JoplinNoteLinkCandidate, query: string): number {
  if (!query) return 0;
  const title = normalizeSearchText(note.title);
  const id = normalizeSearchText(note.id);
  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  if (title.includes(query)) return 2;
  if (id.includes(query)) return 3;
  return Number.POSITIVE_INFINITY;
}

export function filterJoplinNoteLinkCandidates(
  candidates: JoplinNoteLinkCandidate[],
  options: JoplinNoteLinkFilterOptions = {},
): JoplinNoteLinkResult[] {
  const currentNoteId = normalizeSearchText(options.currentNoteId);
  const query = normalizeSearchText(options.query);
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit || 20)));

  return candidates
    .filter(note => normalizeSearchText(note.id) !== currentNoteId)
    .filter(note => isAsciiDocNoteBody(note.body))
    .map(note => ({ note, rank: matchRank(note, query) }))
    .filter(entry => Number.isFinite(entry.rank))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const aUpdated = Number.isFinite(a.note.updated_time) ? a.note.updated_time || 0 : 0;
      const bUpdated = Number.isFinite(b.note.updated_time) ? b.note.updated_time || 0 : 0;
      if (aUpdated !== bUpdated) return bUpdated - aUpdated;
      return noteTitle(a.note).localeCompare(noteTitle(b.note));
    })
    .slice(0, limit)
    .map(({ note }) => ({
      id: note.id,
      title: noteTitle(note),
      isAsciiDoc: true,
    }));
}
