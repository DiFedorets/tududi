import { deleteTask } from '../../../utils/tasksService';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import PersonDetails from '../PersonDetails';
import { fetchPersonByUid } from '../../../utils/peopleService';
import { createSignInLink } from '../../../utils/membersService';

jest.mock('../../Shared/ToastContext', () => ({
    useToast: () => ({
        showSuccessToast: jest.fn(),
        showErrorToast: jest.fn(),
    }),
}));

jest.mock('../../../utils/peopleService', () => ({
    fetchPersonByUid: jest.fn(),
    updatePerson: jest.fn(),
    deletePerson: jest.fn(),
}));

// Assigned tasks render the shared task rows, which pull in the Markdown
// renderer Jest cannot parse; this page's tests do not need them.
jest.mock('../../Task/TaskList', () => ({
    __esModule: true,
    default: ({ tasks, onTaskDelete, onTaskUpdate }: any) => (
        <div>
            {tasks.map((task: any) => (
                <div key={task.uid}>
                    <button
                        onClick={() => {
                            void onTaskDelete(task.uid).catch(() => undefined);
                        }}
                    >
                        {task.name}
                    </button>
                    <button
                        aria-label={`Complete ${task.uid}`}
                        onClick={() =>
                            void onTaskUpdate({ ...task, status: 2 })
                        }
                    >
                        Complete
                    </button>
                    <button
                        aria-label={`Reassign ${task.uid}`}
                        onClick={() =>
                            void onTaskUpdate({ ...task, assigned_to: 'other' })
                        }
                    >
                        Reassign
                    </button>
                </div>
            ))}
        </div>
    ),
}));

jest.mock('../../../utils/tasksService', () => ({ deleteTask: jest.fn() }));

jest.mock('../../../utils/membersService', () => ({
    createSignInLink: jest.fn(),
    revokeSignInLink: jest.fn(),
}));

const renderDetails = (person: any) => {
    (fetchPersonByUid as jest.Mock).mockResolvedValue(person);
    return render(
        <MemoryRouter initialEntries={['/person/abc']}>
            <Link to="/person/def">Switch person</Link>
            <Routes>
                <Route path="/person/:uid" element={<PersonDetails />} />
            </Routes>
        </MemoryRouter>
    );
};

