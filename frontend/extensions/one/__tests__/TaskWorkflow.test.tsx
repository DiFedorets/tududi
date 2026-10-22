import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import TaskWorkflow from '../TaskWorkflow';
import { oneApi } from '../client';
jest.mock('../client', () => ({ oneApi: jest.fn() }));
const data = (moves: number, pending_comments = 0) => ({
    enabled: true,
    plan: { moves },
    pending_comments,
});
test('hides zero and all former planning controls', async () => {
    (oneApi as jest.Mock).mockResolvedValue(data(0));
    const { container } = render(
        <TaskWorkflow taskUid="one" onComments={jest.fn()} />
    );
    await waitFor(() => expect(oneApi).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    expect(screen.queryByText('Изменить план')).not.toBeInTheDocument();
});
test('shows saved moves and takes the answer debt to the native discussion', async () => {
    (oneApi as jest.Mock).mockResolvedValue(data(3, 2));
    const onComments = jest.fn();
    render(<TaskWorkflow taskUid="one" onComments={onComments} />);
    expect(await screen.findByLabelText('Переносов: 3')).toHaveTextContent('3');
    expect(
        screen.getByLabelText('Переносов: 3').querySelector('svg')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Без ответа: 2' }));
    expect(onComments).toHaveBeenCalledTimes(1);
});
test('refreshes after a native task edit', async () => {
    (oneApi as jest.Mock)
        .mockResolvedValueOnce(data(1))
        .mockResolvedValueOnce(data(2));
    const { rerender } = render(
        <TaskWorkflow
            taskUid="one"
            refreshKey="before"
            onComments={jest.fn()}
        />
    );
    await screen.findByLabelText('Переносов: 1');
    rerender(
        <TaskWorkflow taskUid="one" refreshKey="after" onComments={jest.fn()} />
    );
    await screen.findByLabelText('Переносов: 2');
});
