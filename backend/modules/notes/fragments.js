const { createHash } = require('crypto');
const { ValidationError } = require('../../shared/errors');
const { Transaction } = require('sequelize');
const { Note, NoteFragment, sequelize } = require('../../models');
const permissions = require('../../services/permissionsService');
const canonical = (text) => (text || '').replace(/\r\n?/g, '\n');
const hash = (text) =>
    createHash('sha256')
        .update(text || '')
        .digest('hex');
class FragmentError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
async function access(userId, uid, write = false) {
    const level = await permissions.getAccess(userId, 'note', uid);
    if (level === 'none' || (write && !['rw', 'admin'].includes(level)))
        throw new FragmentError(404, 'Заметка не найдена');
}
function discussionDate(value) {
    if (value === null || value === '') return null;
    if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number(value.slice(0, 4)) < 1
    )
        throw new ValidationError('Некорректная дата обсуждения');
    const d = new Date(value + 'T00:00:00.000Z');
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value)
        throw new ValidationError('Некорректная дата обсуждения');
    return value;
}
async function create(userId, uid, body) {
    await access(userId, uid, true);
    const { from, to, expected_revision, expected_content } = body || {};
    if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        to <= from ||
        to - from > 4000 ||
        !Number.isInteger(expected_revision) ||
        typeof expected_content !== 'string'
    )
        throw new FragmentError(
            400,
            'Выделите фрагмент длиной до 4000 символов'
        );
    return sequelize.transaction(
        {
            type:
                sequelize.getDialect() === 'sqlite'
                    ? Transaction.TYPES.IMMEDIATE
                    : undefined,
        },
        async (transaction) => {
            const note = await Note.findOne({
                where: { uid },
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!note) throw new FragmentError(404, 'Заметка не найдена');
            const content = canonical(note.content);
            if (
                note.revision !== expected_revision ||
                content !== canonical(expected_content)
            )
                throw new FragmentError(
                    409,
                    'Заметка изменилась или ещё не сохранена. Дождитесь сохранения и повторите.'
                );
            if (to > content.length || !content.slice(from, to).trim())
                throw new FragmentError(
                    400,
                    'Выделите непустой фрагмент текста'
                );
            const [fragment] = await NoteFragment.findOrCreate({
                where: {
                    note_id: note.id,
                    created_revision: note.revision,
                    original_from: from,
                    original_to: to,
                },
                defaults: {
                    quote: content.slice(from, to),
                    prefix: content.slice(Math.max(0, from - 64), from),
                    suffix: content.slice(to, to + 64),
                    start_offset: from,
                    end_offset: to,
                    state: 'located',
                    content_hash: hash(content),
                },
                transaction,
            });
            return {
                uid: fragment.uid,
                href: `/notes/${note.uid}?fragment=${fragment.uid}`,
            };
        }
    );
}
async function get(userId, uid, fragmentUid) {
    await access(userId, uid);
    const note = await Note.findOne({ where: { uid } });
    if (!note) throw new FragmentError(404, 'Заметка не найдена');
    const f = await NoteFragment.findOne({
        where: { uid: fragmentUid, note_id: note.id },
    });
    if (!f) throw new FragmentError(404, 'Фрагмент не найден');
    const content = canonical(note.content),
        located =
            f.state === 'located' &&
            f.content_hash === hash(content) &&
            content.slice(f.start_offset, f.end_offset) === f.quote;
    return {
        uid: f.uid,
        quote: f.quote,
        state: located ? 'located' : 'changed',
        from: located ? f.start_offset : null,
        to: located ? f.end_offset : null,
        note_revision: note.revision,
    };
}
// Conservative range mapping: only edits wholly outside a quote keep its anchor.
// An overlapping or bypassed edit never silently retargets another occurrence.
async function track(noteId, before, after, transaction) {
    before = canonical(before);
    after = canonical(after);
    if (before === after) return;
    let prefix = 0;
    while (
        prefix < before.length &&
        prefix < after.length &&
        before[prefix] === after[prefix]
    )
        prefix++;
    let suffix = 0;
    while (
        suffix < before.length - prefix &&
        suffix < after.length - prefix &&
        before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    )
        suffix++;
    const end = before.length - suffix,
        delta = after.length - before.length,
        oldHash = hash(before),
        newHash = hash(after);
    const fragments = await NoteFragment.findAll({
        where: { note_id: noteId },
        transaction,
    });
    for (const f of fragments) {
        let state = f.state,
            from = f.start_offset,
            to = f.end_offset;
        if (state === 'located') {
            if (f.content_hash !== oldHash) state = 'changed';
            else if (end <= from) {
                from += delta;
                to += delta;
            } else if (to > prefix) state = 'changed';
            if (state === 'located' && after.slice(from, to) !== f.quote)
                state = 'changed';
        }
        await f.update(
            {
                state,
                start_offset: state === 'located' ? from : null,
                end_offset: state === 'located' ? to : null,
                content_hash: newHash,
            },
            { transaction }
        );
    }
}
module.exports = { create, get, track, discussionDate, FragmentError };
