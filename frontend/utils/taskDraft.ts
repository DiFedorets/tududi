import { useEffect, useRef, useState } from 'react';
import { getCurrentUser } from './userUtils';
type Draft = { key: string | null; base: string; value: string };
const keyFor = (uid?: string) => {
    const user = getCurrentUser()?.uid;
    return uid && user ? `tududi:task-draft:${user}:${uid}:note` : null;
};
function read(key: string | null, value: string): Draft {
    try {
        const saved = key && localStorage.getItem(key);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (
                typeof parsed.base === 'string' &&
                typeof parsed.value === 'string'
            )
                return { key, base: parsed.base, value: parsed.value };
        }
    } catch {
        /* the live editor still works if browser storage is unavailable */
    }
    return { key, base: value, value };
}
export function downloadTaskDraft(value: string) {
    const url = URL.createObjectURL(
        new Blob([value], { type: 'text/plain;charset=utf-8' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'task-draft.txt';
    link.click();
    URL.revokeObjectURL(url);
}
export function useTaskDraft(uid: string | undefined, server: string) {
    const key = keyFor(uid);
    const [draft, setDraft] = useState<Draft>(() => read(key, server));
    const [storageError, setStorageError] = useState('');
    const identity = useRef(key ?? uid);
    useEffect(() => {
        if (identity.current !== (key ?? uid)) {
            identity.current = key ?? uid;
            setDraft(read(key, server));
        } else
            setDraft((previous) =>
                previous.value === previous.base || previous.value === server
                    ? { key, base: server, value: server }
                    : previous
            );
    }, [key, uid, server]);
    useEffect(() => {
        if (!key || draft.key !== key) return;
        try {
            if (draft.value === draft.base) localStorage.removeItem(key);
            else localStorage.setItem(key, JSON.stringify(draft));
            setStorageError('');
        } catch {
            setStorageError(
                'Не удалось сохранить черновик в браузере. Скачайте его перед выходом.'
            );
        }
    }, [key, draft]);
    return {
        value: draft.value,
        setValue: (value: string) =>
            setDraft((previous) => ({ ...previous, value })),
        conflict:
            draft.value !== draft.base &&
            server !== draft.base &&
            server !== draft.value,
        dirty: draft.value !== server,
        storageError,
        reset: () => setDraft({ key, base: server, value: server }),
    };
}