describe('Person details', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (global as any).fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ tasks: [] }),
        });
    });

    it('lets you edit, archive and delete your own contact', async () => {
        renderDetails({
            uid: 'abc',
            name: 'Plumber',
            kind: 'contact',
            can_edit: true,
        });

        expect(await screen.findByTitle('Edit person')).toBeVisible();
        expect(screen.getByTitle('Archive')).toBeVisible();
        expect(screen.getByTitle('Delete person')).toBeVisible();
    });

    it('shows another member without any way to change them', async () => {
        renderDetails({
            uid: 'abc',
            name: 'Kid',
            kind: 'member',
            can_edit: false,
        });

        expect(await screen.findByText('Kid')).toBeVisible();
        expect(screen.queryByTitle('Edit person')).toBeNull();
        expect(screen.queryByTitle('Archive')).toBeNull();
        expect(screen.queryByTitle('Delete person')).toBeNull();
    });

    it('lets you edit the person of your own account but not archive or delete it', async () => {
        renderDetails({
            uid: 'abc',
            name: 'Wife',
            kind: 'member',
            can_edit: true,
            is_self: true,
        });

        expect(await screen.findByTitle('Edit person')).toBeVisible();
        expect(screen.queryByTitle('Archive')).toBeNull();
        expect(screen.queryByTitle('Delete person')).toBeNull();
    });

    it('keeps working for an entry from before people were marked', async () => {
        renderDetails({ uid: 'abc', name: 'Old contact' });

        expect(await screen.findByTitle('Edit person')).toBeVisible();
        expect(screen.getByTitle('Delete person')).toBeVisible();
    });

    it('offers a sign-in link for a member you may make one for, even though you cannot edit them', async () => {
        renderDetails({
            uid: 'abc',
            name: 'Kid',
            kind: 'member',
            can_edit: false,
            linked_user_id: 7,
            can_sign_in_link: true,
        });

        expect(await screen.findByTestId('person-sign-in-link')).toBeVisible();
        expect(screen.queryByTitle('Edit person')).toBeNull();
    });

    it('opens the sign-in link dialog for that member', async () => {
        renderDetails({
            uid: 'abc',
            name: 'Kid',
            kind: 'member',
            can_edit: false,
            linked_user_id: 7,
            can_sign_in_link: true,
        });

        fireEvent.click(await screen.findByTestId('person-sign-in-link'));
        expect(screen.getByTestId('sign-in-link-modal')).toBeVisible();
        (createSignInLink as jest.Mock).mockResolvedValue({
            url: 'http://localhost:8080/sign-in-link?token=abc',
            path: '/sign-in-link?token=abc',
            expires_at: new Date().toISOString(),
        });

        fireEvent.click(screen.getByTestId('sign-in-link-create'));

        expect(await screen.findByTestId('sign-in-link-url')).toBeVisible();
        expect(createSignInLink).toHaveBeenCalledWith(7);
    });

    it('offers no sign-in link when the server does not allow one', async () => {
        renderDetails({
            uid: 'abc',
            name: 'Kid',
            kind: 'member',
            can_edit: true,
            linked_user_id: 7,
            can_sign_in_link: false,
        });

        expect(await screen.findByTitle('Edit person')).toBeVisible();
        expect(screen.queryByTestId('person-sign-in-link')).toBeNull();
    });
    it('waits for server deletion before removing an assigned card', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({
                tasks: [
                    { uid: 'task', name: 'Assigned task', assigned_to: 'abc' },
                ],
            }),
        });
        let acknowledge!: () => void;
        (deleteTask as jest.Mock).mockReturnValue(
            new Promise<void>((resolve) => {
                acknowledge = resolve;
            })
        );
        renderDetails({ uid: 'abc', name: 'Person', kind: 'contact' });
        fireEvent.click(await screen.findByText('Assigned task'));
        expect(deleteTask).toHaveBeenCalledWith('task');
        expect(screen.getByText('Assigned task')).toBeInTheDocument();
        acknowledge();
        await waitFor(() =>
            expect(screen.queryByText('Assigned task')).not.toBeInTheDocument()
        );
    });
    it('retains an assigned card when server deletion is refused', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({
                tasks: [
                    { uid: 'task', name: 'Assigned task', assigned_to: 'abc' },
                ],
            }),
        });
        (deleteTask as jest.Mock).mockRejectedValue(new Error('Forbidden'));
        renderDetails({ uid: 'abc', name: 'Person', kind: 'contact' });
        fireEvent.click(await screen.findByText('Assigned task'));
        await waitFor(() => expect(deleteTask).toHaveBeenCalledWith('task'));
        expect(screen.getByText('Assigned task')).toBeInTheDocument();
    });
    it('keeps completed assignments in progress and provides completed/all filters', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({
                tasks: [
                    {
                        uid: 'open',
                        name: 'Open assignment',
                        assigned_to: 'abc',
                        status: 0,
                    },
                    {
                        uid: 'done',
                        name: 'Finished assignment',
                        assigned_to: 'abc',
                        status: 2,
                    },
                ],
            }),
        });
        renderDetails({ uid: 'abc', name: 'Person', kind: 'contact' });
        expect(await screen.findByText('Open assignment')).toBeVisible();
        expect(screen.queryByText('Finished assignment')).toBeNull();
        expect(screen.getByText('Assigned tasks · 1 of 2 done')).toBeVisible();
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('status=all'),
            expect.anything()
        );
        fireEvent.change(screen.getByLabelText('Статус назначенных задач'), {
            target: { value: 'completed' },
        });
        expect(screen.getByText('Finished assignment')).toBeVisible();
        expect(screen.queryByText('Open assignment')).toBeNull();
        fireEvent.change(screen.getByLabelText('Статус назначенных задач'), {
            target: { value: 'all' },
        });
        expect(screen.getByText('Open assignment')).toBeVisible();
        expect(screen.getByText('Finished assignment')).toBeVisible();
    });

    it('updates progress on completion and removes reassigned cards', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({
                tasks: [
                    {
                        uid: 'task',
                        name: 'Open assignment',
                        assigned_to: 'abc',
                        status: 0,
                    },
                ],
            }),
        });
        renderDetails({ uid: 'abc', name: 'Person', kind: 'contact' });
        fireEvent.click(await screen.findByLabelText('Complete task'));
        expect(screen.queryByText('Open assignment')).toBeNull();
        expect(screen.getByText('Assigned tasks · 1 of 1 done')).toBeVisible();
        fireEvent.change(screen.getByLabelText('Статус назначенных задач'), {
            target: { value: 'completed' },
        });
        expect(screen.getByText('Open assignment')).toBeVisible();
        fireEvent.click(screen.getByLabelText('Reassign task'));
        expect(screen.queryByText('Open assignment')).toBeNull();
    });

    it('shows a task-load failure instead of reporting an empty assignment list', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
        renderDetails({ uid: 'abc', name: 'Person', kind: 'contact' });
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Не удалось загрузить назначенные задачи'
        );
        expect(
            screen.queryByText('Нет активных назначенных задач.')
        ).toBeNull();
    });

    it('ignores a late response from the previous person', async () => {
        let resolveOld!: (value: any) => void;
        const oldTasks = new Promise((resolve) => {
            resolveOld = resolve;
        });
        (global.fetch as jest.Mock).mockImplementation((url: string) =>
            url.includes('assigned_to=abc')
                ? oldTasks
                : Promise.resolve({
                      ok: true,
                      json: async () => ({ tasks: [] }),
                  })
        );
        (fetchPersonByUid as jest.Mock)
            .mockResolvedValueOnce({ uid: 'abc', name: 'Previous person' })
            .mockResolvedValueOnce({ uid: 'def', name: 'Current person' });
        renderDetails({ uid: 'abc', name: 'Previous person' });
        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        fireEvent.click(screen.getByText('Switch person'));
        expect(
            await screen.findByRole('heading', { name: 'Current person' })
        ).toBeVisible();
        resolveOld({
            ok: true,
            json: async () => ({
                tasks: [
                    {
                        uid: 'old',
                        name: 'Old assignment',
                        assigned_to: 'abc',
                        status: 0,
                    },
                ],
            }),
        });
        await waitFor(() =>
            expect(
                screen.getByRole('heading', { name: 'Current person' })
            ).toBeVisible()
        );
        expect(screen.queryByText('Old assignment')).toBeNull();
    });
});
