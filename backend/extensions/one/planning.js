'use strict';
const moment = require('moment-timezone');
const { Op } = require('sequelize');
const {
    Task,
    User,
    OnePlan,
    DailyPlan,
    DailyPlanItem,
    TaskEvent,
    sequelize,
} = require('../../models');
const permissions = require('../../services/permissionsService');
const {
    ValidationError,
    NotFoundError,
    ConflictError,
    AppError,
    ServiceUnavailableError,
} = require('../../shared/errors');
const timezone = (user) => user.timezone || 'UTC';
const today = (user) => moment().tz(timezone(user)).format('YYYY-MM-DD');
function date(value) {
    if (
        typeof value !== 'string' ||
        !moment(value, 'YYYY-MM-DD', true).isValid()
    )
        throw new ValidationError('Укажите дату ГГГГ-ММ-ДД.');
    return value;
}
function monday(value) {
    return moment(date(value), 'YYYY-MM-DD')
        .startOf('isoWeek')
        .format('YYYY-MM-DD');
}
async function enabled(userId, transaction) {
    return Boolean((await User.findByPk(userId, { transaction }))?.one_actor);
}
function supported() {
    if (sequelize.getDialect() !== 'sqlite')
        throw new ServiceUnavailableError(
            'Правила One пока проверены только на SQLite.'
        );
}
async function visibleTask(userId, taskUid) {
    if (
        (await permissions.getAccess(userId, 'task', taskUid)) ===
        permissions.ACCESS.NONE
    )
        throw new NotFoundError('Task not found');
    const task = await Task.findOne({ where: { uid: taskUid } });
    if (!task) throw new NotFoundError('Task not found');
    return task;
}
const empty = (task) => ({
    task_uid: task.uid,
    planned: null,
    week: null,
    last_planned: null,
    moves: 0,
    revision: 0,
});
function serialize(row, task) {
    return row
        ? {
              ...empty(task),
              planned: row.planned,
              week: row.week,
              last_planned: row.last_planned,
              moves: row.moves,
              revision: row.revision,
          }
        : empty(task);
}
async function read(userId, taskUid) {
    const task = await visibleTask(userId, taskUid);
    return serialize(
        await OnePlan.findOne({ where: { user_id: userId, task_id: task.id } }),
        task
    );
}
async function checkDayRevision(
    userId,
    plan,
    expected,
    transaction,
    expectedOneRevision
) {
    if (!(await enabled(userId, transaction))) return;
    if (!Number.isInteger(expected))
        throw new AppError(
            'Обновите дневной план перед сохранением.',
            428,
            'REVISION_REQUIRED'
        );
    const actor = await User.findByPk(userId, { transaction });
    if (!Number.isInteger(expectedOneRevision))
        throw new AppError(
            'Обновите общий план перед сохранением.',
            428,
            'REVISION_REQUIRED'
        );
    if (actor.one_plan_revision !== expectedOneRevision)
        throw new ConflictError(
            'План изменён в другом месте. Ваш вариант не записан; обновите данные.'
        );
    if (expected !== (plan?.revision || 0))
        throw new ConflictError(
            'Дневной план уже изменён. Ваш вариант не записан; обновите данные.'
        );
}
// Only remove live projections; past plans remain a record of what was planned.
async function removeProjection(user, taskId, exceptDate, transaction) {
    const plans = await DailyPlan.findAll({
        where: { user_id: user.id, plan_date: { [Op.gte]: today(user) } },
        transaction,
    });
    for (const plan of plans) {
        if (plan.plan_date === exceptDate) continue;
        const count = await DailyPlanItem.destroy({
            where: { daily_plan_id: plan.id, task_id: taskId },
            transaction,
        });
        if (count) await plan.increment('revision', { transaction });
    }
}
async function change(
    user,
    task,
    selection,
    transaction,
    expected,
    project = true
) {
    const [row] = await OnePlan.findOrCreate({
        where: { user_id: user.id, task_id: task.id },
        defaults: { user_id: user.id, task_id: task.id },
        transaction,
        nativeProjection: false,
    });
    if (expected !== undefined && row.revision !== expected)
        throw new ConflictError(
            'План задачи уже изменён. Обновите данные и повторите выбор.'
        );
    const planned = selection.planned || null,
        week = selection.week || null;
    if (planned && week)
        throw new ValidationError('Выберите день или неделю, не оба сразу.');
    if (row.planned === planned && row.week === week)
        return serialize(row, task);
    const before = { planned: row.planned, week: row.week, moves: row.moves };
    const moves =
        row.moves +
        (planned && row.last_planned && planned !== row.last_planned ? 1 : 0);
    const [count] = await OnePlan.update(
        {
            planned,
            week,
            moves,
            last_planned: planned || row.last_planned,
            revision: row.revision + 1,
        },
        {
            where: { id: row.id, revision: row.revision },
            transaction,
        }
    );
    if (count !== 1) throw new ConflictError('План уже изменён.');
    await removeProjection(user, task.id, planned, transaction);
    if (project && planned) {
        const [day] = await DailyPlan.findOrCreate({
            where: { user_id: user.id, plan_date: planned },
            defaults: { user_id: user.id, plan_date: planned },
            transaction,
        });
        const exists = await DailyPlanItem.findOne({
            where: { daily_plan_id: day.id, task_id: task.id },
            transaction,
        });
        if (!exists) {
            const max = await DailyPlanItem.max('position', {
                where: { daily_plan_id: day.id },
                transaction,
            });
            await DailyPlanItem.create(
                {
                    daily_plan_id: day.id,
                    task_id: task.id,
                    position: Number.isFinite(max) ? max + 1 : 0,
                    duration_minutes: task.estimated_minutes || 30,
                },
                { transaction }
            );
            await day.increment('revision', { transaction });
        }
    }
    await TaskEvent.create(
        {
            task_id: task.id,
            user_id: user.id,
            event_type: 'one_plan_changed',
            old_value: before,
            new_value: { planned, week, moves },
            metadata: {
                action: 'one_plan_changed',
                planning_user_uid: user.uid,
            },
        },
        { transaction }
    );
    await User.increment('one_plan_revision', {
        where: { id: user.id },
        transaction,
    });
    await row.reload({ transaction });
    await require('./nativePlanning').project(row, { transaction });
    return serialize(row, task);
}
async function set(user, taskUid, input) {
    supported();
    if (!(await enabled(user.id)))
        throw new ValidationError('Сначала включите правила One.');
    const task = await visibleTask(user.id, taskUid);
    if ([2, 3, 5].includes(task.status) && (input.planned || input.week))
        throw new ValidationError('Завершённую задачу сначала нужно открыть.');
    if (
        !Number.isInteger(input.expected_revision) ||
        input.expected_revision < 0
    )
        throw new AppError(
            'Нужна версия плана задачи.',
            428,
            'REVISION_REQUIRED'
        );
    if (input.planned && input.week)
        throw new ValidationError('Выберите день или неделю, не оба сразу.');
    const planned = input.planned ? date(input.planned) : null;
    const week = input.week ? monday(input.week) : null;
    return require('./write')(() =>
        sequelize.transaction({ type: 'IMMEDIATE' }, (transaction) =>
            change(
                user,
                task,
                { planned, week },
                transaction,
                input.expected_revision
            )
        )
    );
}
// Called inside the native daily planner's own transaction, before its item list
// is replaced. There is one set of tasks and one canonical current selection.
async function syncNativeDay(userId, planDate, rows, transaction) {
    const user = await User.findByPk(userId, { transaction });
    if (!user?.one_actor || planDate < today(user)) return;
    supported();
    const current = await OnePlan.findAll({
        where: { user_id: userId, planned: planDate },
        transaction,
    });
    const ids = new Set(rows.map((row) => row.task_id));
    for (const row of current)
        if (!ids.has(row.task_id)) {
            const task = await Task.findByPk(row.task_id, { transaction });
            await change(
                user,
                task,
                { planned: null, week: null },
                transaction,
                undefined,
                false
            );
        }
    for (const id of ids) {
        const task = await Task.findByPk(id, { transaction });
        await change(
            user,
            task,
            { planned: planDate, week: null },
            transaction,
            undefined,
            false
        );
    }
}
module.exports = {
    enabled,
    supported,
    date,
    monday,
    today,
    visibleTask,
    read,
    set,
    change,
    syncNativeDay,
    checkDayRevision,
    serialize,
};
