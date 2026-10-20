import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useSearchParams } from 'react-router-dom';
import { getApiPath } from '../../config/paths';
import {
    getDefaultHeaders,
    getPostHeadersWithCsrf,
} from '../../utils/authUtils';
import { getCurrentUser } from '../../utils/userUtils';
import { createNote } from '../../utils/notesService';
import { Note } from '../../entities/Note';

type Source = {
    type: string;
    uid: string;
    title: string;
    href: string;
    text?: string;
    created_at: string;
    author?: { name: string };
    excerpts?: { line: number; text: string; timecodes: string[] }[];
    related?: Source[];
};
type Results = {
    total: number;
    offset: number;
    has_more: boolean;
    elapsed_ms: number;
    results: Source[];
};
const label = (type: string) =>
    ({ task: 'Задача', note: 'Заметка', comment: 'Комментарий' })[type] || type;
const draftPrefix = () => `tududi:note-conflict:${getCurrentUser()?.uid}:`;
const drafts = (): [string, Note][] =>
    Object.keys(localStorage)
        .filter((key) => key.startsWith(draftPrefix()))
        .flatMap((key) => {
            try {
                return [
                    [
                        key,
                        JSON.parse(localStorage.getItem(key) || '') as Note,
                    ] as [string, Note],
                ];
            } catch {
                return [];
            }
        });
