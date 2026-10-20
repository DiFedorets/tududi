import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PlanningControl from '../PlanningControl';
import { oneApi, changed, Plan } from '../client';
jest.mock('../client', () => ({ oneApi: jest.fn(), changed: jest.fn() }));
const plan: Plan = {
    task_uid: 'task-one',
    planned: null,
    week: null,
    last_planned: null,
    moves: 0,
    revision: 0,
};
beforeEach(() => jest.clearAllMocks());
it('saves a weekly selection with the read revision and without a fake deadline', async () => {
    const saved = { ...plan, week: '2030-01-07', revision: 1 };
    (oneApi as jest.Mock).mockResolvedValue(saved);
    const onSaved = jest.fn();
    render(
        <PlanningControl plan={plan} today="2030-01-08" onSaved={onSaved} />
    );
    fireEvent.change(screen.getByLabelText('Уровень плана'), {
        target: { value: 'week' },
    });
    fireEvent.input(screen.getByLabelText('Дата плана'), {
        target: { value: '2030-01-09' },
    });
    fireEvent.click(screen.getByText('Сохранить план'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(oneApi).toHaveBeenCalledWith('/tasks/task-one/plan', 'PUT', {
        expected_revision: 0,
        planned: null,
        week: '2030-01-09',
    });
    expect(changed).toHaveBeenCalled();
});
it('keeps the proposed date after a conflict and only reloads on explicit action', async () => {
    (oneApi as jest.Mock).mockRejectedValueOnce(new Error('План уже изменён'));
    render(
        <PlanningControl plan={plan} today="2030-01-08" onSaved={jest.fn()} />
    );
    fireEvent.change(screen.getByLabelText('Уровень плана'), {
        target: { value: 'day' },
    });
    fireEvent.change(screen.getByLabelText('Дата плана'), {
        target: { value: '2030-01-10' },
    });
    fireEvent.click(screen.getByText('Сохранить план'));
    await screen.findByRole('alert');
    expect(
        (screen.getByLabelText('Дата плана') as HTMLInputElement).value
    ).toBe('2030-01-10');
    expect(oneApi).toHaveBeenCalledTimes(1);
    (oneApi as jest.Mock).mockResolvedValueOnce({
        plan: { ...plan, planned: '2030-01-12', revision: 2 },
    });
    fireEvent.click(screen.getByText('Загрузить текущий план'));
    await waitFor(() =>
        expect(
            (screen.getByLabelText('Дата плана') as HTMLInputElement).value
        ).toBe('2030-01-12')
    );
});
it('does not silently replace a dirty choice after a background refresh', () => {
    const view = render(
        <PlanningControl plan={plan} today="2030-01-08" onSaved={jest.fn()} />
    );
    fireEvent.change(screen.getByLabelText('Уровень плана'), {
        target: { value: 'day' },
    });
    fireEvent.change(screen.getByLabelText('Дата плана'), {
        target: { value: '2030-01-10' },
    });
    view.rerender(
        <PlanningControl
            plan={{ ...plan, planned: '2030-01-11', revision: 1 }}
            today="2030-01-08"
            onSaved={jest.fn()}
        />
    );
    expect(
        (screen.getByLabelText('Дата плана') as HTMLInputElement).value
    ).toBe('2030-01-10');
    expect(
        screen.getByText(
            'План изменён в другом месте. Ваш выбор ещё не сохранён.'
        )
    ).toBeTruthy();
});

it('resets a dirty form when it belongs to a different task', () => {
    const view = render(
        <PlanningControl plan={plan} today="2030-01-08" onSaved={jest.fn()} />
    );
    fireEvent.change(screen.getByLabelText('Уровень плана'), {
        target: { value: 'day' },
    });
    fireEvent.change(screen.getByLabelText('Дата плана'), {
        target: { value: '2030-01-10' },
    });
    view.rerender(
        <PlanningControl
            plan={{ ...plan, task_uid: 'other-task', week: '2030-01-07' }}
            today="2030-01-08"
            onSaved={jest.fn()}
        />
    );
    expect(
        (screen.getByLabelText('Уровень плана') as HTMLSelectElement).value
    ).toBe('week');
    expect(
        (screen.getByLabelText('Дата плана') as HTMLInputElement).value
    ).toBe('2030-01-07');
});
