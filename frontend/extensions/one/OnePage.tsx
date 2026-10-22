import { useTaskRefresh } from '../../utils/taskRefresh';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createComment } from '../../utils/commentsService';
import SyncStatus from './SyncStatus';
import { Overview, Debt, oneApi, changed } from './client';
function Question({
    item,
    onAnswered,
}: {
    item: Debt;
    onAnswered: () => void;
}) {
    const [text, setText] = useState(''),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false);
    const send = async () => {
        setBusy(true);
        setError('');
        try {
            await createComment(item.task_uid, {
                body: text,
                mentionedPersonUids: [],
            });
            setText('');
            changed();
            onAnswered();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <article className="rounded-lg border border-blue-200 dark:border-blue-800 p-4 space-y-3">
            <Link
                className="font-medium underline"
                to={`/task/${item.task_uid}?tab=comments`}
            >
                {item.name}
            </Link>
            {[2, 3, 5].includes(item.status) && (
                <p className="text-xs text-amber-700">
                    Задача закрыта, вопрос остаётся в очереди.
                </p>
            )}
            <blockquote className="border-l-2 pl-3 whitespace-pre-wrap text-sm">
                {item.comment?.body}
            </blockquote>
            <label className="block text-sm">
                Твой ответ
                <textarea
                    aria-label={`Ответ: ${item.name}`}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded border p-2 bg-transparent"
                />
            </label>
            <p className="text-xs text-gray-500">
                Ответ добавится в обсуждение этой же задачи.
            </p>
            {error && (
                <p role="alert" className="text-red-600">
                    {error}
                </p>
            )}
            <button
                disabled={busy || !text.trim()}
                onClick={() => void send()}
                className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
                Отправить ответ
            </button>
        </article>
    );
}
export default function OnePage() {
    const [data, setData] = useState<Overview | null>(null),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false);
    const load = async () => {
        try {
            const next = await oneApi<Overview>();
            setData(next);
            setError('');
        } catch (err) {
            setError((err as Error).message);
        }
    };
    useEffect(() => {
        void load();
    }, []);
    useTaskRefresh(() => load());
    return (
        <main className="max-w-6xl mx-auto p-5 space-y-5">
            <div className="flex flex-wrap gap-3 justify-between items-center">
                <h1 className="text-2xl font-semibold">Ответы</h1>
                <button
                    className="text-sm underline"
                    onClick={() => void load()}
                >
                    Обновить
                </button>
            </div>
            <p className="text-sm text-gray-500">
                Обсуждения живут в задачах. Планирование — в разделах «Сегодня»
                и «Предстоящие».
            </p>
            {error && (
                <p
                    role="alert"
                    className="rounded border border-red-400 p-3 text-red-600"
                >
                    {error}
                </p>
            )}
            <SyncStatus />
            {!data && !error && <p>Загрузка…</p>}
            {data && !data.enabled && (
                <section className="rounded border p-4 space-y-3">
                    <p>
                        Правила One ещё не включены для этой учётки. В архиве
                        будут распознаны только явно подписанные роли.
                    </p>
                    <button
                        disabled={busy}
                        className="rounded bg-blue-600 p-2 text-white"
                        onClick={async () => {
                            setBusy(true);
                            try {
                                await oneApi('/enable', 'POST', {});
                                await load();
                                changed();
                            } catch (err) {
                                setError((err as Error).message);
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        Включить правила One
                    </button>
                </section>
            )}
            {data?.enabled && (
                <>
                    <div className="grid gap-5 lg:grid-cols-2">
                        <section
                            className="space-y-3"
                            aria-label="Мне нужно ответить"
                        >
                            <h2 className="font-semibold">
                                Мне нужно ответить · {data.human_owes.length}
                            </h2>
                            {data.human_owes.length ? (
                                data.human_owes.map((item) => (
                                    <Question
                                        key={item.task_uid}
                                        item={item}
                                        onAnswered={() => void load()}
                                    />
                                ))
                            ) : (
                                <p className="text-gray-500 text-sm">
                                    Нет ожидающих вопросов агента.
                                </p>
                            )}
                        </section>
                        <section
                            className="space-y-3"
                            aria-label="Агент должен ответить"
                        >
                            <h2 className="font-semibold">
                                Агент должен ответить · {data.agent_owes.length}
                            </h2>
                            {data.agent_owes.length ? (
                                data.agent_owes.map((item) => (
                                    <article
                                        key={item.task_uid}
                                        className="rounded-lg border border-amber-300 dark:border-amber-700 p-4 space-y-2"
                                    >
                                        <Link
                                            className="font-medium underline"
                                            to={`/task/${item.task_uid}?tab=comments`}
                                        >
                                            {item.name}
                                        </Link>
                                        <p className="text-xs text-amber-700">
                                            {item.count} без ответа · закрытие
                                            заблокировано
                                            {[2, 3, 5].includes(item.status)
                                                ? ' · задача уже закрыта'
                                                : ''}
                                        </p>
                                        {item.comments?.map((c) => (
                                            <blockquote
                                                className="border-l-2 pl-3 whitespace-pre-wrap text-sm"
                                                key={c.uid}
                                            >
                                                {c.body}
                                            </blockquote>
                                        ))}
                                    </article>
                                ))
                            ) : (
                                <p className="text-gray-500 text-sm">
                                    Нет комментариев, ожидающих агента.
                                </p>
                            )}
                        </section>
                        {data.unclassified_comments > 0 && (
                            <p className="text-xs text-gray-500 lg:col-span-2">
                                Архивных сообщений без достоверной роли:{' '}
                                {data.unclassified_comments}. Они доступны в
                                задачах и поиске, но автоматически не считаются
                                долгами.
                            </p>
                        )}
                    </div>
                </>
            )}
        </main>
    );
}
