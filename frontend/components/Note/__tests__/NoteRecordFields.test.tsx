import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import NoteRecordFields from '../NoteRecordFields';
import { editNoteRecord, savedNoteRecord } from '../../../utils/noteRecords';
const note = {
    uid: 'one',
    title: 'Rule',
    content: 'Saved rule',
    record_kind: 'decision' as const,
    record_state: 'draft' as const,
    application_ref: 'AGENTS.md#rule',
};
it('requires an address, saved text and deliberate confirmation', () => {
    const change = jest.fn();
    const { rerender } = render(
        <NoteRecordFields note={note} onChange={change} saved={false} />
    );
    const button = screen.getByRole('button', {
        name: 'Подтвердить применение',
    });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button).toBeDisabled();
    rerender(<NoteRecordFields note={note} onChange={change} saved />);
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(change).toHaveBeenCalledWith({ record_state: 'ready' });
    rerender(
        <NoteRecordFields
            note={{ ...note, application_ref: '' }}
            onChange={change}
            saved
        />
    );
    expect(button).toBeDisabled();
});
it('invalidates readiness when meaning changes and does not overwrite later typing with a save response', () => {
    const ready = {
        ...note,
        record_state: 'ready' as const,
        ready_at: '2026-10-21',
    };
    expect(editNoteRecord(ready, { content: 'New rule' })).toMatchObject({
        record_state: 'draft',
        ready_at: null,
    });
    expect(editNoteRecord(ready, { color: '#ffffff' }).record_state).toBe(
        'ready'
    );
    expect(savedNoteRecord({ ...ready, content: 'New rule' }, ready)).toEqual(
        {}
    );
});
it('lets the same native note switch kinds', () => {
    const change = jest.fn();
    render(<NoteRecordFields note={note} onChange={change} />);
    fireEvent.change(screen.getByLabelText('Вид заметки'), {
        target: { value: 'lesson' },
    });
    expect(change).toHaveBeenCalledWith({
        record_kind: 'lesson',
        record_state: 'draft',
    });
});
