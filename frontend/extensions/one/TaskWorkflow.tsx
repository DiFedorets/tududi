import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import PlanningControl from './PlanningControl';
import { Plan, oneApi } from './client';
export default function TaskWorkflow({ taskUid }: { taskUid: string }) {
    const [data, setData] = useState<{
            enabled: boolean;
            plan: Plan;
            pending_comments: number;
        } | null>(null),
        [error, setError] = useState(''),
        [edit, setEdit] = useState(false),
        [today, setToday] = useState('');
    const generation = useRef(0);
    const load = async () => {
        const current = ++generation.current;
        try {
            const next = await oneApi<{
                enabled: boolean;
                plan: Plan;
                pending_comments: number;
                today: string;
            }>(`/tasks/${taskUid}`);
            if (current !== generation.current) return;
            setData(next);
            setToday(next.today);
            setError('');
        } catch (err) {
            if (current === generation.current)
                setError((err as Error).message);
        }
    };
    useEffect(() => {
        setData(null);
        setEdit(false);
        void load();
        window.addEventListener('oneWorkflowChanged', load);
        window.addEventListener('focus', load);
        return () => {
            generation.current++;
            window.removeEventListener('oneWorkflowChanged', load);
            window.removeEventListener('focus', load);
        };
    }, [taskUid]);
    if (error)
        return (
            <p className="text-sm text-red-600" role="alert">
                {error}
            </p>
        );
    if (!data?.enabled) return null;
    return (
        <section
            className="rounded-lg border p-4 mb-4 space-y-3"
            aria-label="План и ответы One"
        >
            <div className="flex flex-wrap gap-3 items-center">
                <span className="text-sm font-medium">
                    {data.plan.planned
                        ? `День: ${data.plan.planned}`
                        : data.plan.week
                          ? `Неделя с ${data.plan.week}`
                          : 'День и неделя пока не выбраны'}
                </span>
                <span className="text-xs text-gray-500">
                    Переносов: {data.plan.moves}
                </span>
                <button
                    className="text-sm underline text-blue-600"
                    onClick={() => setEdit(!edit)}
                >
                    Изменить план
                </button>
                <Link className="text-sm underline" to="/extensions/one">
                    Все ответы и план
                </Link>
            </div>
            {data.pending_comments > 0 && (
                <p className="text-sm text-amber-700">
                    Комментариев без ответа агента: {data.pending_comments}.
                    Закрытие задачи заблокировано.
                </p>
            )}
            {edit && today && (
                <PlanningControl
                    plan={data.plan}
                    today={today}
                    onSaved={() => {
                        setEdit(false);
                        void load();
                    }}
                    onCancel={() => setEdit(false)}
                />
            )}
        </section>
    );
}
