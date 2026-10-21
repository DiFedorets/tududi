import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import GroupedTaskList from '../GroupedTaskList';
import { Task } from '../../../entities/Task';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key: string, fallback?: string) => fallback ?? _key,
    }),
}));

jest.mock('../TaskItem', () => ({
    __esModule: true,
    default: ({ task }: { task: Task }) => <div>{task.name}</div>,
}));

const makeTask = (overrides: Partial<Task>): Task =>
    ({
        id: 1,
        uid: 'uid-1',
        name: 'Task',
        status: 'not_started',
        priority: 'low',
        ...overrides,
    }) as Task;

describe('GroupedTaskList', () => {
    it('explains an empty filtered view instead of asking to create duplicate tasks', () => {
        render(
            <GroupedTaskList
                tasks={[]}
                projects={[]}
                onTaskUpdate={jest.fn()}
                onTaskDelete={jest.fn()}
                emptyTitle="No assignments"
                emptyHint={<a href="/tasks">View existing tasks</a>}
            />
        );
        expect(screen.getByText('No assignments')).toBeInTheDocument();
        expect(
            screen.getByRole('link', { name: 'View existing tasks' })
        ).toHaveAttribute('href', '/tasks');
        expect(
            screen.queryByText('tasks.blankSlateHint')
        ).not.toBeInTheDocument();
    });

    it('excludes cancelled tasks from the standalone list when showCompletedTasks is false', () => {
        const tasks = [
            makeTask({ id: 1, name: 'Active task', status: 'not_started' }),
            makeTask({ id: 2, name: 'Cancelled task', status: 'cancelled' }),
        ];

        render(
            <GroupedTaskList
                tasks={tasks}
                onTaskUpdate={jest.fn()}
                onTaskDelete={jest.fn()}
                projects={[]}
                showCompletedTasks={false}
            />
        );

        expect(screen.getByText('Active task')).toBeInTheDocument();
        expect(screen.queryByText('Cancelled task')).not.toBeInTheDocument();
    });

    it('excludes cancelled tasks when grouped by project', () => {
        const tasks = [
            makeTask({
                id: 1,
                name: 'Active task',
                status: 'not_started',
                project_id: 5,
            }),
            makeTask({
                id: 2,
                name: 'Cancelled task',
                status: 'cancelled',
                project_id: 5,
            }),
        ];

        render(
            <GroupedTaskList
                tasks={tasks}
                groupBy="project"
                onTaskUpdate={jest.fn()}
                onTaskDelete={jest.fn()}
                projects={[]}
                showCompletedTasks={false}
            />
        );

        expect(screen.getByText('Active task')).toBeInTheDocument();
        expect(screen.queryByText('Cancelled task')).not.toBeInTheDocument();
    });
});
