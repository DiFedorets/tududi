import React, { useEffect, useState } from 'react';
import { oneApi, Plan } from './client';

// Compact indicators in the native toolbar. Planning stays in native views.
export default function TaskWorkflow({
    taskUid,
    refreshKey,
    onComments,
}: {
    taskUid: string;
    refreshKey?: string;
    onComments: () => void;
}) {
    const [data, setData] = useState<{
        enabled: boolean;
        plan: Plan;
        pending_comments: number;
    } | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let live = true;
        const load = async () => {
            try {
                const next = await oneApi<{
                    enabled: boolean;
                    plan: Plan;
                    pending_comments: number;
                }>(`/tasks/${taskUid}`);
                if (live) {
                    setData(next);
                    setFailed(false);
                }
            } catch {
                if (live) setFailed(true);
            }
        };
        setData(null);
        void load();
        window.addEventListener('oneWorkflowChanged', load);
        window.addEventListener('focus', load);
        return () => {
            live = false;
            window.removeEventListener('oneWorkflowChanged', load);
            window.removeEventListener('focus', load);
        };
    }, [taskUid, refreshKey]);
    if (failed)
        return (
            <span
                role="status"
                title="Не удалось обновить счётчик переносов и очередь ответов"
            >
                ↪ ?
            </span>
        );
    if (!data?.enabled) return null;
    return (
        <>
            {data.plan.moves > 0 && (
                <span
                    className="inline-flex items-center h-8 px-1.5 text-xs text-gray-500"
                    title={`Переносов: ${data.plan.moves}`}
                    aria-label={`Переносов: ${data.plan.moves}`}
                >
                    ↪ {data.plan.moves}
                </span>
            )}
            {data.pending_comments > 0 && (
                <button
                    type="button"
                    onClick={onComments}
                    className="rounded px-2 py-1 text-xs text-amber-700"
                    title="Есть комментарии без ответа агента; закрытие задачи заблокировано"
                >
                    Без ответа: {data.pending_comments}
                </button>
            )}
        </>
    );
}
