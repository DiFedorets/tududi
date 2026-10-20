'use strict';
const { Op } = require('sequelize');
const { Task, Note, Comment, User, TaskRelation } = require('../../models');
const permissions = require('../../services/permissionsService');
const { ValidationError, NotFoundError } = require('../../shared/errors');

const normalize = (value) =>
    String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase('ru')
        .replace(/ё/g, 'е');
function terms(query) {
    if (typeof query !== 'string' || !query.trim() || query.length > 500)
        throw new ValidationError('Query must contain 1–500 characters');
    return [
        ...new Set(
            (query.match(/"[^"]+"|[\p{L}\p{N}#_-]+/gu) || [])
                .map((term) => normalize(term.replace(/^"|"$/g, '')))
                .filter(
                    (term) =>
                        term.length > 1 &&
                        ![
                            'мы',
                            'это',
                            'как',
                            'где',
                            'когда',
                            'что',
                            'чем',
                            'ли',
                            'на',
                            'по',
                            'от',
                            'за',
                            'об',
                            'со',
                            'же',
                            'нас',
                            'уже',
                            'каких',
                            'каких-то',
                        ].includes(term)
                )
        ),
    ];
}
const href = (type, uid, taskUid) =>
    type === 'comment'
        ? `/task/${taskUid}`
        : type === 'task'
          ? `/task/${uid}`
          : `/notes/${uid}`;
const timestamps = (row) => ({
    created_at: row.created_at,
    updated_at: row.updated_at,
});
async function corpus(userId) {
    const [tasks, notes] = await Promise.all([
        permissions
            .ownershipOrPermissionWhere('task', userId)
            .then((where) => Task.findAll({ where })),
        permissions
            .ownershipOrPermissionWhere('note', userId)
            .then((where) => Note.findAll({ where })),
    ]);
    const ids = tasks.map((task) => task.id);
    const comments = ids.length
        ? await Comment.findAll({
              where: { task_id: { [Op.in]: ids }, deleted_at: null },
          })
        : [];
    const authors = await User.findAll({
        where: {
            id: {
                [Op.in]: [
                    ...new Set(
                        [...tasks, ...notes, ...comments].map(
                            (row) => row.user_id
                        )
                    ),
                ],
            },
        },
        attributes: ['id', 'uid', 'name', 'surname'],
    });
    const authorById = new Map(
        authors.map((row) => [
            row.id,
            {
                uid: row.uid,
                name:
                    [row.name, row.surname].filter(Boolean).join(' ') ||
                    'Без имени',
            },
        ])
    );
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    return [
        ...tasks.map((task) => ({
            type: 'task',
            uid: task.uid,
            title: task.name,
            text: task.note || '',
            href: href('task', task.uid),
            status: task.status,
            author: authorById.get(task.user_id),
            ...timestamps(task),
        })),
        ...notes.map((note) => ({
            type: 'note',
            uid: note.uid,
            title: note.title || '',
            text: note.content || '',
            href: href('note', note.uid),
            author: authorById.get(note.user_id),
            ...timestamps(note),
        })),
        ...comments.map((comment) => ({
            type: 'comment',
            uid: comment.uid,
            task_uid: taskById.get(comment.task_id).uid,
            title: taskById.get(comment.task_id).name,
            text: comment.body,
            href: href(
                'comment',
                comment.uid,
                taskById.get(comment.task_id).uid
            ),
            author: comment.one_role
                ? {
                      ...(comment.source_author ||
                          authorById.get(comment.user_id)),
                      role: comment.one_role,
                  }
                : comment.source_author || authorById.get(comment.user_id),
            ...timestamps(comment),
        })),
    ];
}
function excerpt(text, needles) {
    const lines = text.split(/\r?\n/);
    const matching = lines
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) =>
            needles.some((term) => normalize(line).includes(term))
        );
    return matching.slice(0, 5).map(({ line, number }) => {
        const at = Math.max(
            0,
            normalize(line).indexOf(
                needles.find((term) => normalize(line).includes(term)) || ''
            ) - 120
        );
        return {
            line: number,
            text: line.slice(at, at + 700),
            timecodes: line.match(/\b\d{1,3}:\d{2}(?::\d{2})?\b/g) || [],
        };
    });
}
async function search(userId, params) {
    const start = performance.now();
    const needles = terms(params.query);
    if (!needles.length)
        throw new ValidationError('Query contains no searchable terms');
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 30));
    const offset = Math.max(0, Number(params.offset) || 0);
    if (!Number.isInteger(limit) || !Number.isInteger(offset))
        throw new ValidationError('limit and offset must be integers');
    const rows = await corpus(userId);
    const matches = rows
        .map((row) => {
            const title = row.type === 'comment' ? '' : normalize(row.title),
                text = normalize(row.text);
            const matched = needles.filter(
                (term) => title.includes(term) || text.includes(term)
            );
            return {
                row,
                matched,
                score:
                    matched.length * 10 +
                    needles.filter((term) => title.includes(term)).length * 3,
            };
        })
        .filter(({ matched }) => matched.length)
        .sort(
            (a, b) =>
                b.score - a.score ||
                new Date(b.row.updated_at) - new Date(a.row.updated_at) ||
                a.row.uid.localeCompare(b.row.uid)
        );
    return {
        query: params.query,
        mode: 'any-term',
        terms: needles,
        total: matches.length,
        offset,
        has_more: offset + limit < matches.length,
        results: matches
            .slice(offset, offset + limit)
            .map(({ row, matched, score }) => {
                const { text, ...metadata } = row;
                return {
                    ...metadata,
                    matched_terms: matched,
                    score,
                    excerpts: excerpt(text, needles),
                    preview: text.slice(0, 240),
                };
            }),
        elapsed_ms: Math.round((performance.now() - start) * 10) / 10,
    };
}
async function source(userId, type, uid) {
    const rows = await corpus(userId);
    const row = rows.find((item) => item.type === type && item.uid === uid);
    if (!row) throw new NotFoundError('Source not found');
    const taskUid = type === 'task' ? uid : row.task_uid;
    const related = new Set();
    if (taskUid) {
        const task = await Task.findOne({ where: { uid: taskUid } });
        const relations = await TaskRelation.findAll({
            where: {
                [Op.or]: [
                    { source_task_id: task.id },
                    { target_task_id: task.id },
                ],
            },
        });
        const ids = [
            ...new Set(
                relations.flatMap((relation) => [
                    relation.source_task_id,
                    relation.target_task_id,
                ])
            ),
        ];
        if (ids.length)
            for (const linked of await Task.findAll({
                where: { id: ids },
                attributes: ['uid'],
            }))
                related.add(linked.uid);
        related.add(taskUid);
    }
    // Metadata is emitted only for sources still visible to the current reader.
    const links = rows
        .filter(
            (item) =>
                !(item.type === type && item.uid === uid) &&
                ((item.type === 'task' && related.has(item.uid)) ||
                    (item.type === 'comment' && item.task_uid === taskUid) ||
                    row.text.includes(item.href) ||
                    item.text.includes(row.href))
        )
        .map(({ text, ...metadata }) => metadata);
    return { ...row, related: links };
}
module.exports = { search, source, normalize, terms };
