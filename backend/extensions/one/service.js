'use strict';
const { Op } = require('sequelize');
const {
    Task,
    Comment,
    OnePlan,
    DailyPlan,
    DailyPlanItem,
    User,
    sequelize,
} = require('../../models');
const permissions = require('../../services/permissionsService');
const planning = require('./planning');
const dialog = require('./dialog');
const { ValidationError } = require('../../shared/errors');
async function dashboard(user) {
    const where = await permissions.ownershipOrPermissionWhere('task', user.id);
    const tasks = await Task.findAll({
        where,
        order: [['updated_at', 'DESC']],
        attributes: ['id', 'uid', 'name', 'status', 'due_date', 'user_id'],
    });
    const ids = tasks.map((t) => t.id);
    const comments = ids.length
        ? await Comment.findAll({
              where: { task_id: { [Op.in]: ids }, deleted_at: null },
              order: [
                  ['created_at', 'ASC'],
                  ['id', 'ASC'],
              ],
          })
        : [];
    const plans = await OnePlan.findAll({ where: { user_id: user.id } });
    const byTask = new Map(plans.map((p) => [p.task_id, p]));
    const pending = [],
        questions = [];
    for (const task of tasks) {
        const thread = comments.filter((c) => c.task_id === task.id);
        const debt = thread.filter((c) => c.one_pending);
        const last = thread[thread.length - 1];
        const base = {
            task_uid: task.uid,
            name: task.name,
            status: task.status,
        };
        if (debt.length)
            pending.push({
                ...base,
                count: debt.length,
                comments: debt.map((c) => ({
                    uid: c.uid,
                    body: c.body,
                    created_at: c.created_at,
                })),
            });
        if (last?.one_role === 'agent' && last.body.includes('?'))
            questions.push({
                ...base,
                comment: {
                    uid: last.uid,
                    body: last.body,
                    created_at: last.created_at,
                },
            });
    }
    return {
        enabled: Boolean((await User.findByPk(user.id))?.one_actor),
        today: planning.today(user),
        week: planning.monday(planning.today(user)),
        timezone: user.timezone || 'UTC',
        agent_owes: pending,
        human_owes: questions,
        unclassified_comments: comments.filter((c) => !c.one_role).length,
        tasks: tasks.map((task) => ({
            ...baseTask(task),
            plan: planning.serialize(byTask.get(task.id), task),
        })),
    };
}
function baseTask(task) {
    return {
        uid: task.uid,
        name: task.name,
        status: task.status,
        due_date: task.due_date,
    };
}
// Viewer-scoped batch for collapsed native rows; do not disclose other users' plans.
async function moveCounts(user) {
    if (!(await planning.enabled(user.id))) return {};
    const where = await permissions.ownershipOrPermissionWhere('task', user.id);
    const tasks = await Task.findAll({ where, attributes: ['id', 'uid'] });
    const visible = new Map(tasks.map((task) => [task.id, task.uid]));
    const plans = await OnePlan.findAll({
        where: { user_id: user.id, moves: { [Op.gt]: 0 } },
        attributes: ['task_id', 'moves'],
    });
    return Object.fromEntries(
        plans
            .filter((plan) => visible.has(plan.task_id))
            .map((plan) => [visible.get(plan.task_id), plan.moves])
    );
}
async function taskInfo(user, uid) {
    const task = await planning.visibleTask(user.id, uid);
    return {
        enabled: await planning.enabled(task.user_id),
        today: planning.today(user),
        plan: await planning.read(user.id, uid),
        pending_comments: await Comment.count({
            where: { task_id: task.id, one_pending: true, deleted_at: null },
        }),
    };
}
// Historical author labels are explicit provenance. Do not infer a role from
// arbitrary prose or from the account used by the old importer.
function archivedRole(body) {
    const match = String(body).match(
        /^\[?АРХИВ[^\n]*•\s*(owner|agent)\]?\s*(?:\n|$)/
    );
    return match ? (match[1] === 'owner' ? 'human' : 'agent') : null;
}
async function enable(user) {
    planning.supported();
    if ((await User.findByPk(user.id))?.one_actor === 'agent')
        throw new ValidationError(
            'Учётная запись агента не может менять роль через интерфейс.'
        );
    return require('./write')(() =>
        sequelize.transaction({ type: 'IMMEDIATE' }, async (transaction) => {
            await User.update(
                { one_actor: 'human' },
                { where: { id: user.id }, transaction }
            );
            const tasks = await Task.findAll({
                where: { user_id: user.id },
                transaction,
            });
            let classified = 0;
            for (const task of tasks) {
                const comments = await Comment.findAll({
                    where: { task_id: task.id, deleted_at: null },
                    order: [
                        ['created_at', 'ASC'],
                        ['id', 'ASC'],
                    ],
                    transaction,
                });
                let waiting = [];
                for (const comment of comments) {
                    const role = comment.one_role || archivedRole(comment.body);
                    if (!role) continue;
                    if (!comment.one_role) {
                        await comment.update(
                            { one_role: role, one_pending: role === 'human' },
                            { transaction }
                        );
                        classified++;
                    }
                    if (role === 'human') waiting.push(comment);
                    else {
                        for (const pending of waiting)
                            if (pending.one_pending)
                                await pending.update(
                                    {
                                        one_pending: false,
                                        one_answered_at: comment.created_at,
                                    },
                                    { transaction }
                                );
                        waiting = [];
                    }
                }
            }
            // Establish a baseline from the latest existing day; no invented move
            // counts. Past native plans remain readable historical snapshots.
            const days = await DailyPlan.findAll({
                where: { user_id: user.id },
                order: [['plan_date', 'ASC']],
                transaction,
            });
            const latest = new Map();
            for (const day of days)
                for (const item of await DailyPlanItem.findAll({
                    where: { daily_plan_id: day.id },
                    transaction,
                }))
                    latest.set(item.task_id, day.plan_date);
            for (const [taskId, day] of latest) {
                const task = await Task.findByPk(taskId, { transaction });
                if (!task || [2, 3, 5].includes(task.status)) continue;
                await OnePlan.findOrCreate({
                    where: { user_id: user.id, task_id: taskId },
                    defaults: {
                        user_id: user.id,
                        task_id: taskId,
                        planned: day,
                        last_planned: day,
                    },
                    transaction,
                });
            }
            return { enabled: true, classified };
        })
    );
}
async function reply(user, uid, body) {
    return require('../../modules/comments/service').addComment(
        user.id,
        uid,
        { body },
        'mcp'
    );
}
module.exports = {
    moveCounts,
    dashboard,
    taskInfo,
    archivedRole,
    enable,
    reply,
    assertCanClose: dialog.assertCanClose,
};
