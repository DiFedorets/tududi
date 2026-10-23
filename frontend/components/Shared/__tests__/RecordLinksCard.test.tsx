import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RecordLinksCard from '../RecordLinksCard';
import {
    fetchRecordLinks,
    addRecordLink,
    removeRecordLink,
} from '../../../utils/recordLinksService';
import { searchUniversal } from '../../../utils/searchService';
jest.mock('../../../utils/recordLinksService', () => ({
    fetchRecordLinks: jest.fn(),
    addRecordLink: jest.fn(),
    removeRecordLink: jest.fn(),
}));
jest.mock('../../../utils/searchService', () => ({
    searchUniversal: jest.fn(),
}));
const error = jest.fn();
jest.mock('../ToastContext', () => ({
    useToast: () => ({ showErrorToast: error }),
}));
jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));
const row = {
    uid: 'link1',
    type: 'source',
    can_remove: true,
    target: { uid: 'note1', type: 'note', title: 'Discussion' },
};
const show = (type: 'task' | 'note' = 'task', uid = 'task1') => {
    const view = render(
        <MemoryRouter>
            <RecordLinksCard type={type} uid={uid} />
        </MemoryRouter>
    );
    fireEvent.click(view.container.querySelector('summary')!);
    return view;
};
beforeEach(() => {
    jest.clearAllMocks();
    (fetchRecordLinks as jest.Mock).mockResolvedValue([row]);
    (searchUniversal as jest.Mock).mockResolvedValue({
        results: [{ uid: 'note2', title: 'Other discussion' }],
    });
});
it('renders persistent note links and opens the native note page', async () => {
    show();
    const link = await screen.findByRole('link', { name: 'Discussion' });
    expect(link).toHaveAttribute('href', '/notes/note1');
    expect(screen.getByText('recordLinks.source')).toBeInTheDocument();
});
it('shows the inverse source label and native task address in a note', async () => {
    (fetchRecordLinks as jest.Mock).mockResolvedValue([
        { ...row, target: { uid: 'task1', type: 'task', title: 'Proposal' } },
    ]);
    show('note', 'note1');
    expect(
        await screen.findByRole('link', { name: 'Proposal' })
    ).toHaveAttribute('href', '/task/task1');
    expect(screen.getByText('recordLinks.result')).toBeInTheDocument();
});
it('finds only notes from a task and creates the chosen type', async () => {
    show();
    await screen.findByText('Discussion');
    fireEvent.click(screen.getByLabelText('recordLinks.add'));
    fireEvent.change(screen.getByLabelText('recordLinks.search'), {
        target: { value: 'Other' },
    });
    fireEvent.change(screen.getByRole('combobox'), {
        target: { value: 'source' },
    });
    fireEvent.click(
        await screen.findByRole('button', { name: 'Other discussion' })
    );
    await waitFor(() =>
        expect(addRecordLink).toHaveBeenCalledWith(
            'task',
            'task1',
            'note2',
            'source'
        )
    );
    expect(searchUniversal).toHaveBeenCalledWith(
        expect.objectContaining({ filters: ['Note'] })
    );
});
it('keeps search and form when a save fails', async () => {
    (addRecordLink as jest.Mock).mockRejectedValue(new Error('Forbidden'));
    show();
    await screen.findByText('Discussion');
    fireEvent.click(screen.getByLabelText('recordLinks.add'));
    fireEvent.change(screen.getByLabelText('recordLinks.search'), {
        target: { value: 'Other' },
    });
    fireEvent.click(
        await screen.findByRole('button', { name: 'Other discussion' })
    );
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.getByLabelText('recordLinks.search')).toHaveValue('Other');
});
it('does not expose removal controls without permission', async () => {
    (fetchRecordLinks as jest.Mock).mockResolvedValue([
        { ...row, can_remove: false },
    ]);
    show();
    await screen.findByText('Discussion');
    expect(
        screen.queryByLabelText('recordLinks.remove')
    ).not.toBeInTheDocument();
});
it('removes a link without deleting a record', async () => {
    show();
    await screen.findByText('Discussion');
    fireEvent.click(screen.getByLabelText('recordLinks.remove'));
    await waitFor(() =>
        expect(removeRecordLink).toHaveBeenCalledWith('task', 'task1', 'link1')
    );
});

it('keeps the overview collapsed by default', async () => {
    const { container } = render(
        <MemoryRouter>
            <RecordLinksCard type="note" uid="n" />
        </MemoryRouter>
    );
    await waitFor(() => expect(fetchRecordLinks).toHaveBeenCalled());
    expect(container.querySelector('details')).not.toHaveAttribute('open');
});
