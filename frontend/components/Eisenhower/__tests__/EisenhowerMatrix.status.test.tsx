import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import EisenhowerMatrix from '../EisenhowerMatrix';
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
it('keeps waiting and planned work but excludes cancelled and completed cards from the active matrix', async () => {
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
            tasks: [
                { uid: 'a', name: 'Planned work', status: 6 },
                { uid: 'b', name: 'Waiting work', status: 'waiting' },
                { uid: 'c', name: 'Cancelled work', status: 5 },
                { uid: 'd', name: 'Done work', status: 2 },
            ],
        }),
    });
    render(<EisenhowerMatrix />);
    expect(await screen.findByText('Planned work')).toBeInTheDocument();
    expect(screen.getByText('Waiting work')).toBeInTheDocument();
    expect(screen.queryByText('Cancelled work')).not.toBeInTheDocument();
    expect(screen.queryByText('Done work')).not.toBeInTheDocument();
});
