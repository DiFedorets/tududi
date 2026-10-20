import { Task } from '../entities/Task';
import { updateTask } from './tasksService';

// Only the exact callback object is marked. Spreading a displayed task to make
// a new edit must not inherit a claim that the edit is already saved.
const confirmed = new WeakSet<object>();
export function confirmedTask<T extends Task>(task: T): T {
    confirmed.add(task);
    return task;
}
const editable = [
    'name',
    'note',
    'status',
    'priority',
    'due_date',
    'due_time',
    'defer_until',
    'project_id',
    'area_id',
    'goal_id',
    'assigned_to',
    'tags',
    'recurrence_type',
    'recurrence_interval',
    'recurrence_end_date',
    'recurrence_weekday',
    'recurrence_weekdays',
    'recurrence_month_day',
    'recurrence_week_of_month',
    'completion_based',
    'estimated_minutes',
] as const;

export async function persistTaskUpdate(
    proposed: Task,
    current?: Task
): Promise<Task> {
    if (confirmed.has(proposed)) return proposed;
    if (!current || !proposed.uid)
        throw new Error('Обновите список задач перед изменением.');
    const changes: Partial<Task> = {};
    for (const field of editable) {
        if (
            Object.prototype.hasOwnProperty.call(proposed, field) &&
            JSON.stringify(proposed[field]) !== JSON.stringify(current[field])
        ) {
            (changes as Record<string, unknown>)[field] = proposed[field];
        }
    }
    if (!Object.keys(changes).length) return current;
    return updateTask(proposed.uid, changes, current);
}
