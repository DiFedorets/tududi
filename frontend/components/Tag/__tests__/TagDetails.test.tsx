import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import TagDetails from '../TagDetails';
const translate = (key: string, fallback?: any) =>
    typeof fallback === 'string' ? fallback : key;
jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));
jest.mock('../../../i18n', () => ({ __esModule: true, default: {} }));
jest.mock('../../../utils/tagsService', () => ({
    fetchTagBySlug: () => Promise.resolve({ id: 1, uid: 'tag1', name: 'ACP' }),
}));
jest.mock('../../../store/useStore', () => ({
    useStore: (selector: any) =>
        selector({
            projectsStore: { projects: [], setProjects: jest.fn() },
            tagsStore: { tags: [], setTags: jest.fn() },
        }),
}));
jest.mock('../../Shared/ToastContext', () => ({
    useToast: () => ({
        showSuccessToast: jest.fn(),
        showErrorToast: jest.fn(),
    }),
}));
jest.mock('../TagModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../../Project/ProjectShareModal', () => ({
    __esModule: true,
    default: () => null,
}));
jest.mock('../../Task/TaskList', () => ({
    __esModule: true,
    default: ({ tasks, showCompletedTasks }: any) => (
        <div>
            {tasks
                .filter(
                    (task: any) =>
                        showCompletedTasks ||
                        ![2, 3, 5, 'done', 'archived', 'cancelled'].includes(
                            task.status
                        )
                )
                .map((task: any) => (
                    <span key={task.uid}>{task.name}</span>
                ))}
        </div>
    ),
}));
describe('TagDetails status consistency', () => {
    it('shows a failed request instead of claiming the tag has no records', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            json: async () => ({}),
        });
        render(
            <MemoryRouter initialEntries={['/tag/tag1-acp']}>
                <Routes>
                    <Route path="/tag/:uidSlug" element={<TagDetails />} />
                </Routes>
            </MemoryRouter>
        );
        expect(await screen.findByText('tags.error')).toBeInTheDocument();
        expect(
            screen.queryByText('No items with this tag')
        ).not.toBeInTheDocument();
    });

    beforeEach(() => {
        global.fetch = jest.fn((url: any) =>
            Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve(
                        String(url).includes('tasks?')
                            ? {
                                  tasks: [
                                      {
                                          uid: 'cancel1',
                                          name: 'Cancelled task',
                                          status: 5,
                                      },
                                      {
                                          uid: 'done1',
                                          name: 'Done task',
                                          status: 2,
                                      },
                                  ],
                              }
                            : []
                    ),
            })
        ) as any;
    });
    it('counts only rendered active cards and exposes cancelled cards through All', async () => {
        render(
            <MemoryRouter initialEntries={['/tag/tag1-acp']}>
                <Routes>
                    <Route path="/tag/:uidSlug" element={<TagDetails />} />
                </Routes>
            </MemoryRouter>
        );
        expect(
            await screen.findByRole('button', { name: 'Tasks (0)' })
        ).toBeInTheDocument();
        expect(screen.queryByText('Cancelled task')).not.toBeInTheDocument();
        expect(
            screen.queryByText('No items with this tag')
        ).not.toBeInTheDocument();
        await userEvent.selectOptions(
            screen.getByLabelText('Статус задач тега'),
            'all'
        );
        expect(
            screen.getByRole('button', { name: 'Tasks (2)' })
        ).toBeInTheDocument();
        expect(screen.getByText('Cancelled task')).toBeInTheDocument();
        await userEvent.selectOptions(
            screen.getByLabelText('Статус задач тега'),
            'completed'
        );
        expect(screen.getByText('Done task')).toBeInTheDocument();
        expect(screen.queryByText('Cancelled task')).not.toBeInTheDocument();
    });
});

jest.mock('../../Task/GroupedTaskList', () => ({
    __esModule: true,
    default: () => null,
}));
jest.mock('../../Project/ProjectItem', () => ({
    __esModule: true,
    default: () => null,
}));
