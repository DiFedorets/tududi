import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { searchUniversal } from '../../utils/searchService';
export default function InlineTaskLinkPicker({
    onPick,
    onClose,
}: {
    onPick: (uid: string, type: 'related_to' | 'source') => Promise<void>;
    onClose: () => void;
}) {
    const [query, setQuery] = useState(''),
        [hits, setHits] = useState<{ uid: string; name: string }[]>([]),
        [relation, setRelation] = useState<'related_to' | 'source'>(
            'related_to'
        ),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false);
    const pending = useRef(false);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        input.current?.focus();
    }, []);
    useEffect(() => {
        let active = true;
        setHits([]);
        if (query.trim().length < 2) return;
        const id = setTimeout(() => {
            searchUniversal({
                query: query.trim(),
                filters: ['Task'],
                status: 'all',
                limit: 8,
            })
                .then(({ results }) => {
                    if (active)
                        setHits(
                            results
                                .filter((r) => r.uid)
                                .map((r) => ({ uid: r.uid!, name: r.name }))
                        );
                })
                .catch(() => {
                    if (active) setError('Не удалось выполнить поиск');
                });
        }, 250);
        return () => {
            active = false;
            clearTimeout(id);
        };
    }, [query]);
    const pick = async (uid: string) => {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError('');
        try {
            await onPick(uid, relation);
        } catch (e) {
            setError((e as Error).message || 'Не удалось добавить связь');
        } finally {
            pending.current = false;
            setBusy(false);
        }
    };
    return createPortal(
        <div
            className="fixed inset-0 z-[250] flex items-center justify-center bg-black/20 p-4"
            onKeyDown={(e) => {
                if (e.key === 'Tab') {
                    const dialog =
                        e.currentTarget.querySelector('[role="dialog"]');
                    const controls = dialog?.querySelectorAll<HTMLElement>(
                        'button:not(:disabled), input:not(:disabled), select:not(:disabled)'
                    );
                    if (controls?.length) {
                        const first = controls[0],
                            last = controls[controls.length - 1];
                        if (e.shiftKey && document.activeElement === first) {
                            e.preventDefault();
                            last.focus();
                        } else if (
                            !e.shiftKey &&
                            document.activeElement === last
                        ) {
                            e.preventDefault();
                            first.focus();
                        }
                    }
                }
                if (e.key === 'Escape' && !busy) {
                    e.stopPropagation();
                    onClose();
                }
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Связать текст с задачей"
                className="w-full max-w-md rounded-lg bg-white dark:bg-gray-900 shadow-xl p-4 space-y-3"
            >
                <h3 className="font-medium">Связать текст с задачей</h3>
                <label className="block text-sm">
                    Тип связи
                    <select
                        aria-label="Тип связи"
                        disabled={busy}
                        value={relation}
                        onChange={(e) =>
                            setRelation(e.target.value as typeof relation)
                        }
                        className="ml-2 rounded border bg-transparent p-1"
                    >
                        <option value="related_to">Связано</option>
                        <option value="source">Источник поручения</option>
                    </select>
                </label>
                <input
                    ref={input}
                    aria-label="Найти задачу"
                    disabled={busy}
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setError('');
                    }}
                    placeholder="Найти задачу…"
                    className="w-full rounded border border-gray-300 dark:border-gray-600 bg-transparent p-2 text-sm"
                />
                {error && (
                    <p role="alert" className="text-sm text-red-600">
                        {error}
                    </p>
                )}
                <ul className="max-h-60 overflow-y-auto">
                    {hits.map((hit) => (
                        <li key={hit.uid}>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => void pick(hit.uid)}
                                className="w-full rounded p-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                            >
                                {hit.name}
                            </button>
                        </li>
                    ))}
                </ul>
                <button
                    type="button"
                    disabled={busy}
                    onClick={onClose}
                    className="text-sm text-gray-500"
                >
                    Отмена
                </button>
            </div>
        </div>,
        document.body
    );
}
