import { renderHook, act } from '@testing-library/react';
import { useTaskDraft } from '../taskDraft';
import { getCurrentUser } from '../userUtils';
jest.mock('../userUtils', () => ({ getCurrentUser: jest.fn() }));
beforeEach(() => {
    localStorage.clear();
    (getCurrentUser as jest.Mock).mockReturnValue({ uid: 'human' });
});
it('retains a dirty description after new server content and across remounts', () => {
    const view = renderHook(({ server }) => useTaskDraft('task', server), {
        initialProps: { server: 'before' },
    });
    act(() => view.result.current.setValue('my draft'));
    view.rerender({ server: 'agent changed it' });
    expect(view.result.current.value).toBe('my draft');
    expect(view.result.current.conflict).toBe(true);
    view.unmount();
    const restored = renderHook(() => useTaskDraft('task', 'agent changed it'));
    expect(restored.result.current.value).toBe('my draft');
    expect(restored.result.current.conflict).toBe(true);
});
it('clears a draft after the server confirms its content', () => {
    const view = renderHook(({ server }) => useTaskDraft('task', server), {
        initialProps: { server: 'before' },
    });
    act(() => view.result.current.setValue('saved'));
    view.rerender({ server: 'saved' });
    expect(view.result.current.dirty).toBe(false);
    expect(localStorage.length).toBe(0);
});
it('does not carry another task’s draft into its storage key', () => {
    const view = renderHook(({ uid }) => useTaskDraft(uid, 'before'), {
        initialProps: { uid: 'first' },
    });
    act(() => view.result.current.setValue('first private draft'));
    view.rerender({ uid: 'second' });
    expect(view.result.current.value).toBe('before');
    expect(
        localStorage.getItem('tududi:task-draft:human:second:note')
    ).toBeNull();
    expect(
        JSON.parse(localStorage.getItem('tududi:task-draft:human:first:note')!)
            .value
    ).toBe('first private draft');
});
it('keeps drafts scoped to the current account', () => {
    const first = renderHook(() => useTaskDraft('task', 'before'));
    act(() => first.result.current.setValue('human private draft'));
    first.unmount();
    (getCurrentUser as jest.Mock).mockReturnValue({ uid: 'other' });
    const other = renderHook(() => useTaskDraft('task', 'before'));
    expect(other.result.current.value).toBe('before');
});
