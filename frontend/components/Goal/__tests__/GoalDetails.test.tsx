import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GoalDetails from '../GoalDetails';
const translate = (key: string, fallback?: any) =>
    typeof fallback === 'string' ? fallback : key;
jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));
jest.mock('../../../i18n', () => ({ __esModule: true, default: {} }));
jest.mock('../../../utils/goalsService', () => ({
    fetchGoalByUid: () =>
        Promise.resolve({
            uid: 'goal1',
            title: 'Test goal',
            status: 'active',
            Projects: [],
            Tasks: [
                { uid: 'a', name: 'Active task', status: 0 },
                { uid: 'b', name: 'Archived task', status: 3 },
                { uid: 'c', name: 'Cancelled task', status: 5 },
            ],
        }),
}));
jest.mock('../../../utils/projectsService', () => ({
    fetchProjects: () => Promise.resolve([]),
}));
jest.mock('../../../store/useStore', () => ({
    useStore: (selector: any) =>
        selector({
            projectsStore: { projects: [] },
            goalsStore: { loadGoals: jest.fn() },
        }),
}));
jest.mock('../../Shared/ToastContext', () => ({
    useToast: () => ({
        showSuccessToast: jest.fn(),
        showErrorToast: jest.fn(),
    }),
}));
jest.mock('../../Project/useProjectCardActions', () => ({
    __esModule: true,
    default: () => ({ cardActions: {}, modals: null }),
}));
jest.mock('../GoalModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../../Project/ProjectItem', () => ({
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
                        showCompletedTasks || ![2, 3, 5].includes(task.status)
                )
                .map((task: any) => (
                    <span key={task.uid}>{task.name}</span>
                ))}
        </div>
    ),
}));
it('keeps archived and cancelled goal cards reachable without counting cancellation as completion', async () => {
    render(
        <MemoryRouter initialEntries={['/goal/goal1-test']}>
            <Routes>
                <Route path="/goal/:uidSlug" element={<GoalDetails />} />
            </Routes>
        </MemoryRouter>
    );
    expect(await screen.findByText('Active task')).toBeInTheDocument();
    expect(screen.getByText('Archived task')).toBeInTheDocument();
    expect(screen.getByText('Cancelled task')).toBeInTheDocument();
    expect(screen.getByText('Отменённые (1)')).toBeInTheDocument();
    expect(screen.getByText('Completed (1)')).toBeInTheDocument();
});