async function api(path: string) {
    const response = await fetch(getApiPath(path), {
        credentials: 'include',
        headers: getDefaultHeaders(),
        cache: 'no-store',
    });
    if (!response.ok)
        throw new Error(
            'Не удалось получить источники. Проверьте вход и доступ.'
        );
    return response.json();
}
export default function HistoryPage() {
    const [params, setParams] = useSearchParams();
    const [query, setQuery] = useState(params.get('q') || '');
    const [result, setResult] = useState<Results | null>(null);
    const [source, setSource] = useState<Source | null>(null);
    const [error, setError] = useState('');
    const [answer, setAnswer] = useState<{
        answer: string;
        search_ms: number;
        total_ms: number;
        first_token_ms?: number | null;
    } | null>(null);
    const [busy, setBusy] = useState(false);
    const [conflicts, setConflicts] = useState(drafts);
    const search = async (offset = 0) => {
        setBusy(true);
        setError('');
        setSource(null);
        try {
            const response = await api(
                `extensions/history/search?query=${encodeURIComponent(query)}&offset=${offset}`
            );
            setResult(response);
            setParams({ q: query });
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    };
    const open = async (item: Source) => {
        setError('');
        try {
            setSource(
                await api(`extensions/history/source/${item.type}/${item.uid}`)
            );
        } catch (err) {
            setError((err as Error).message);
        }
    };
    const ask = async () => {
        setBusy(true);
        setError('');
        setAnswer(null);
        try {
            const response = await fetch(
                getApiPath('extensions/history/answer/stream'),
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: await getPostHeadersWithCsrf(),
                    body: JSON.stringify({ query }),
                }
            );
            if (!response.ok || !response.body)
                throw new Error('Не удалось открыть поток ответа');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '',
                text = '',
                finished = false;
            for (;;) {
                const { value, done } = await reader.read();
                buffer += decoder.decode(value, { stream: !done });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    const event = JSON.parse(line);
                    if (event.type === 'error') throw new Error(event.message);
                    if (event.type === 'sources') {
                        setResult({
                            total: event.sources.length,
                            offset: 0,
                            has_more: false,
                            elapsed_ms: event.search_ms,
                            results: event.sources.map(
                                (
                                    item: Source & { record_created_at: string }
                                ) => ({
                                    ...item,
                                    created_at: item.record_created_at,
                                })
                            ),
                        });
                        setAnswer({
                            answer: '',
                            search_ms: event.search_ms,
                            total_ms: 0,
                        });
                    }
                    if (event.type === 'delta') {
                        text += event.text;
                        setAnswer({
                            answer: text,
                            search_ms: 0,
                            total_ms: 0,
                            first_token_ms: event.first_token_ms,
                        });
                    }
                    if (event.type === 'done') {
                        setAnswer(event);
                        finished = true;
                    }
                }
                if (done) break;
            }
            if (!finished)
                throw new Error(
                    'Ответ прерван. Показанный фрагмент может быть неполным.'
                );
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    };
    const recover = async (key: string, note: Note) => {
        try {
            const saved = await createNote({
                title: `${note.title} — конфликтный черновик`,
                content: note.content,
            });
            localStorage.removeItem(key);
            setConflicts(drafts());
            window.open(`/notes/${saved.uid}`, '_blank', 'noopener');
        } catch {
            setError(
                'Не удалось сохранить копию. Черновик остаётся в этом браузере.'
            );
        }
    };
    return (
        <main className="max-w-6xl mx-auto p-6 space-y-5">
            <h1 className="text-2xl font-semibold">История и поиск</h1>
            <p className="text-sm text-gray-500">
                Задачи, заметки и обсуждения, включая завершённые. Поиск по
                любому слову; фразы можно заключать в кавычки. Дата записи не
                обязательно совпадает с датой встречи.
            </p>
            <form
                className="flex gap-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    void search();
                }}
            >
                <input
                    aria-label="Поиск по истории"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Витамин Сахалин"
                    className="flex-1 rounded border p-3 bg-transparent"
                />
                <button
                    disabled={busy || !query.trim()}
                    className="rounded bg-blue-600 text-white px-5 disabled:opacity-50"
                >
                    {busy ? 'Ищу…' : 'Найти'}
                </button>
            </form>
            <div className="flex flex-wrap gap-3 items-center">
                <button
                    className="underline disabled:opacity-50"
                    disabled={busy || !query.trim()}
                    onClick={() => void ask()}
                >
                    Спросить ИИ по источникам
                </button>
                <span className="text-xs text-gray-500">
                    Отобранные фрагменты передаются настроенной модели.
                    Автоматических запросов нет.
                </span>
            </div>
            {answer && (
                <section
                    className="rounded border p-4 space-y-3"
                    aria-label="Ответ по источникам"
                >
                    <ReactMarkdown>
                        {answer.answer ||
                            'Источники найдены, модель готовит ответ…'}
                    </ReactMarkdown>
                    <p className="text-xs text-gray-500">
                        Поиск: {answer.search_ms} мс · Первый текст:{' '}
                        {answer.first_token_ms ?? '—'} мс · Полный ответ:{' '}
                        {answer.total_ms || 'формируется'} мс. Проверьте выводы
                        по ссылкам.
                    </p>
                </section>
            )}
            {error && (
                <p role="alert" className="text-red-600">
                    {error}
                </p>
            )}
            {conflicts.length > 0 && (
                <section className="rounded border border-amber-500 p-4 space-y-2">
                    <h2 className="font-semibold">Черновики конфликтов</h2>
                    <p className="text-sm">
                        Ваши несохранённые версии хранятся в этом браузере.
                        Сохраните копию и сравните с текущей заметкой.
                    </p>
                    {conflicts.map(([key, note]) => (
                        <div
                            key={key}
                            className="flex flex-wrap gap-3 items-center"
                        >
                            <Link
                                className="underline"
                                to={`/notes/${note.uid}`}
                            >
                                {note.title}
                            </Link>
                            <button
                                className="underline"
                                onClick={() => void recover(key, note)}
                            >
                                Сохранить отдельной заметкой
                            </button>
                            <button
                                className="underline"
                                onClick={() => {
                                    const url = URL.createObjectURL(
                                        new Blob([note.content], {
                                            type: 'text/plain;charset=utf-8',
                                        })
                                    );
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = 'note-draft.txt';
                                    a.click();
                                    URL.revokeObjectURL(url);
                                }}
                            >
                                Скачать текст
                            </button>
                        </div>
                    ))}
                </section>
            )}
            {result && (
                <p className="text-sm">
                    Найдено: {result.total}. Поиск на сервере:{' '}
                    {result.elapsed_ms} мс.
                </p>
            )}
            <div className="grid lg:grid-cols-2 gap-5 items-start">
                <section className="space-y-3" aria-label="Результаты поиска">
                    {result?.results.map((item) => (
                        <article
                            key={`${item.type}:${item.uid}`}
                            className="border rounded p-4 space-y-2"
                        >
                            <p className="text-xs text-gray-500">
                                {label(item.type)} · {item.author?.name} ·{' '}
                                {new Date(item.created_at).toLocaleString('ru')}
                            </p>
                            <button
                                className="font-semibold text-left underline"
                                onClick={() => void open(item)}
                            >
                                {item.title || 'Без названия'}
                            </button>
                            {item.excerpts?.map((part) => (
                                <blockquote
                                    className="text-sm whitespace-pre-wrap border-l-2 pl-3"
                                    key={part.line}
                                >
                                    <span className="text-gray-500">
                                        Строка {part.line}:{' '}
                                    </span>
                                    {part.text}
                                </blockquote>
                            ))}
                            <Link to={item.href} className="text-sm underline">
                                Открыть карточку
                            </Link>
                        </article>
                    ))}
                    {result?.total === 0 && (
                        <p>
                            Совпадений нет. Попробуйте название объекта или
                            другую формулировку.
                        </p>
                    )}
                    {result && (
                        <div className="flex gap-4">
                            <button
                                disabled={result.offset === 0 || busy}
                                onClick={() =>
                                    void search(Math.max(0, result.offset - 30))
                                }
                            >
                                ← Назад
                            </button>
                            <button
                                disabled={!result.has_more || busy}
                                onClick={() => void search(result.offset + 30)}
                            >
                                Дальше →
                            </button>
                        </div>
                    )}
                </section>
                {source && (
                    <section
                        className="border rounded p-4 space-y-3"
                        aria-label="Полный источник"
                    >
                        <h2 className="font-semibold">{source.title}</h2>
                        <Link to={source.href} className="underline">
                            Открыть оригинал
                        </Link>
                        <pre className="whitespace-pre-wrap break-words font-sans text-sm max-h-[65vh] overflow-auto">
                            {source.text}
                        </pre>
                        <h3 className="font-semibold">Связанные источники</h3>
                        {source.related?.map((item) => (
                            <button
                                key={`${item.type}:${item.uid}`}
                                className="block underline text-left"
                                onClick={() => void open(item)}
                            >
                                {label(item.type)}: {item.title}
                            </button>
                        ))}
                    </section>
                )}
            </div>
        </main>
    );
}
