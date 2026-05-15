let currentNoteId = "";

export function setCurrentNoteId(noteId: string): void {
  currentNoteId = noteId || "";
}

export function getCurrentNoteId(): string {
  return currentNoteId;
}
