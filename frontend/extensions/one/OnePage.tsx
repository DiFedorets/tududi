import { useTaskRefresh } from '../../utils/taskRefresh';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createComment } from '../../utils/commentsService';
import PlanningControl from './PlanningControl';
import SyncStatus from './SyncStatus';
import {
    Overview,
    PlannedTask,
    Debt,
    oneApi,
    changed,
    shift,
    monday,
} from './client';
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
    const [tab, setTab] = useState('answers'),
        [week, setWeek] = useState(''),
        [filter, setFilter] = useState(''),
        [selected, setSelected] = useState<string | null>(null),
        [showClosed, setShowClosed] = useState(false);
    const load = async () => {
        try {
            const next = await oneApi<Overview>();
            setData(next);
            setWeek((w) => w || next.week);
            setError('');
        } catch (err) {
            setError((err as Error).message);
        }
    };
    useEffect(() => {
        void load();
    }, []);
    useTaskRefresh(() => load());
    const addToWeek = async (task: PlannedTask) => {
        setBusy(true);
        setError('');
        try {
            await oneApi(`/tasks/${task.uid}/plan`, 'PUT', {
                expected_revision: task.plan.revision,
                week,
                planned: null,
            });
            await load();
            changed();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    };
    const row = (task: PlannedTask) => (
        <article
            key={task.uid}
            className="rounded border p-3 space-y-2 bg-white dark:bg-gray-900"
        >
            <Link
                className="text-sm font-medium underline"
                to={`/task/${task.uid}`}
            >
                {task.name}
            </Link>
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                {task.plan.moves > 0 && (
                    <span>↪ Переносов: {task.plan.moves}</span>
                )}
                {task.due_date && (
                    <span>
                        Дедлайн:{' '}
                        {new Date(task.due_date).toLocaleDateString('ru')}
                    </span>
                )}
                {[2, 3, 5].includes(task.status) && (
                    <span>Завершена / архив</span>
                )}
                {tab === 'unplanned' && ![2, 3, 5].includes(task.status) && (
                    <button
                        disabled={busy}
                        className="rounded bg-blue-50 dark:bg-blue-900/30 px-2 py-1 text-blue-700 dark:text-blue-300 disabled:opacity-50"
                        onClick={() => void addToWeek(task)}
                    >
                        На неделю с {week}
                    </button>
                )}
                <button
                    className="underline text-blue-600"
                    onClick={() =>
                        setSelected(selected === task.uid ? null : task.uid)
                    }
                >
                    Изменить план
                </button>
            </div>
            {selected === task.uid && data && (
                <PlanningControl
                    plan={task.plan}
                    today={data.today}
                    onSaved={() => {
                        setSelected(null);
                        void load();
                    }}
                    onCancel={() => setSelected(null)}
                />
            )}
        </article>
    );
    const tasks = (data?.tasks || []).filter(
        (t) =>
            (showClosed || ![2, 3, 5].includes(t.status)) &&
            t.name
                .toLocaleLowerCase('ru')
                .includes(filter.toLocaleLowerCase('ru'))
    );
    return (
        <main className="max-w-6xl mx-auto p-5 space-y-5">
            <div className="flex flex-wrap gap-3 justify-between items-center">
                <h1 className="text-2xl font-semibold">Ответы и план</h1>
                <button
                    className="text-sm underline"
                    onClick={() => void load()}
                >
                    Обновить
                </button>
            </div>
            <p className="text-sm text-gray-500">
                Обсуждения живут в задачах. День и неделя — выбор времени
                работы, дедлайн остаётся отдельным.
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
                    <nav
                        className="flex flex-wrap gap-2"
                        aria-label="Разделы One"
                    >
                        {[
                            [
                                'answers',
                                `Ответы · ${data.human_owes.length + data.agent_owes.length}`,
                            ],
                            ['week', 'План недели'],
                            ['unplanned', 'Выбрать дела'],
                        ].map(([id, title]) => (
                            <button
                                key={id}
                                aria-pressed={tab === id}
                                onClick={() => setTab(id)}
                                className={`rounded px-4 py-2 ${tab === id ? 'bg-blue-600 text-white' : 'border'}`}
                            >
                                {title}
                            </button>
                        ))}
                    </nav>
                    {tab === 'answers' ? (
                        <div className="grid gap-5 lg:grid-cols-2">
                            <section
                                className="space-y-3"
                                aria-label="Мне нужно ответить"
                            >
                                <h2 className="font-semibold">
                                    Мне нужно ответить ·{' '}
                                    {data.human_owes.length}
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
                                    Агент должен ответить ·{' '}
                                    {data.agent_owes.length}
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
                                                {item.count} без ответа ·
                                                закрытие заблокировано
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
                                    задачах и поиске, но автоматически не
                                    считаются долгами.
                                </p>
                            )}
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-center gap-3">
                                <input
                                    aria-label="Фильтр списка задач"
                                    placeholder="Фильтр списка задач"
                                    className="rounded border p-2 bg-transparent"
                                    value={filter}
                                    onChange={(e) => setFilter(e.target.value)}
                                />
                                <label className="text-sm">
                                    <input
                                        type="checkbox"
                                        checked={showClosed}
                                        onChange={(e) =>
                                            setShowClosed(e.target.checked)
                                        }
                                    />{' '}
                                    Показывать завершённые
                                </label>
                            </div>
                            {tab === 'week' ? (
                                <>
                                    <div className="flex flex-wrap gap-3 items-center">
                                        <button
                                            aria-label="Предыдущая неделя"
                                            onClick={() =>
                                                setWeek(shift(week, -7))
                                            }
                                        >
                                            ←
                                        </button>
                                        <label className="text-sm">
                                            Неделя с{' '}
                                            <input
                                                aria-label="Неделя плана"
                                                type="date"
                                                onInput={(e) => {
                                                    if (e.currentTarget.value)
                                                        setWeek(
                                                            monday(
                                                                e.currentTarget
                                                                    .value
                                                            )
                                                        );
                                                }}
                                                className="rounded border p-2 bg-transparent"
                                                value={week}
                                                onChange={(e) => {
                                                    if (e.target.value)
                                                        setWeek(
                                                            monday(
                                                                e.target.value
                                                            )
                                                        );
                                                }}
                                            />
                                        </label>
                                        <button
                                            aria-label="Следующая неделя"
                                            onClick={() =>
                                                setWeek(shift(week, 7))
                                            }
                                        >
                                            →
                                        </button>
                                        <span className="text-xs text-gray-500">
                                            {data.timezone}
                                        </span>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                        {[
                                            {
                                                day: null,
                                                title: 'На неделе, без дня',
                                            },
                                            ...[
                                                'Пн',
                                                'Вт',
                                                'Ср',
                                                'Чт',
                                                'Пт',
                                                'Сб',
                                                'Вс',
                                            ].map((name, i) => ({
                                                day: shift(week, i),
                                                title: `${name} · ${shift(week, i)}`,
                                            })),
                                        ].map(({ day, title }) => {
                                            const group = tasks.filter((t) =>
                                                day
                                                    ? t.plan.planned === day
                                                    : t.plan.week === week
                                            );
                                            return (
                                                <section
                                                    key={title}
                                                    className="rounded-lg border bg-gray-50 dark:bg-gray-900/40 p-3 space-y-3"
                                                >
                                                    <h2 className="font-semibold text-sm">
                                                        {title} · {group.length}
                                                    </h2>
                                                    {group.length ? (
                                                        group.map(row)
                                                    ) : (
                                                        <p className="text-xs text-gray-400">
                                                            Пока пусто
                                                        </p>
                                                    )}
                                                </section>
                                            );
                                        })}
                                    </div>
                                    {tasks.some(
                                        (t) =>
                                            t.plan.planned &&
                                            t.plan.planned < data.today &&
                                            (t.plan.planned < week ||
                                                t.plan.planned > shift(week, 6))
                                    ) && (
                                        <section className="space-y-3">
                                            <h2 className="font-semibold">
                                                Незавершённое из прошлых дней
                                            </h2>
                                            <p className="text-sm text-gray-500">
                                                Не переносится автоматически.
                                                Выбери новый день или верни дело
                                                в неделю.
                                            </p>
                                            {tasks
                                                .filter(
                                                    (t) =>
                                                        t.plan.planned &&
                                                        t.plan.planned <
                                                            data.today &&
                                                        (t.plan.planned <
                                                            week ||
                                                            t.plan.planned >
                                                                shift(week, 6))
                                                )
                                                .map(row)}
                                        </section>
                                    )}
                                </>
                            ) : (
                                <section className="space-y-3">
                                    <h2 className="font-semibold">
                                        Дела без выбранного дня или недели
                                    </h2>
                                    <label className="block text-sm">
                                        Выбираем дела на неделю с{' '}
                                        <input
                                            aria-label="Неделя для выбора дел"
                                            type="date"
                                            onInput={(e) => {
                                                if (e.currentTarget.value)
                                                    setWeek(
                                                        monday(
                                                            e.currentTarget
                                                                .value
                                                        )
                                                    );
                                            }}
                                            value={week}
                                            onChange={(e) => {
                                                if (e.target.value)
                                                    setWeek(
                                                        monday(e.target.value)
                                                    );
                                            }}
                                            className="rounded border p-2 bg-transparent"
                                        />
                                    </label>
                                    <p className="text-sm text-gray-500">
                                        Это существующие задачи, новые копии не
                                        создаются.
                                    </p>
                                    {tasks
                                        .filter(
                                            (t) =>
                                                !t.plan.planned && !t.plan.week
                                        )
                                        .map(row)}
                                </section>
                            )}
                        </>
                    )}
                </>
            )}
        </main>
    );
}
