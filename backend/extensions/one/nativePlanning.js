// Compatibility between native dates and the existing One bridge contract.
const { Task, User, OnePlan, sequelize } = require('../../models');
const moment = require('moment-timezone');
const { processDueDateForStorage } = require('../../utils/timezone-utils');
const planning = () => require('./planning');
const day = (value, user) =>
    value
        ? moment(value)
              .tz(user.timezone || 'UTC')
              .format('YYYY-MM-DD')
        : null;

async function project(row, options = {}) {
    // Called by model hooks, including writes made by the unchanged One adapter.
    if (!options.transaction)
        throw new Error('One plan projection requires a transaction');
    const task = await Task.findByPk(row.task_id, {
        transaction: options.transaction,
    });
    const user = await User.findByPk(row.user_id, {
        transaction: options.transaction,
    });
    if (!task || !user?.one_actor || task.user_id !== user.id) return;
    const date = row.planned
        ? processDueDateForStorage(row.planned, user.timezone || 'UTC')
        : null;
    if (day(task.due_date, user) === row.planned) return;
    await task.update(
        { due_date: date, due_has_time: false },
        { transaction: options.transaction }
    );
}
async function updateDate(task, attributes, input, options, save) {
    if (!Object.prototype.hasOwnProperty.call(attributes, 'due_date'))
        return save(options);
    const user = await User.findByPk(task.user_id);
    if (!user) return save(options);
    const write = async (transaction) => {
        const fresh = await Task.findByPk(task.id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        const before = day(fresh.due_date, user),
            after = day(attributes.due_date, user);
        if (Object.prototype.hasOwnProperty.call(input, 'expected_due_date')) {
            const expected = input.expected_due_date;
            if (
                expected !== null &&
                (typeof expected !== 'string' ||
                    !moment(expected, 'YYYY-MM-DD', true).isValid())
            )
                throw new (require('../../shared/errors').AppError)(
                    'Некорректная исходная дата.',
                    400,
                    'TASK_DATE_EXPECTATION_INVALID'
                );
            const expectedBefore = day(fresh.due_date, {
                timezone: options.viewerTimezone || user.timezone,
            });
            const timeBefore =
                fresh.due_has_time && fresh.due_date
                    ? moment(fresh.due_date)
                          .tz(options.viewerTimezone || user.timezone || 'UTC')
                          .format('HH:mm')
                    : null;
            if (
                expectedBefore !== expected ||
                (Object.prototype.hasOwnProperty.call(
                    input,
                    'expected_due_time'
                ) &&
                    input.expected_due_time !== timeBefore)
            )
                throw new (require('../../shared/errors').AppError)(
                    'Дата уже изменилась. Обновите доску и повторите перенос.',
                    409,
                    'TASK_DATE_CONFLICT'
                );
        }
        const result = await save({ ...options, transaction });
        if (user.one_actor && before !== after) {
            // Seed the previous native date once; first assignment stays at zero.
            await OnePlan.findOrCreate({
                where: { user_id: user.id, task_id: task.id },
                defaults: {
                    user_id: user.id,
                    task_id: task.id,
                    planned: before,
                    last_planned: before,
                },
                transaction,
                nativeProjection: false,
            });
            await planning().change(
                user,
                result,
                { planned: after, week: null },
                transaction,
                undefined,
                true,
                { countMove: !options.automaticRecurrence }
            );
        }
        return result;
    };
    return options.transaction
        ? write(options.transaction)
        : require('./write')(() =>
              sequelize.transaction(
                  sequelize.getDialect() === 'sqlite'
                      ? { type: 'IMMEDIATE' }
                      : {},
                  write
              )
          );
}
// Explicit, idempotent preparation. Conflicting dates are never overwritten.
async function reconcile() {
    return sequelize.transaction({ type: 'IMMEDIATE' }, async (transaction) => {
        const result = { projected: 0, weeks: 0, conflicts: [] };
        const rows = await OnePlan.findAll({ transaction });
        for (const row of rows) {
            const task = await Task.findByPk(row.task_id, { transaction });
            const user = await User.findByPk(row.user_id, { transaction });
            if (!task || !user?.one_actor || task.user_id !== user.id) continue;
            if (row.week) {
                result.weeks++;
                continue;
            }
            if (!row.planned) continue;
            if (task.due_date && day(task.due_date, user) !== row.planned) {
                result.conflicts.push(task.uid);
                continue;
            }
            if (!task.due_date) {
                await project(row, { transaction });
                result.projected++;
            }
        }
        if (result.conflicts.length)
            throw new Error(
                'NATIVE_PLAN_DATE_CONFLICT: ' + result.conflicts.join(',')
            );
        return result;
    });
}
module.exports = { project, updateDate, reconcile };
