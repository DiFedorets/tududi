import { getTitleAndIcon } from '../getTitleAndIcon';

describe('task view titles', () => {
    const t = (key: string) => key;
    it('identifies the assigned-to-me list without changing general task titles', () => {
        expect(
            getTitleAndIcon(
                new URLSearchParams('assigned_to=me&status=active'),
                [],
                t,
                '/tasks'
            ).title
        ).toBe('sidebar.assignedToMe');
        expect(
            getTitleAndIcon(
                new URLSearchParams('status=active'),
                [],
                t,
                '/tasks'
            ).title
        ).toBe('sidebar.allTasks');
    });
    it('keeps the project title when viewing assignments inside a project', () => {
        expect(
            getTitleAndIcon(
                new URLSearchParams('project_id=3&assigned_to=me'),
                [{ id: 3, name: 'Project' }] as any,
                t,
                '/tasks'
            ).title
        ).toBe('Project');
    });
});
