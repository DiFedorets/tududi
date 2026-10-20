import { act, renderHook } from '@testing-library/react';
import { TASKS_CHANGED, useTaskRefresh } from '../taskRefresh';
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it('refreshes on return and collapses repeated confirmed mutation events', () => {
    const refresh = jest.fn();
    const view = renderHook(() => useTaskRefresh(refresh));
    act(() => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event(TASKS_CHANGED));
        window.dispatchEvent(new Event(TASKS_CHANGED));
        jest.advanceTimersByTime(250);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    view.unmount();
    act(() => {
        window.dispatchEvent(new Event(TASKS_CHANGED));
        jest.advanceTimersByTime(250);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
});
it('defers refresh while an inline editor is open, then resumes on close', () => {
    const refresh = jest.fn();
    renderHook(() => useTaskRefresh(refresh));
    const editor = document.createElement('div');
    editor.dataset.taskExpanded = 'true';
    document.body.append(editor);
    act(() => {
        window.dispatchEvent(new Event(TASKS_CHANGED));
        jest.advanceTimersByTime(250);
    });
    expect(refresh).not.toHaveBeenCalled();
    editor.remove();
    act(() => {
        document.dispatchEvent(new Event('click'));
        jest.advanceTimersByTime(250);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
});
