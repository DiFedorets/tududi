import React, { useEffect, useRef, useState } from 'react';
import {
    DndContext,
    closestCenter,
    pointerWithin,
    useDraggable,
    useDroppable,
    DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { Task } from '../../entities/Task';
import { Project } from '../../entities/Project';
import { GroupedTasks, updateTask } from '../../utils/tasksService';
import { confirmedTask } from '../../utils/taskUpdates';
import { useSortableSensors, swallowNextClick } from '../Shared/sortableList';
import { useToast } from '../Shared/ToastContext';
import TaskItem from './TaskItem';
import { TASK_SHEET_CLASS } from './taskSheet';

export const upcomingGroupDate = (tasks: Task[]): string | null => {
    const dates = tasks.map((task) => task.due_date?.slice(0, 10));
    return dates.length &&
        dates.every(
            (date) =>
                date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date === dates[0]
        )
        ? dates[0]!
        : null;
};
export const canMoveUpcomingTask = (task: Task) =>
    Boolean(
        task.uid &&
        !task.is_virtual_occurrence &&
        !task.recurring_parent_id &&
        !task.habit_mode &&
        (!task.recurrence_type || task.recurrence_type === 'none')
    );
const controls = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(
        target.closest(
            'button,a,input,textarea,select,[contenteditable="true"],[role="menu"]'
        )
    );

function DayColumn({
    label,
    children,
    pending,
}: {
    label: string;
    children: React.ReactNode;
    pending: boolean;
}) {
    const { setNodeRef, isOver } = useDroppable({
        id: 'day:' + label,
        disabled: pending,
    });
    return (
        <section
            ref={setNodeRef}
            data-day-column={label}
            className={`day-column w-full md:flex-1 md:min-w-64 min-h-36 rounded-xl transition-colors ${isOver ? 'bg-blue-50 ring-2 ring-blue-400 dark:bg-blue-900/20' : ''}`}
        >
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 pb-3 mb-4">
                {label}
            </h3>
            <div className={TASK_SHEET_CLASS}>{children}</div>
        </section>
    );
}
function UpcomingCard({
    task,
    disabled,
    children,
    onKeyboardMove,
}: {
    task: Task;
    disabled: boolean;
    children: React.ReactNode;
    onKeyboardMove: (direction: number) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, isDragging } =
        useDraggable({ id: task.uid || String(task.id), disabled });
    const { t } = useTranslation();
    const hasEditor = (node: HTMLElement) =>
        Boolean(node.querySelector('[data-quick-comment-open="true"]'));
    return (
        <div
            ref={setNodeRef}
            {...attributes}
            style={{ transform: CSS.Translate.toString(transform) }}
            data-upcoming-card={task.uid}
            data-dragging={isDragging || undefined}
            aria-label={`${task.name}. ${disabled ? t('tasks.upcomingBoard.recurringMove', 'Recurring tasks: change the date from the task page.') : t('tasks.upcomingBoard.keyboardMove', 'Move: Alt + Left or Right arrow.')}`}
            className={`relative hover:z-[10000] focus-within:z-[10000] focus-visible:ring-2 focus-visible:ring-blue-500 ${disabled ? '' : 'cursor-grab active:cursor-grabbing'} ${isDragging ? 'z-[10001] shadow-xl opacity-80' : ''}`}
            onMouseDown={(event) => {
                if (
                    !controls(event.target) &&
                    !hasEditor(event.currentTarget) &&
                    !window.getSelection()?.toString()
                )
                    listeners?.onMouseDown?.(event);
            }}
            onTouchStart={(event) => {
                if (!controls(event.target) && !hasEditor(event.currentTarget))
                    listeners?.onTouchStart?.(event);
            }}
            onKeyDown={(event) => {
                if (
                    event.target !== event.currentTarget ||
                    disabled ||
                    hasEditor(event.currentTarget)
                )
                    return;
                if (
                    event.altKey &&
                    ['ArrowLeft', 'ArrowRight'].includes(event.key)
                ) {
                    event.preventDefault();
                    onKeyboardMove(event.key === 'ArrowLeft' ? -1 : 1);
                }
            }}
        >
            {children}
        </div>
    );
}
interface Props {
    groups: GroupedTasks;
    onTaskUpdate: (task: Task) => Promise<void>;
    onTaskCompletionToggle?: (task: Task) => void;
    onTaskDelete: (uid: string) => void;
    projects: Project[];
    hideProjectName?: boolean;
    showCompletedTasks?: boolean;
}
export default function UpcomingBoard({
    groups,
    onTaskUpdate,
    onTaskCompletionToggle,
    onTaskDelete,
    projects,
    hideProjectName,
    showCompletedTasks,
}: Props) {
    const { t } = useTranslation();
    const { showErrorToast, showSuccessToast, showUndoToast } = useToast();
    const sensors = useSortableSensors();
    const busy = useRef(false);
    const [pending, setPending] = useState(false);
    const [dateChoice, setDateChoice] = useState<{
        task: Task;
        group: string;
    } | null>(null);
    const [chosenDate, setChosenDate] = useState('');
    const [announcement, setAnnouncement] = useState('');
    // Remember the destination of a column while its last card moves away.
    const dates = useRef(new Map<string, string>());
    useEffect(() => {
        Object.entries(groups).forEach(([label, rows]) => {
            const date = upcomingGroupDate(rows);
            if (date) dates.current.set(label, date);
        });
    }, [groups]);
    const move = async (task: Task, date: string, undo = true) => {
        if (
            busy.current ||
            !canMoveUpcomingTask(task) ||
            task.due_date?.slice(0, 10) === date
        )
            return;
        busy.current = true;
        setPending(true);
        try {
            const saved = await updateTask(
                task.uid!,
                { due_date: date, due_time: task.due_time || null },
                task
            );
            await onTaskUpdate(confirmedTask(saved));
            const message = t(
                'tasks.upcomingBoard.moved',
                'Moved to {{date}}',
                {
                    date,
                }
            );
            setAnnouncement(message);
            if (undo && task.due_date)
                showUndoToast(message, () => {
                    void move(saved, task.due_date!.slice(0, 10), false);
                });
            else showSuccessToast(message);
            setDateChoice(null);
        } catch (error) {
            showErrorToast(
                error instanceof Error
                    ? error.message
                    : t(
                          'tasks.upcomingBoard.moveFailed',
                          'Could not move the task.'
                      )
            );
        } finally {
            busy.current = false;
            setPending(false);
        }
    };
    const drop = (task: Task, label: string) => {
        const current = Object.entries(groups).find(([, rows]) =>
            rows.some((row) => row.uid === task.uid)
        );
        if (current?.[0] === label) return;
        const date =
            upcomingGroupDate(groups[label] || []) || dates.current.get(label);
        if (date) void move(task, date);
        else {
            setChosenDate('');
            setDateChoice({ task, group: label });
        }
    };
    const handleEnd = ({ active, over }: DragEndEvent) => {
        if (!over || typeof over.id !== 'string' || !over.id.startsWith('day:'))
            return;
        swallowNextClick();
        const task = Object.values(groups)
            .flat()
            .find((row) => row.uid === active.id);
        if (task) drop(task, over.id.slice(4));
    };
    return (
        <>
            <div className="sr-only" role="status" aria-live="polite">
                {announcement}
            </div>
            {dateChoice && (
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (chosenDate) void move(dateChoice.task, chosenDate);
                    }}
                    className="mb-4 p-4 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-3"
                >
                    <label className="text-sm">
                        {t(
                            'tasks.upcomingBoard.chooseDay',
                            'Choose a specific day for this column'
                        )}
                        : {dateChoice.group}
                        <input
                            type="date"
                            required
                            value={chosenDate}
                            onChange={(event) =>
                                setChosenDate(event.target.value)
                            }
                            className="ml-2 border rounded p-2 bg-transparent"
                        />
                    </label>
                    <button
                        type="submit"
                        disabled={pending}
                        className="px-3 py-2 text-sm bg-blue-600 text-white rounded"
                    >
                        {t('common.save', 'Save')}
                    </button>
                    <button
                        type="button"
                        disabled={pending}
                        onClick={() => setDateChoice(null)}
                        className="px-3 py-2 text-sm"
                    >
                        {t('common.cancel', 'Cancel')}
                    </button>
                </form>
            )}
            <DndContext
                sensors={sensors}
                collisionDetection={(args) => {
                    const hits = pointerWithin(args);
                    return hits.length ? hits : closestCenter(args);
                }}
                onDragEnd={handleEnd}
            >
                <div className="flex flex-col md:flex-row gap-4 md:gap-6 w-full pb-4">
                    {Object.entries(groups).map(
                        ([label, tasks], index, columns) => (
                            <DayColumn
                                key={label}
                                label={label}
                                pending={pending}
                            >
                                {tasks.map((task) => (
                                    <UpcomingCard
                                        key={
                                            task.virtual_id ??
                                            task.uid ??
                                            task.id
                                        }
                                        task={task}
                                        disabled={
                                            pending ||
                                            !canMoveUpcomingTask(task)
                                        }
                                        onKeyboardMove={(direction) => {
                                            const target =
                                                columns[index + direction];
                                            if (target) drop(task, target[0]);
                                        }}
                                    >
                                        <TaskItem
                                            task={task}
                                            onTaskUpdate={onTaskUpdate}
                                            onTaskCompletionToggle={
                                                onTaskCompletionToggle
                                            }
                                            onTaskDelete={onTaskDelete}
                                            projects={projects}
                                            hideProjectName={hideProjectName}
                                            isUpcomingView
                                            showCompletedTasks={
                                                showCompletedTasks
                                            }
                                        />
                                    </UpcomingCard>
                                ))}
                            </DayColumn>
                        )
                    )}
                </div>
            </DndContext>
        </>
    );
}
