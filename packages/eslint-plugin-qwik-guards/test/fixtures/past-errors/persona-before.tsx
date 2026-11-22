// Reduced from the locally reproduced 2026-11-05 expanded persona-note issue.
export const before = (personas, streamingNotes, replyDraft) => (
  <div>
    {personas
      .filter((persona) => streamingNotes[persona.id])
      .map((persona) => (
        <article key={persona.id} />
      ))}
    <dialog key="note-sheet">
      <textarea value={replyDraft} />
    </dialog>
  </div>
);
