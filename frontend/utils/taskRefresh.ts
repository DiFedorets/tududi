import { useEffect, useRef } from 'react';
export const TASKS_CHANGED = 'tududi:tasks-changed';
let channel: BroadcastChannel | undefined;
export function notifyTaskChange() {
    window.dispatchEvent(new Event(TASKS_CHANGED));
    if (typeof BroadcastChannel !== 'undefined') {
        channel ??= new BroadcastChannel(TASKS_CHANGED);
        channel.postMessage('refresh');
    }
}
// Refresh on return and after confirmed writes, never while a card/editor is
// open. No polling or page reload, and no task contents sent between tabs.
export function useTaskRefresh(refresh: () => void | Promise<unknown>) {
    const current = useRef(refresh);
    current.current = refresh;
    useEffect(() => {
        let pending = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const run = () => {
            if (document.visibilityState !== 'visible') return;
            const active = document.activeElement;
            if (
                active?.matches('input, textarea, [contenteditable="true"]') ||
                document.querySelector(
                    '[data-task-expanded="true"], [data-task-editing="true"]'
                )
            ) {
                pending = true;
                return;
            }
            pending = false;
            Promise.resolve(current.current()).catch((error) =>
                console.warn('Task refresh failed:', error)
            );
        };
        const schedule = () => {
            clearTimeout(timer);
            timer = setTimeout(run, 200);
        };
        const resume = () => {
            if (pending) schedule();
        };
        const receiver =
            typeof BroadcastChannel !== 'undefined'
                ? new BroadcastChannel(TASKS_CHANGED)
                : undefined;
        if (receiver) receiver.onmessage = schedule;
        window.addEventListener(TASKS_CHANGED, schedule);
        window.addEventListener('oneWorkflowChanged', schedule);
        window.addEventListener('focus', schedule);
        document.addEventListener('visibilitychange', schedule);
        document.addEventListener('focusout', resume);
        document.addEventListener('click', resume);
        return () => {
            clearTimeout(timer);
            receiver?.close();
            window.removeEventListener(TASKS_CHANGED, schedule);
            window.removeEventListener('oneWorkflowChanged', schedule);
            window.removeEventListener('focus', schedule);
            document.removeEventListener('visibilitychange', schedule);
            document.removeEventListener('focusout', resume);
            document.removeEventListener('click', resume);
        };
    }, []);
}
