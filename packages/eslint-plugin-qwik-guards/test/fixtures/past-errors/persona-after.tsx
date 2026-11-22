// Minimal proposed workaround, not a claim that application code was fixed.
export const after = (personas, streamingNotes, replyDraft) => {
  const cards = personas
    .filter((persona) => streamingNotes[persona.id])
    .map((persona) => <article key={persona.id} />);
  return (
    <div>
      {cards.length ? cards : null}
      <dialog key="note-sheet">
        <textarea value={replyDraft} />
      </dialog>
    </div>
  );
};
