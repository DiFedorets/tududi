import React from 'react';
import {
    render,
    screen,
    act,
    fireEvent,
    waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EditorView } from '@codemirror/view';
import MarkdownEditor from '../MarkdownEditor';
import {
    createNoteFragment,
    fetchNoteFragment,
} from '../../../utils/noteFragmentsService';
jest.mock('../../../utils/notesService', () => ({ createNote: jest.fn() }));
jest.mock('../../../utils/noteFragmentsService', () => ({
    createNoteFragment: jest.fn(),
    fetchNoteFragment: jest.fn(),
}));
jest.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: jest.fn() },
    useTranslation: () => ({ t: (_k: string, fallback: string) => fallback }),
}));
const success = jest.fn(),
    error = jest.fn();
jest.mock('../../Shared/ToastContext', () => ({
    useToast: () => ({ showSuccessToast: success, showErrorToast: error }),
}));
jest.mock('../../../store/useStore', () => ({
    useStore: (select: any) =>
        select({
            notesStore: {
                notes: [],
                hasLoaded: true,
                loadNotes: jest.fn(),
                addNote: jest.fn(),
            },
        }),
}));
jest.mock('../FormattingToolbar', () => ({
    __esModule: true,
    default: ({ onFragmentLink }: any) => (
        <button onClick={onFragmentLink}>Copy fragment</button>
    ),
}));
const write = jest.fn().mockResolvedValue(undefined);
beforeEach(() => {
    jest.clearAllMocks();
    Range.prototype.getClientRects = jest.fn(() => [] as any);
    Range.prototype.getBoundingClientRect = jest.fn(() => ({
        left: 0,
        right: 10,
        top: 0,
        bottom: 10,
        width: 10,
        height: 10,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    }));
    Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: write },
        configurable: true,
    });
    Element.prototype.scrollIntoView = jest.fn();
});
function show(path = '/notes/n') {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <MarkdownEditor
                noteUid="n"
                noteRevision={2}
                value="Before TARGET after"
                onChange={jest.fn()}
            />
        </MemoryRouter>
    );
}
it('copies a saved fragment URL without changing the note body', async () => {
    (createNoteFragment as jest.Mock).mockResolvedValue({
        uid: 'f',
        href: '/notes/n?fragment=f',
    });
    const { container } = show();
    const view = EditorView.findFromDOM(
        container.querySelector('.cm-content') as HTMLElement
    )!;
    act(() => view.dispatch({ selection: { anchor: 7, head: 13 } }));
    fireEvent.click(screen.getByText('Copy fragment'));
    await waitFor(() =>
        expect(write).toHaveBeenCalledWith(
            'http://localhost/notes/n?fragment=f'
        )
    );
    expect(createNoteFragment).toHaveBeenCalledWith(
        'n',
        7,
        13,
        'Before TARGET after'
    );
    expect(view.state.doc.toString()).toBe('Before TARGET after');
});
it('highlights only a verified current range', async () => {
    (fetchNoteFragment as jest.Mock).mockResolvedValue({
        uid: 'f',
        state: 'located',
        quote: 'TARGET',
        from: 7,
        to: 13,
        note_revision: 2,
    });
    const { container } = show('/notes/n?fragment=f');
    await waitFor(() =>
        expect(
            container.querySelector('.note-fragment-highlight')
        ).toHaveTextContent('TARGET')
    );
});
it('shows the preserved quote and never highlights a changed fragment', async () => {
    (fetchNoteFragment as jest.Mock).mockResolvedValue({
        uid: 'f',
        state: 'changed',
        quote: 'Original quote',
        from: null,
        to: null,
        note_revision: 2,
    });
    const { container } = show('/notes/n?fragment=f');
    expect(await screen.findByText('Original quote')).toBeInTheDocument();
    expect(container.querySelector('.note-fragment-highlight')).toBeNull();
});
it('does not show a guessed location when access or the fragment is missing', async () => {
    (fetchNoteFragment as jest.Mock).mockRejectedValue(
        new Error('Фрагмент не найден')
    );
    const { container } = show('/notes/n?fragment=missing');
    expect(await screen.findByText('Фрагмент не найден')).toBeInTheDocument();
    expect(container.querySelector('.note-fragment-highlight')).toBeNull();
});
it('retains the text when an unsaved or conflicting selection is rejected', async () => {
    (createNoteFragment as jest.Mock).mockRejectedValue(
        new Error('Дождитесь сохранения')
    );
    const { container } = show();
    const view = EditorView.findFromDOM(
        container.querySelector('.cm-content') as HTMLElement
    )!;
    act(() => view.dispatch({ selection: { anchor: 7, head: 13 } }));
    fireEvent.click(screen.getByText('Copy fragment'));
    await waitFor(() =>
        expect(error).toHaveBeenCalledWith('Дождитесь сохранения')
    );
    expect(view.state.doc.toString()).toBe('Before TARGET after');
    expect(write).not.toHaveBeenCalled();
});
