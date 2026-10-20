'use strict';
// Supplemental UID-based history. Restore runs after ALL instance accounts,
// so a guest-owned task can reference the owner's shared project.
const { Op } = require('sequelize');
const { uid: generateUid } = require('../utils/uid');
const {
    Task,
    Project,
    Note,
    User,
    Comment,
    CommentReaction,
    TaskRelation,
    TaskEvent,
    DailyPlan,
    DailyPlanItem,
    sequelize,
} = require('../models');

async function exportHistory(userId) {
    const tasks = await Task.findAll({ where: { user_id: userId } });
    const notes = await Note.findAll({ where: { user_id: userId } });
    const taskIds = tasks.map((row) => row.id);
    const comments = taskIds.length
        ? await Comment.findAll({ where: { task_id: taskIds } })
        : [];
    const relations = taskIds.length
        ? await TaskRelation.findAll({ where: { source_task_id: taskIds } })
        : [];
    const events = taskIds.length
        ? await TaskEvent.findAll({ where: { task_id: taskIds } })
        : [];
    const plans = await DailyPlan.findAll({ where: { user_id: userId } });
    const items = plans.length
        ? await DailyPlanItem.findAll({
              where: { daily_plan_id: plans.map((row) => row.id) },
          })
        : [];
    const reactions = comments.length
        ? await CommentReaction.findAll({
              where: { comment_id: comments.map((row) => row.id) },
          })
        : [];
    const referencedTaskIds = [
        ...new Set([
            ...taskIds,
            ...relations.map((row) => row.target_task_id),
            ...items.map((row) => row.task_id),
        ]),
    ];
    const taskRows = referencedTaskIds.length
        ? await Task.findAll({
              where: { id: referencedTaskIds },
              attributes: ['id', 'uid'],
          })
        : [];
    const projectIds = [
        ...new Set(
            [...tasks, ...notes].map((row) => row.project_id).filter(Boolean)
        ),
    ];
    const projects = projectIds.length
        ? await Project.findAll({
              where: { id: projectIds },
              attributes: ['id', 'uid'],
          })
        : [];
    const userIds = [
        ...new Set([
            userId,
            ...comments.map((row) => row.user_id),
            ...events.map((row) => row.user_id),
            ...reactions.map((row) => row.user_id),
            ...relations.map((row) => row.created_by_user_id).filter(Boolean),
        ]),
    ];
    const users = await User.findAll({
        where: { id: userIds },
        attributes: ['id', 'uid', 'name', 'surname'],
    });
    const map = (rows) => new Map(rows.map((row) => [row.id, row.uid]));
    const t = map(taskRows),
        p = map(projects),
        u = map(users),
        c = map(comments);
    const attrs = (row, excluded) =>
        Object.fromEntries(
            Object.entries(row.toJSON()).filter(
                ([key]) => !excluded.includes(key)
            )
        );
    return {
        format: 1,
        comments: comments.map((row) => ({
            ...attrs(row, ['id', 'task_id', 'user_id', 'parent_comment_id']),
            task_uid: t.get(row.task_id),
            author_uid: u.get(row.user_id),
            original_author:
                row.source_author ||
                (() => {
                    const user = users.find((item) => item.id === row.user_id);
                    return {
                        uid: user.uid,
                        name:
                            [user.name, user.surname]
                                .filter(Boolean)
                                .join(' ') || 'Без имени',
                    };
                })(),
            parent_uid: c.get(row.parent_comment_id) || null,
        })),
        reactions: reactions.map((row) => ({
            comment_uid: c.get(row.comment_id),
            author_uid: u.get(row.user_id),
            reaction_type: row.reaction_type,
        })),
        relations: relations.map((row) => ({
            uid: row.uid,
            source_uid: t.get(row.source_task_id),
            target_uid: t.get(row.target_task_id),
            relation_type: row.relation_type,
            author_uid: u.get(row.created_by_user_id) || null,
        })),
        events: events.map((row) => ({
            ...attrs(row, ['id', 'task_id', 'user_id']),
            source_id: row.id,
            task_uid: t.get(row.task_id),
            author_uid: u.get(row.user_id),
        })),
        plans: plans.map((row) => ({
            ...attrs(row, ['id', 'user_id']),
            items: items
                .filter((item) => item.daily_plan_id === row.id)
                .map((item) => ({
                    task_uid: t.get(item.task_id),
                    position: item.position,
                    start_minute: item.start_minute,
                    duration_minutes: item.duration_minutes,
                })),
        })),
        project_links: [
            ...tasks.map((row) => ({
                type: 'task',
                uid: row.uid,
                project_uid: p.get(row.project_id) || null,
            })),
            ...notes.map((row) => ({
                type: 'note',
                uid: row.uid,
                project_uid: p.get(row.project_id) || null,
            })),
        ],
    };
}

