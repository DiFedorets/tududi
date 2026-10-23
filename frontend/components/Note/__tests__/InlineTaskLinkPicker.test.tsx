import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InlineTaskLinkPicker from '../InlineTaskLinkPicker';
import { searchUniversal } from '../../../utils/searchService';
jest.mock('../../../utils/searchService', () => ({
    searchUniversal: jest.fn(),
}));
beforeEach(() => {
    jest.clearAllMocks();
    (searchUniversal as jest.Mock).mockResolvedValue({
        results: [{ uid: 'task1', name: 'Prepare proposal' }],
    });
});
it('searches tasks and passes the deliberate relation type', async () => {
    const pick = jest.fn().mockResolvedValue(undefined);
    render(<InlineTaskLinkPicker onPick={pick} onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Найти задачу'), {
        target: { value: 'Prepare' },
    });
    fireEvent.change(screen.getByLabelText('Тип связи'), {
        target: { value: 'source' },
    });
    fireEvent.click(
        await screen.findByRole('button', { name: 'Prepare proposal' })
    );
    await waitFor(() => expect(pick).toHaveBeenCalledWith('task1', 'source'));
    expect(searchUniversal).toHaveBeenCalledWith(
        expect.objectContaining({ filters: ['Task'] })
    );
});
it('preserves the query after failure and permits retry', async () => {
    const pick = jest.fn().mockRejectedValue(new Error('Denied'));
    render(<InlineTaskLinkPicker onPick={pick} onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Найти задачу'), {
        target: { value: 'Prepare' },
    });
    fireEvent.click(
        await screen.findByRole('button', { name: 'Prepare proposal' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Denied');
    expect(screen.getByLabelText('Найти задачу')).toHaveValue('Prepare');
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeEnabled();
});
it('cancel and Escape do not create links', () => {
    const pick = jest.fn(),
        close = jest.fn();
    render(<InlineTaskLinkPicker onPick={pick} onClose={close} />);
    fireEvent.keyDown(screen.getByLabelText('Найти задачу'), { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    expect(pick).not.toHaveBeenCalled();
});
it('does not submit the same pending choice twice', async () => {
    const pick = jest.fn(() => new Promise<void>(() => {}));
    render(<InlineTaskLinkPicker onPick={pick} onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Найти задачу'), {
        target: { value: 'Prepare' },
    });
    const button = await screen.findByRole('button', {
        name: 'Prepare proposal',
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(pick).toHaveBeenCalledTimes(1);
});
