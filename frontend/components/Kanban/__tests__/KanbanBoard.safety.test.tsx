import React from 'react';
import {
    render,
    screen,
    fireEvent,
    waitFor,
    within,
} from '@testing-library/react';
import KanbanBoard from '../KanbanBoard';
import { updateTask } from '../../../utils/tasksService';
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback || key,
    }),
}));
jest.mock('../../../store/useStore', () => ({
    useStore: (selector: any) => selector({ projectsStore: { projects: [] } }),
}));
jest.mock('../../Task/TaskItem', () => ({
    __esModule: true,
    default: ({ task }: any) => <span>{task.name}</span>,
}));
jest.mock('../../../utils/tasksService', () => ({
    updateTask: jest.fn(),
    deleteTask: jest.fn(),
}));
const task = {
    id: 1,
    uid: 'audit',
    name: 'Card with unanswered question',
    status: 0,
    note: 'Do not replace me',
    tags: [],
};
beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ tasks: [task] }) });
});
async function move() {
    await screen.findByText(task.name);
    fireEvent.dragStart(screen.getByTestId('kanban-card-audit'), {
        dataTransfer: { setData: jest.fn() },
    });
    fireEvent.drop(screen.getByTestId('kanban-column-done'), {
        dataTransfer: { getData: () => '1' },
    });
}
it('keeps a blocked task in its original column and displays the refusal', async () => {
    (updateTask as jest.Mock).mockRejectedValue(
        new Error('Сначала ответьте на комментарий человека.')
    );
    render(<KanbanBoard />);
    await move();
    expect(await screen.findByRole('alert')).toHaveTextContent(
        'Сначала ответьте'
    );
    expect(
        within(screen.getByTestId('kanban-column-not_started')).getByText(
            task.name
        )
    ).toBeInTheDocument();
    expect(
        within(screen.getByTestId('kanban-column-done')).queryByText(task.name)
    ).not.toBeInTheDocument();
    expect(updateTask).toHaveBeenCalledWith('audit', { status: 2 }, task);
});
it('moves the card only after a successful minimal write', async () => {
    (updateTask as jest.Mock).mockResolvedValue({ ...task, status: 2 });
    render(<KanbanBoard />);
    await move();
    await waitFor(() =>
        expect(
            within(screen.getByTestId('kanban-column-done')).getByText(
                task.name
            )
        ).toBeInTheDocument()
    );
    expect(updateTask).toHaveBeenCalledTimes(1);
});
