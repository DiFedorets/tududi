import React, { useEffect, useState } from 'react';
import { Plan, oneApi, changed } from './client';
export default function PlanningControl({
    plan,
    today,
    onSaved,
    onCancel,
}: {
    plan: Plan;
    today: string;
    onSaved: (plan: Plan) => void;
    onCancel?: () => void;
}) {
    const [base, setBase] = useState(plan);
    const [mode, setMode] = useState(
        plan.planned ? 'day' : plan.week ? 'week' : 'none'
    );
    const [date, setDate] = useState(plan.planned || plan.week || today);
    const [dirty, setDirty] = useState(false),
        [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const reset = (p: Plan) => {
        setBase(p);
        setMode(p.planned ? 'day' : p.week ? 'week' : 'none');
        setDate(p.planned || p.week || today);
        setDirty(false);
        setError('');
    };
    useEffect(() => {
        if (!dirty || plan.task_uid !== base.task_uid) reset(plan);
    }, [plan.revision, plan.task_uid]);
    const save = async () => {
        setBusy(true);
        setError('');
        try {
            const saved = await oneApi<Plan>(
                `/tasks/${plan.task_uid}/plan`,
                'PUT',
                {
                    expected_revision: base.revision,
                    planned: mode === 'day' ? date : null,
                    week: mode === 'week' ? date : null,
                }
            );
            reset(saved);
            changed();
            onSaved(saved);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="space-y-3 rounded-lg border border-blue-200 dark:border-blue-800 p-3">
            <div className="flex flex-wrap gap-3">
                <label className="text-sm">
                    Когда делать
                    <select
                        aria-label="Уровень плана"
                        value={mode}
                        onChange={(e) => {
                            setMode(e.target.value);
                            setDirty(true);
                        }}
                        className="block rounded border p-2 bg-white dark:bg-gray-900"
                    >
                        <option value="none">Пока не запланировано</option>
                        <option value="week">На неделе, без дня</option>
                        <option value="day">В конкретный день</option>
                    </select>
                </label>
                {mode !== 'none' && (
                    <label className="text-sm">
                        {mode === 'day' ? 'День' : 'Любой день нужной недели'}
                        <input
                            aria-label="Дата плана"
                            type="date"
                            onInput={(e) => {
                                setDate(e.currentTarget.value);
                                setDirty(true);
                            }}
                            required
                            value={date}
                            onChange={(e) => {
                                setDate(e.target.value);
                                setDirty(true);
                            }}
                            className="block rounded border p-2 bg-white dark:bg-gray-900"
                        />
                    </label>
                )}
            </div>
            <p className="text-xs text-gray-500">
                Это план работы, а не дедлайн. Неделя сохраняется датой
                понедельника. Переносов между днями: {base.moves}.
            </p>
            {dirty && plan.revision !== base.revision && (
                <p className="text-amber-700 text-sm">
                    План изменён в другом месте. Ваш выбор ещё не сохранён.
                </p>
            )}
            {error && (
                <div role="alert" className="text-red-600 text-sm">
                    {error}{' '}
                    <button
                        className="underline"
                        onClick={async () => {
                            try {
                                const data = await oneApi<{ plan: Plan }>(
                                    `/tasks/${plan.task_uid}`
                                );
                                reset(data.plan);
                                onSaved(data.plan);
                            } catch (err) {
                                setError((err as Error).message);
                            }
                        }}
                    >
                        Загрузить текущий план
                    </button>
                </div>
            )}
            <div className="flex gap-3">
                <button
                    disabled={busy || (!date && mode !== 'none')}
                    onClick={() => void save()}
                    className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                    {busy ? 'Сохраняю…' : 'Сохранить план'}
                </button>
                {onCancel && (
                    <button className="text-sm underline" onClick={onCancel}>
                        Отмена
                    </button>
                )}
            </div>
        </div>
    );
}
