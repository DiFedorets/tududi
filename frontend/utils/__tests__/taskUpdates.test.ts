import { confirmedTask, persistTaskUpdate } from '../taskUpdates';
import { updateTask } from '../tasksService';
import { Task } from '../../entities/Task';
jest.mock('../tasksService', () => ({ updateTask: jest.fn() }));
const task = {
    id: 1,
    uid: 'one',
    name: 'Original',
    note: 'Keep this description',
    status: 0,
    subtasks: [{ id: 2, uid: 'child' }],
} as Task;
beforeEach(() => jest.clearAllMocks());
it('does not PATCH a quick-edit response a second time or remove children', async () => {
    const saved = confirmedTask({ ...task, priority: 'high' as const });
    expect(await persistTaskUpdate(saved, task)).toBe(saved);
    expect(updateTask).not.toHaveBeenCalled();
});
it('sends only the changed status from a board snapshot', async () => {
    (updateTask as jest.Mock).mockResolvedValue({ ...task, status: 2 });
    await persistTaskUpdate({ ...task, status: 2 }, task);
    expect(updateTask).toHaveBeenCalledWith('one', { status: 2 }, task);
});
it('does not inherit confirmation when a saved row is spread to make another edit', async () => {
    const saved = confirmedTask({ ...task });
    await persistTaskUpdate({ ...saved, priority: 'high' }, saved);
    expect(updateTask).toHaveBeenCalledWith('one', { priority: 'high' }, saved);
});
it('propagates a server refusal and does not retry a broader write', async () => {
    (updateTask as jest.Mock).mockRejectedValueOnce(
        new Error('Сначала ответьте на комментарий')
    );
    await expect(
        persistTaskUpdate({ ...task, status: 2 }, task)
    ).rejects.toThrow('Сначала ответьте');
    expect(updateTask).toHaveBeenCalledTimes(1);
});
