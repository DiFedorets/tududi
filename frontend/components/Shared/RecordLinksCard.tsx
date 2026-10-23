import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LinkIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
    RecordLink,
    RecordType,
    fetchRecordLinks,
    addRecordLink,
    removeRecordLink,
} from '../../utils/recordLinksService';
import { searchUniversal } from '../../utils/searchService';
import { useToast } from './ToastContext';
export default function RecordLinksCard({
    type,
    uid,
}: {
    type: RecordType;
    uid: string;
}) {
    const { t } = useTranslation();
    const { showErrorToast } = useToast();
    const [links, setLinks] = useState<RecordLink[]>([]),
        [adding, setAdding] = useState(false),
        [query, setQuery] = useState('');
    const [relation, setRelation] = useState<RecordLink['type']>('related_to');
    const [hits, setHits] = useState<{ uid: string; title: string }[]>([]),
        [busy, setBusy] = useState(false),
        [loaded, setLoaded] = useState(false);
    const generation = useRef(0),
        pending = useRef(false);
    useEffect(() => {
        const id = ++generation.current;
        setLinks([]);
        setAdding(false);
        setQuery('');
        setHits([]);
        setLoaded(false);
        fetchRecordLinks(type, uid)
            .then((rows) => {
                if (generation.current === id) {
                    setLinks(rows);
                    setLoaded(true);
                }
            })
            .catch(() => {
                if (generation.current === id)
                    showErrorToast(t('recordLinks.loadError'));
            });
        return () => {
            generation.current++;
        };
    }, [type, uid]);
    useEffect(() => {
        const reload = () => {
            const id = generation.current;
            fetchRecordLinks(type, uid)
                .then((rows) => {
                    if (id === generation.current) setLinks(rows);
                })
                .catch(() => showErrorToast(t('recordLinks.loadError')));
        };
        window.addEventListener('record-links-changed', reload);
        return () => window.removeEventListener('record-links-changed', reload);
    }, [type, uid]);
    useEffect(() => {
        let active = true;
        setHits([]);
        if (!adding || query.trim().length < 2) return;
        const timer = setTimeout(() => {
            searchUniversal({
                query: query.trim(),
                filters: [type === 'task' ? 'Note' : 'Task'],
                limit: 8,
                status: 'all',
            })
                .then(({ results }) => {
                    if (active)
                        setHits(
                            results
                                .filter((item) => item.uid)
                                .map((item) => ({
                                    uid: item.uid!,
                                    title: item.title || item.name,
                                }))
                        );
                })
                .catch(() => {
                    if (active) showErrorToast(t('recordLinks.searchError'));
                });
        }, 250);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [query, adding, type, uid]);
    const mutate = async (action: () => Promise<void>) => {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        const id = generation.current;
        try {
            await action();
            const rows = await fetchRecordLinks(type, uid);
            if (id === generation.current) {
                setLinks(rows);
                setAdding(false);
                setQuery('');
            }
        } catch {
            if (id === generation.current)
                showErrorToast(t('recordLinks.saveError'));
        } finally {
            pending.current = false;
            setBusy(false);
        }
    };
    const label = (value: RecordLink['type']) =>
        value === 'related_to'
            ? t('recordLinks.related')
            : t(type === 'task' ? 'recordLinks.source' : 'recordLinks.result');
    return (
        <details
            key={type + uid}
            className="text-sm text-gray-600 dark:text-gray-400"
            data-record-links={type}
        >
            <summary className="cursor-pointer select-none py-1">
                {t('recordLinks.summary', 'Связи')} · {links.length}
            </summary>
            <div className="py-2">
                <div className="flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
                        <LinkIcon className="h-4 w-4" />
                        {t(
                            type === 'task'
                                ? 'recordLinks.notes'
                                : 'recordLinks.tasks'
                        )}
                    </h3>
                    <button
                        type="button"
                        disabled={busy || !loaded}
                        onClick={() => setAdding(!adding)}
                        aria-label={t('recordLinks.add')}
                        className="p-1 text-gray-500 hover:text-blue-500 disabled:opacity-50"
                    >
                        <PlusIcon className="h-5 w-5" />
                    </button>
                </div>
                {loaded && links.length === 0 && (
                    <p className="mt-2 text-sm text-gray-500">
                        {t('recordLinks.empty')}
                    </p>
                )}
                <ul className="mt-2 space-y-2">
                    {links.map((link) => (
                        <li
                            key={link.uid}
                            className="flex items-center gap-2 text-sm"
                        >
                            <div className="min-w-0 flex-1">
                                <span className="text-xs text-gray-500">
                                    {label(link.type)}
                                </span>
                                <Link
                                    to={
                                        link.target.type === 'task'
                                            ? `/task/${link.target.uid}`
                                            : `/notes/${link.target.uid}`
                                    }
                                    className="block text-blue-600 dark:text-blue-400 hover:underline break-words"
                                >
                                    {link.target.title ||
                                        t('recordLinks.untitled')}
                                </Link>
                            </div>
                            {link.can_remove && (
                                <button
                                    type="button"
                                    disabled={busy}
                                    aria-label={t('recordLinks.remove')}
                                    onClick={() =>
                                        void mutate(() =>
                                            removeRecordLink(
                                                type,
                                                uid,
                                                link.uid
                                            )
                                        )
                                    }
                                    className="p-1 text-gray-400 hover:text-red-500"
                                >
                                    <XMarkIcon className="h-4 w-4" />
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
                {adding && (
                    <div className="mt-3 space-y-2">
                        <label className="block text-sm">
                            {t('recordLinks.kind')}
                            <select
                                value={relation}
                                disabled={busy}
                                onChange={(e) =>
                                    setRelation(
                                        e.target.value as RecordLink['type']
                                    )
                                }
                                className="block w-full rounded border border-gray-300 dark:border-gray-600 bg-transparent p-2"
                            >
                                <option value="related_to">
                                    {label('related_to')}
                                </option>
                                <option value="source">
                                    {label('source')}
                                </option>
                            </select>
                        </label>
                        <input
                            aria-label={t('recordLinks.search')}
                            autoFocus
                            value={query}
                            disabled={busy}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t(
                                type === 'task'
                                    ? 'recordLinks.searchNotes'
                                    : 'recordLinks.searchTasks'
                            )}
                            className="w-full rounded border border-gray-300 dark:border-gray-600 bg-transparent p-2 text-sm"
                        />
                        <ul>
                            {hits.map((hit) => (
                                <li key={hit.uid}>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() =>
                                            void mutate(() =>
                                                addRecordLink(
                                                    type,
                                                    uid,
                                                    hit.uid,
                                                    relation
                                                )
                                            )
                                        }
                                        className="w-full rounded p-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                        {hit.title}
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                                setAdding(false);
                                setQuery('');
                            }}
                            className="text-sm text-gray-500"
                        >
                            {t('common.cancel')}
                        </button>
                    </div>
                )}
            </div>
        </details>
    );
}
