import MoveCounter from './MoveCounter';
import { ArrowUturnRightIcon } from '@heroicons/react/24/outline';
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
                <ArrowUturnRightIcon
                    className="h-4 w-4 inline"
                    aria-hidden="true"
                />{' '}
                ?
            </span>
        );
    if (!data?.enabled) return null;
    return (
        <>
            <MoveCounter moves={data.plan.moves} />
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
