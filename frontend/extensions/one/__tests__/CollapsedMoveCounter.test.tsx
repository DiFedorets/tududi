import React from 'react';
import { render, screen, act } from '@testing-library/react';
import CollapsedMoveCounter from '../CollapsedMoveCounter';
import { oneApi } from '../client';
jest.mock('../client', () => ({ oneApi: jest.fn() }));
test('shares a batch between rows, hides zero and uses the native SVG style', async () => {
    let finish!: (value: Record<string, number>) => void;
    (oneApi as jest.Mock).mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            })
    );
    render(
        <>
            <CollapsedMoveCounter taskUid="moved" />
            <CollapsedMoveCounter taskUid="zero" />
        </>
    );
    expect(oneApi).toHaveBeenCalledTimes(1);
    await act(async () => finish({ moved: 2 }));
    expect(
        screen.getByLabelText('Переносов: 2').querySelector('svg')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Переносов: 0')).not.toBeInTheDocument();
    (oneApi as jest.Mock).mockResolvedValue({ moved: 3 });
    await act(async () => {
        window.dispatchEvent(new Event('tududi:tasks-changed'));
    });
    expect(screen.getByLabelText('Переносов: 3')).toBeInTheDocument();
});
