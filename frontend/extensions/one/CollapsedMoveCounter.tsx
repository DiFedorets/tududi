import React, { useEffect, useState } from 'react';
import { oneApi } from './client';
import MoveCounter from './MoveCounter';
import { TASKS_CHANGED } from '../../utils/taskRefresh';
// Share one in-flight batch across rows instead of fetching each task separately.
let pending: Promise<Record<string, number>> | null = null;
function load() {
    if (!pending)
        pending = oneApi<Record<string, number>>('/move-counts').finally(() => {
            pending = null;
        });
    return pending;
}
export default function CollapsedMoveCounter({ taskUid }: { taskUid: string }) {
    const [moves, setMoves] = useState(0);
    useEffect(() => {
        let live = true;
        const refresh = () => {
            void load()
                .then((counts) => {
                    if (live) setMoves(counts[taskUid] || 0);
                })
                .catch(() => {});
        };
        refresh();
        window.addEventListener(TASKS_CHANGED, refresh);
        window.addEventListener('focus', refresh);
        window.addEventListener('oneWorkflowChanged', refresh);
        return () => {
            live = false;
            window.removeEventListener(TASKS_CHANGED, refresh);
            window.removeEventListener('focus', refresh);
            window.removeEventListener('oneWorkflowChanged', refresh);
        };
    }, [taskUid]);
    return <MoveCounter moves={moves} compact />;
}
