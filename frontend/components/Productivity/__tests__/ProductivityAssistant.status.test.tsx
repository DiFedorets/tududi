import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import ProductivityAssistant from '../ProductivityAssistant';
const translate = (key: string, fallback: string) => fallback;
jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));
jest.mock('../../../utils/taskIntelligenceService', () => ({
    getVagueTasks: () => [],
}));
it('recommends only stale active work, excluding cancelled, numeric completed and recently edited cards', async () => {
    const tasks = [
        {
            id: 1,
            uid: 'stale',
            name: 'Call stale supplier',
            status: 0,
            created_at: '2020-01-01',
        },
        {
            id: 2,
            uid: 'cancel',
            name: 'Call cancelled supplier',
            status: 5,
            created_at: '2020-01-01',
        },
        {
            id: 3,
            uid: 'done',
            name: 'Call completed supplier',
            status: 2,
            created_at: '2020-01-01',
        },
        {
            id: 4,
            uid: 'recent',
            name: 'Call recent supplier',
            status: 0,
            created_at: '2020-01-01',
            updated_at: new Date().toISOString(),
        },
    ];
    render(
        <MemoryRouter>
            <ProductivityAssistant tasks={tasks as any} projects={[]} />
        </MemoryRouter>
    );
    expect(
        await screen.findByRole('button', { name: /Call stale supplier/ })
    ).toBeInTheDocument();
    expect(
        screen.queryByRole('button', { name: /Call cancelled supplier/ })
    ).not.toBeInTheDocument();
    expect(
        screen.queryByRole('button', { name: /Call completed supplier/ })
    ).not.toBeInTheDocument();
    expect(
        screen.queryByRole('button', { name: /Call recent supplier/ })
    ).not.toBeInTheDocument();
});
