import { updateTask } from '../tasksService';
import { notifyTaskChange } from '../taskRefresh';
jest.mock('../taskRefresh', () => ({ notifyTaskChange: jest.fn() }));
jest.mock('../authUtils', () => ({
    getDefaultHeaders: () => ({}),
    getPostHeadersWithCsrf: async () => ({}),
    handleAuthResponse: async (response: any) => {
        if (!response.ok) throw new Error('conflict');
    },
}));
jest.mock('../tagsService', () => ({
    refreshTagCountsIfTagsChanged: jest.fn(),
}));
beforeEach(() => jest.clearAllMocks());
it('sends the source text read by the editor rather than fetching a newer version for an old draft', async () => {
    global.fetch = jest
        .fn()
        .mockResolvedValue({
            ok: true,
            json: async () => ({ uid: 'task', name: 'New', note: 'Draft' }),
        });
    await updateTask(
        'task',
        { name: 'New', note: 'Draft' },
        { name: 'Read title', note: 'Read description' }
    );
    const payload = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[0][1].body
    );
    expect(payload.expected_fields).toEqual({
        name: 'Read title',
        note: 'Read description',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(notifyTaskChange).toHaveBeenCalledTimes(1);
});
it('shares an identical in-flight blur/Enter write without a duplicate request', async () => {
    let acknowledge!: (value: unknown) => void;
    global.fetch = jest.fn().mockReturnValue(
        new Promise((resolve) => {
            acknowledge = resolve;
        })
    );
    const original = { name: 'Read title', note: 'Read description' };
    const first = updateTask('task', { name: 'New' }, original);
    const second = updateTask('task', { name: 'New' }, original);
    expect(first).toBe(second);
    await Promise.resolve();
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    acknowledge({ ok: true, json: async () => ({ uid: 'task', name: 'New' }) });
    await first;
});
it('does not emit a successful change or retry after a refused stale write', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    await expect(
        updateTask('task', { note: 'Draft' }, { name: 'Title', note: 'Old' })
    ).rejects.toThrow('conflict');
    expect(notifyTaskChange).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
});
