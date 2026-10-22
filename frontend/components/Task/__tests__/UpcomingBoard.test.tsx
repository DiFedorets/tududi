import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UpcomingBoard from '../UpcomingBoard';
import { Task } from '../../../entities/Task';
import { updateTask } from '../../../utils/tasksService';
const mockError = jest.fn(),
    mockUndo = jest.fn();
jest.mock('../../Shared/ToastContext', () => ({
    useToast: () => ({
        showErrorToast: mockError,
        showSuccessToast: jest.fn(),
        showUndoToast: mockUndo,
    }),
}));
jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
jest.mock('../../../utils/tasksService', () => ({ updateTask: jest.fn() }));
jest.mock('../TaskItem', () => ({
    __esModule: true,
    default: ({ task }: any) => <span>{task.name}</span>,
}));
const first = {
    id: 1,
    uid: 'first',
    name: 'First task',
    due_date: '2032-01-05',
    due_time: '10:30',
    status: 'not_started',
} as Task;
const second = {
    id: 2,
    uid: 'second',
    name: 'Second task',
    due_date: '2032-01-06',
    status: 'not_started',
} as Task;
const move = () =>
    fireEvent.keyDown(screen.getByRole('button', { name: /First task/ }), {
        altKey: true,
        key: 'ArrowRight',
    });
beforeEach(() => jest.clearAllMocks());
it('moves the card itself, preserves its time and uses the saved server response', async () => {
    const onTaskUpdate = jest.fn().mockResolvedValue(undefined);
    const saved = { ...first, due_date: '2032-01-06' };
    (updateTask as jest.Mock).mockResolvedValue(saved);
    render(
        <UpcomingBoard
            groups={{ Tuesday: [first], Wednesday: [second] }}
            projects={[]}
            onTaskUpdate={onTaskUpdate}
            onTaskDelete={jest.fn()}
        />
    );
    move();
    await waitFor(() => expect(onTaskUpdate).toHaveBeenCalledWith(saved));
    expect(updateTask).toHaveBeenCalledWith(
        'first',
        { due_date: '2032-01-06', due_time: '10:30' },
        first
    );
    expect(mockUndo).toHaveBeenCalled();
});
it('does not update the displayed task when the server rejects a stale move', async () => {
    const onTaskUpdate = jest.fn();
    (updateTask as jest.Mock).mockRejectedValue(new Error('Date changed'));
    render(
        <UpcomingBoard
            groups={{ Tuesday: [first], Wednesday: [second] }}
            projects={[]}
            onTaskUpdate={onTaskUpdate}
            onTaskDelete={jest.fn()}
        />
    );
    move();
    await waitFor(() => expect(mockError).toHaveBeenCalledWith('Date changed'));
    expect(onTaskUpdate).not.toHaveBeenCalled();
});
it('requires an explicit date for a week-only column rather than inventing one', () => {
    render(
        <UpcomingBoard
            groups={{
                Tuesday: [first],
                Week: [{ ...second, due_date: undefined }],
            }}
            projects={[]}
            onTaskUpdate={jest.fn()}
            onTaskDelete={jest.fn()}
        />
    );
    move();
    expect(screen.getByLabelText(/Choose a specific day/)).toHaveAttribute(
        'type',
        'date'
    );
    expect(updateTask).not.toHaveBeenCalled();
});
it('does not reschedule a recurring series through an occurrence', () => {
    render(
        <UpcomingBoard
            groups={{
                Tuesday: [{ ...first, is_virtual_occurrence: true }],
                Wednesday: [second],
            }}
            projects={[]}
            onTaskUpdate={jest.fn()}
            onTaskDelete={jest.fn()}
        />
    );
    move();
    expect(updateTask).not.toHaveBeenCalled();
    expect(
        screen.getByRole('button', { name: /First task/ })
    ).toHaveAccessibleName(/Recurring tasks/);
});