async function restoreHistory(
    userId,
    backup,
    ctx = {},
    renames = {},
    instance = false
) {
    const sections = [{ userId, backup }];
    if (instance)
        for (const entry of backup.instance.accounts || []) {
            const id = ctx.userIdByUid[entry.account.uid];
            if (id && id !== userId)
                sections.push({ userId: id, backup: entry.backup });
        }
    const allowedOwners = sections.map((section) => section.userId);
    const counts = {
        comments: 0,
        relations: 0,
        events: 0,
        plans: 0,
        missing_references: 0,
    };
    const resolve = async (Model, key, uid, transaction) =>
        uid
            ? Model.findOne({
                  where: {
                      uid: renames[key]?.[uid] || uid,
                      user_id: { [Op.in]: allowedOwners },
                  },
                  transaction,
              })
            : null;
    const ownUser = await User.findByPk(userId);
    const author = (uid, fallback) =>
        ctx.userIdByUid?.[uid] || (uid === ownUser.uid ? userId : fallback);
    await sequelize.transaction(async (transaction) => {
        for (const section of sections) {
            const h = section.backup.data?.history;
            if (!h) continue; // Legacy backups did not include these records.
            if (h.format !== 1)
                throw new Error('Unsupported history backup format');
            const commentIds = {};
            for (const entry of h.comments || []) {
                const task = await resolve(
                    Task,
                    'tasks',
                    entry.task_uid,
                    transaction
                );
                if (!task)
                    throw new Error('History task missing during restore');
                const collision = await Comment.findOne({
                    where: { uid: entry.uid },
                    transaction,
                });
                const restoreUid =
                    collision && collision.task_id !== task.id
                        ? generateUid()
                        : entry.uid;
                const [row, created] = await Comment.findOrCreate({
                    where: { uid: restoreUid },
                    defaults: {
                        task_id: task.id,
                        user_id: author(entry.author_uid, section.userId),
                        body: entry.body,
                        source_author: ctx.userIdByUid?.[entry.author_uid]
                            ? null
                            : entry.original_author,
                        mentioned_person_uids:
                            entry.mentioned_person_uids || [],
                        deleted_at: entry.deleted_at,
                        created_at: entry.created_at,
                        updated_at: entry.updated_at,
                    },
                    transaction,
                });
                if (row.task_id !== task.id)
                    throw new Error(
                        'Comment UID collision: restore into a clean instance'
                    );
                commentIds[entry.uid] = row.id;
                if (created) counts.comments++;
            }
            for (const entry of h.comments || [])
                if (entry.parent_uid) {
                    if (!commentIds[entry.parent_uid])
                        throw new Error('Comment parent missing');
                    await Comment.update(
                        { parent_comment_id: commentIds[entry.parent_uid] },
                        {
                            where: { id: commentIds[entry.uid] },
                            transaction,
                            silent: true,
                        }
                    );
                }
            for (const entry of h.reactions || [])
                await CommentReaction.findOrCreate({
                    where: {
                        comment_id: commentIds[entry.comment_uid],
                        user_id: author(entry.author_uid, section.userId),
                    },
                    defaults: { reaction_type: entry.reaction_type },
                    transaction,
                });
            for (const entry of h.relations || []) {
                const source = await resolve(
                    Task,
                    'tasks',
                    entry.source_uid,
                    transaction
                );
                const target = await resolve(
                    Task,
                    'tasks',
                    entry.target_uid,
                    transaction
                );
                if (!source || !target) {
                    if (instance) throw new Error('Relation endpoint missing');
                    counts.missing_references++;
                    continue;
                }
                const [, created] = await TaskRelation.findOrCreate({
                    where: {
                        source_task_id: source.id,
                        target_task_id: target.id,
                        relation_type: entry.relation_type,
                    },
                    defaults: {
                        uid: generateUid(),
                        created_by_user_id: author(
                            entry.author_uid,
                            section.userId
                        ),
                    },
                    transaction,
                });
                if (created) counts.relations++;
            }
            for (const entry of h.events || []) {
                const task = await resolve(
                    Task,
                    'tasks',
                    entry.task_uid,
                    transaction
                );
                if (!task) throw new Error('Event task missing');
                const values = {
                    task_id: task.id,
                    user_id: author(entry.author_uid, section.userId),
                    event_type: entry.event_type,
                    old_value: entry.old_value,
                    new_value: entry.new_value,
                    field_name: entry.field_name,
                    created_at: entry.created_at,
                    updated_at: entry.updated_at,
                };
                const restoreUid =
                    entry.restore_uid ||
                    require('crypto')
                        .createHash('sha256')
                        .update(
                            `${task.uid}:${entry.source_id}:${entry.created_at}`
                        )
                        .digest('hex');
                const original = entry.source_id
                    ? await TaskEvent.findByPk(entry.source_id, { transaction })
                    : null;
                if (
                    original &&
                    !original.restore_uid &&
                    original.task_id === task.id &&
                    original.event_type === entry.event_type &&
                    new Date(original.created_at).getTime() ===
                        new Date(entry.created_at).getTime() &&
                    JSON.stringify(original.old_value) ===
                        JSON.stringify(entry.old_value) &&
                    JSON.stringify(original.new_value) ===
                        JSON.stringify(entry.new_value) &&
                    original.field_name === entry.field_name
                ) {
                    await original.update(
                        { restore_uid: restoreUid },
                        { transaction, silent: true }
                    );
                    continue;
                }
                const [, created] = await TaskEvent.findOrCreate({
                    where: { restore_uid: restoreUid },
                    defaults: values,
                    transaction,
                });
                if (created) counts.events++;
            }
            for (const entry of h.plans || []) {
                const [plan, created] = await DailyPlan.findOrCreate({
                    where: {
                        user_id: section.userId,
                        plan_date: entry.plan_date,
                    },
                    defaults: {
                        uid: generateUid(),
                        started_at: entry.started_at,
                        ai_wrap_up: entry.ai_wrap_up,
                    },
                    transaction,
                });
                if (!created) continue; // Never overwrite a person's existing plan.
                for (const item of entry.items || []) {
                    const task = await resolve(
                        Task,
                        'tasks',
                        item.task_uid,
                        transaction
                    );
                    if (!task) {
                        if (instance) throw new Error('Plan task missing');
                        counts.missing_references++;
                        continue;
                    }
                    await DailyPlanItem.create(
                        {
                            daily_plan_id: plan.id,
                            task_id: task.id,
                            position: item.position,
                            start_minute: item.start_minute,
                            duration_minutes: item.duration_minutes,
                        },
                        { transaction }
                    );
                }
                counts.plans++;
            }
            for (const entry of h.project_links || []) {
                if (!entry.project_uid) continue;
                const row = await resolve(
                    entry.type === 'task' ? Task : Note,
                    entry.type === 'task' ? 'tasks' : 'notes',
                    entry.uid,
                    transaction
                );
                const project = await resolve(
                    Project,
                    'projects',
                    entry.project_uid,
                    transaction
                );
                if (!row || !project) {
                    if (instance)
                        throw new Error('Shared project reference missing');
                    counts.missing_references++;
                    continue;
                }
                await row.update(
                    { project_id: project.id },
                    { transaction, silent: true }
                );
            }
        }
    });
    return counts;
}
module.exports = { exportHistory, restoreHistory };
