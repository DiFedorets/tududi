import React, { useEffect, useState } from 'react';
import { Note } from '../../entities/Note';
import { noteKindLabels } from '../../utils/noteRecords';
export const NoteKindSelect = ({
    value = 'knowledge',
    onChange,
    compact = false,
}: {
    value?: Note['record_kind'];
    compact?: boolean;
    onChange: (kind: NonNullable<Note['record_kind']>) => void;
}) => (
    <label className="inline-flex items-center gap-2 text-sm">
        <span className={compact ? 'sr-only' : ''}>Вид заметки</span>
        <select
            aria-label="Вид заметки"
            value={value}
            onChange={(e) =>
                onChange(e.target.value as NonNullable<Note['record_kind']>)
            }
            className={
                compact
                    ? 'max-w-[120px] cursor-pointer border-0 bg-transparent py-0 text-xs text-gray-500 dark:text-gray-400'
                    : 'rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1'
            }
        >
            {Object.entries(noteKindLabels).map(([key, label]) => (
                <option key={key} value={key}>
                    {label}
                </option>
            ))}
        </select>
    </label>
);
export default function NoteRecordFields({
    note,
    onChange,
    saved = true,
    canFinish = true,
}: {
    note: Note;
    onChange: (updates: Partial<Note>) => void;
    saved?: boolean;
    canFinish?: boolean;
}) {
    const kind = note.record_kind || 'knowledge';
    const special = kind !== 'knowledge';
    const ready = note.record_state === 'ready';
    const [confirmed, setConfirmed] = useState(false);
    useEffect(
        () => setConfirmed(false),
        [
            note.uid,
            note.title,
            note.content,
            note.record_kind,
            note.application_ref,
            note.record_state,
        ]
    );
    const valid =
        !!note.title?.trim() &&
        !!note.content?.trim() &&
        (!special || (!!note.application_ref?.trim() && confirmed));
    return (
        <div
            aria-label="Вид и готовность заметки"
            className="inline-flex items-center gap-2 text-xs"
        >
            <NoteKindSelect
                compact
                value={kind}
                onChange={(record_kind) =>
                    onChange({ record_kind, record_state: 'draft' })
                }
            />
            {special && (
                <details className="relative">
                    <summary className="cursor-pointer text-gray-500">
                        Применение
                    </summary>
                    <div className="absolute z-50 top-full mt-2 left-0 w-80 max-w-[80vw] max-h-[60vh] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 shadow-lg space-y-2 text-sm">
                        <span role="status">
                            {ready ? 'Применяется' : 'Черновик'}
                        </span>
                        {special && (
                            <>
                                <label className="block">
                                    {kind === 'lesson'
                                        ? 'Куда записано в память'
                                        : 'Где записано правило'}
                                    <input
                                        aria-label="Адрес применения"
                                        value={note.application_ref || ''}
                                        maxLength={2000}
                                        onChange={(e) =>
                                            onChange({
                                                application_ref: e.target.value,
                                            })
                                        }
                                        placeholder={
                                            kind === 'lesson'
                                                ? 'Файл памяти и идентификатор записи'
                                                : 'Файл правил и раздел'
                                        }
                                        className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-transparent p-2"
                                    />
                                </label>
                                <p className="text-xs text-gray-500">
                                    {kind === 'lesson'
                                        ? 'Готово, когда вывод уже записан в память.'
                                        : 'Готово, когда принятое правило уже записано в инструкции.'}{' '}
                                    Указание адреса не выполняет перенос
                                    автоматически. Изменение текста возвращает
                                    запись в черновик.
                                </p>
                            </>
                        )}
                        {!ready && canFinish && (
                            <>
                                {special && (
                                    <label className="flex gap-2 items-start">
                                        <input
                                            type="checkbox"
                                            checked={confirmed}
                                            onChange={(e) =>
                                                setConfirmed(e.target.checked)
                                            }
                                        />
                                        {kind === 'lesson'
                                            ? 'Подтверждаю: урок записан в память по указанному адресу'
                                            : 'Подтверждаю: решение записано в правила по указанному адресу'}
                                    </label>
                                )}
                                <button
                                    type="button"
                                    disabled={!valid || !saved}
                                    onClick={() =>
                                        onChange({ record_state: 'ready' })
                                    }
                                    className="rounded bg-blue-600 text-white px-3 py-1.5 disabled:opacity-40"
                                >
                                    {special
                                        ? 'Подтвердить применение'
                                        : 'Отметить готовым'}
                                </button>
                                {!saved && (
                                    <span className="ml-2 text-xs text-gray-500">
                                        Сначала дождитесь сохранения изменений.
                                    </span>
                                )}
                            </>
                        )}
                        {ready && (
                            <button
                                type="button"
                                onClick={() =>
                                    onChange({ record_state: 'draft' })
                                }
                                className="underline text-xs"
                            >
                                Вернуть в черновик
                            </button>
                        )}
                    </div>
                </details>
            )}
        </div>
    );
}
