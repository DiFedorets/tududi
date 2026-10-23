import React, { useEffect, useRef, useState } from 'react';
import { CalendarDaysIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { formatInTimeZone } from 'date-fns-tz';
import { getUserTimezone } from '../../utils/dateUtils';
export interface UpcomingRange {
    start: string;
    end: string;
}
export const addRangeDays = (key: string, count: number) => {
    const d = new Date(key + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + count);
    return d.toISOString().slice(0, 10);
};
export const rangeToday = () =>
    formatInTimeZone(new Date(), getUserTimezone(), 'yyyy-MM-dd');
export function rangePreset(kind: string, today = rangeToday()): UpcomingRange {
    const weekday = new Date(today + 'T12:00:00Z').getUTCDay();
    const monday = addRangeDays(today, -((weekday + 6) % 7));
    return kind === 'week'
        ? { start: monday, end: addRangeDays(monday, 6) }
        : {
              start:
                  kind === 'yesterday'
                      ? addRangeDays(today, -1)
                      : addRangeDays(monday, -7),
              end: addRangeDays(today, 7),
          };
}
export const validRange = ({ start, end }: UpcomingRange) => {
    const valid = (v: string) =>
        /^\d{4}-\d{2}-\d{2}$/.test(v) &&
        Number(v.slice(0, 4)) > 0 &&
        !isNaN(new Date(v + 'T12:00:00Z').getTime()) &&
        new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
    return (
        valid(start) &&
        valid(end) &&
        start <= end &&
        (Date.parse(end) - Date.parse(start)) / 86400000 <= 34
    );
};
export function rangeFromQuery(query: URLSearchParams): UpcomingRange {
    const today = rangeToday();
    return {
        start: query.get('range_start') || today,
        end: query.get('range_end') || addRangeDays(today, 7),
    };
}
export default function UpcomingRangePicker({
    value,
    onChange,
}: {
    value: UpcomingRange;
    onChange: (range: UpcomingRange) => void;
}) {
    const [open, setOpen] = useState(false),
        [draft, setDraft] = useState(value),
        [error, setError] = useState('');
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        setDraft(value);
        setOpen(false);
        setError('');
    }, [value.start, value.end]);
    useEffect(() => {
        const close = (e: MouseEvent) => {
            if (root.current && !root.current.contains(e.target as Node))
                setOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, []);
    const apply = (range: UpcomingRange) => {
        if (!validRange(range)) {
            setError('Выберите корректный период до 35 дней.');
            return;
        }
        onChange(range);
        setOpen(false);
        setError('');
    };
    const label = (range: UpcomingRange) => {
        const fmt = (day: string, year = false) =>
            new Date(day + 'T12:00:00Z').toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'short',
                ...(year ? { year: 'numeric' as const } : {}),
                timeZone: 'UTC',
            });
        if (range.start.slice(0, 7) === range.end.slice(0, 7))
            return `${Number(range.start.slice(8))}–${fmt(range.end)}`;
        const year = range.start.slice(0, 4) !== range.end.slice(0, 4);
        return `${fmt(range.start, year)} — ${fmt(range.end, year)}`;
    };
    return (
        <div
            ref={root}
            className="relative flex flex-wrap items-center gap-1"
            onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
            }}
        >
            <button
                type="button"
                aria-expanded={open}
                aria-label="Диапазон предстоящих"
                onClick={() => {
                    setDraft(value);
                    setOpen(!open);
                }}
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 px-2 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-gray-800"
            >
                <CalendarDaysIcon className="h-4 w-4" />
                <span>{label(value)}</span>
                <ChevronDownIcon className="h-3 w-3" />
            </button>
            <button
                type="button"
                onClick={() => apply(rangePreset('week'))}
                className="text-sm px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            >
                Эта неделя
            </button>
            {open && (
                <form
                    aria-label="Выбор диапазона"
                    onSubmit={(e) => {
                        e.preventDefault();
                        apply(draft);
                    }}
                    className="absolute z-40 top-full mt-2 left-0 sm:left-auto sm:right-0 w-80 max-w-[calc(100vw-2rem)] p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg"
                >
                    <div className="flex flex-wrap gap-2 mb-3">
                        <button
                            type="button"
                            className="text-sm text-blue-600 dark:text-blue-400"
                            onClick={() => apply(rangePreset('yesterday'))}
                        >
                            Со вчера
                        </button>
                        <button
                            type="button"
                            className="text-sm text-blue-600 dark:text-blue-400"
                            onClick={() => apply(rangePreset('pastweek'))}
                        >
                            С прошлой недели
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs text-gray-600 dark:text-gray-300">
                            С
                            <input
                                type="date"
                                required
                                aria-label="Начало диапазона"
                                value={draft.start}
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        start: e.target.value,
                                    })
                                }
                                className="mt-1 block w-full min-w-0 p-1.5 border rounded bg-transparent"
                            />
                        </label>
                        <label className="text-xs text-gray-600 dark:text-gray-300">
                            По
                            <input
                                type="date"
                                required
                                aria-label="Конец диапазона"
                                value={draft.end}
                                onChange={(e) =>
                                    setDraft({ ...draft, end: e.target.value })
                                }
                                className="mt-1 block w-full min-w-0 p-1.5 border rounded bg-transparent"
                            />
                        </label>
                    </div>
                    {error && (
                        <div role="alert" className="text-sm text-red-600 mt-2">
                            {error}
                        </div>
                    )}
                    <button
                        type="submit"
                        className="mt-3 px-3 py-1.5 rounded bg-blue-600 text-white text-sm"
                    >
                        Показать
                    </button>
                </form>
            )}
        </div>
    );
}
