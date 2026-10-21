'use strict';
const { ValidationError } = require('../../shared/errors');
const fields = ['record_kind', 'record_state', 'application_ref'];
const meaning = ['title', 'content', 'record_kind', 'application_ref'];
function recordChanges(current, input, creating = false) {
    const kind = input.record_kind ?? current?.record_kind ?? 'knowledge';
    const ref =
        input.application_ref === undefined
            ? current?.application_ref || ''
            : (input.application_ref ?? '');
    if (!['knowledge', 'lesson', 'decision'].includes(kind))
        throw new ValidationError('Неизвестный вид заметки.');
    if (typeof ref !== 'string' || ref.length > 2000)
        throw new ValidationError(
            'Адрес применения должен быть строкой до 2000 символов.'
        );
    const value = {
        title: current?.title,
        content: current?.content,
        ...input,
        record_kind: kind,
        application_ref: ref.trim(),
    };
    const hasText =
        typeof value.title === 'string' &&
        value.title.trim() &&
        typeof value.content === 'string' &&
        value.content.trim();
    let state =
        input.record_state ??
        current?.record_state ??
        (kind === 'knowledge' && hasText ? 'ready' : 'draft');
    if (!['draft', 'ready'].includes(state))
        throw new ValidationError('Неизвестное состояние заметки.');
    const changed =
        !creating &&
        meaning.some(
            (k) =>
                (value[k] ?? '') !==
                (current?.[k] ?? (k === 'record_kind' ? 'knowledge' : ''))
        );
    if (kind !== 'knowledge' && changed) {
        // Old clients resend a complete note. A previous ready flag cannot
        // confirm newly edited text. Save it as a draft first.
        if (state === 'ready' && current?.record_state !== 'ready')
            throw new ValidationError(
                'Сначала сохраните изменения, затем подтвердите применение.'
            );
        state = 'draft';
    }
    if (!creating && changed && !hasText) state = 'draft';
    if (state === 'ready') {
        if (!hasText)
            throw new ValidationError(
                'Для готовности нужны название и содержимое заметки.'
            );
        if (kind !== 'knowledge' && !value.application_ref)
            throw new ValidationError(
                kind === 'lesson'
                    ? 'Укажите, куда урок записан в память.'
                    : 'Укажите, куда решение записано в правила.'
            );
        if (creating && kind !== 'knowledge')
            throw new ValidationError(
                'Сначала сохраните черновик, затем подтвердите применение.'
            );
    }
    return {
        record_kind: kind,
        record_state: state,
        application_ref: value.application_ref || null,
        ready_at:
            state === 'ready'
                ? current?.record_state === 'ready' && !changed
                    ? current.ready_at
                    : new Date()
                : null,
    };
}
module.exports = { fields, recordChanges };
