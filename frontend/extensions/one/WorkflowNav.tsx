import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import { oneApi } from './client';
import SyncStatus from './SyncStatus';
export default function WorkflowNav({
    compact = false,
}: {
    compact?: boolean;
}) {
    const location = useLocation();
    const [counts, setCounts] = useState<{
            agent_owes: number;
            human_owes: number;
        } | null>(null),
        [failed, setFailed] = useState(false);
    useEffect(() => {
        let live = true;
        const load = async () => {
            if (document.visibilityState !== 'visible') return;
            try {
                const data = await oneApi<{
                    agent_owes: number;
                    human_owes: number;
                }>('/counts');
                if (live) {
                    setCounts(data);
                    setFailed(false);
                }
            } catch {
                if (live) setFailed(true);
            }
        };
        void load();
        const timer = setInterval(() => void load(), 30000);
        window.addEventListener('oneWorkflowChanged', load);
        window.addEventListener('focus', load);
        return () => {
            live = false;
            clearInterval(timer);
            window.removeEventListener('oneWorkflowChanged', load);
            window.removeEventListener('focus', load);
        };
    }, []);
    const count = counts ? counts.agent_owes + counts.human_owes : 0;
    return (
        <>
            <Link
                to="/extensions/one"
                aria-current={
                    location.pathname === '/extensions/one' ? 'page' : undefined
                }
                title={
                    failed
                        ? 'Не удалось обновить очереди'
                        : `Агент должен ответить: ${counts?.agent_owes ?? '…'}; мне ответить: ${counts?.human_owes ?? '…'}`
                }
                aria-label="Ответы"
                className={`${compact ? 'h-9 w-9 justify-center' : 'mx-2.5 mb-3 px-3 py-2 gap-2'} flex items-center rounded-lg text-sm font-medium ${location.pathname === '/extensions/one' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
                <ChatBubbleLeftRightIcon className="h-4 w-4 shrink-0" />
                {!compact && <span>Ответы</span>}
                {(count > 0 || failed) && (
                    <span className="rounded bg-amber-200 px-1 text-xs text-gray-950">
                        {failed ? '!' : count}
                    </span>
                )}
            </Link>
            <SyncStatus compact />
        </>
    );
}
