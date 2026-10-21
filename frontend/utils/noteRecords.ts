import { Note } from '../entities/Note';
export const noteKindLabels = {
    knowledge: 'Знание',
    lesson: 'Урок',
    decision: 'Решение',
};
export function editNoteRecord(note: Note, updates: Partial<Note>): Note {
    const next = { ...note, ...updates };
    const changed = (
        ['title', 'content', 'record_kind', 'application_ref'] as const
    ).some((k) => k in updates && (note[k] ?? '') !== (next[k] ?? ''));
    if (changed && (next.record_kind || 'knowledge') !== 'knowledge') {
        next.record_state = 'draft';
        next.ready_at = null;
    }
    return next;
}
export function savedNoteRecord(current: Note, saved: Note): Partial<Note> {
    const same = (
        ['title', 'content', 'record_kind', 'application_ref'] as const
    ).every(
        (k) =>
            (current[k] ?? (k === 'record_kind' ? 'knowledge' : '')) ===
            (saved[k] ?? (k === 'record_kind' ? 'knowledge' : ''))
    );
    return same
        ? {
              record_kind: saved.record_kind,
              record_state: saved.record_state,
              application_ref: saved.application_ref,
              ready_at: saved.ready_at,
          }
        : {};
}
