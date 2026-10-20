'use strict';
const guards = [
    [
        'one_task_close',
        'BEFORE UPDATE OF status ON tasks',
        'NEW.status IN (2,3,5) AND OLD.status <> NEW.status AND EXISTS(SELECT 1 FROM comments WHERE task_id=NEW.id AND one_pending=1 AND deleted_at IS NULL)',
        'ONE_UNANSWERED',
    ],
    [
        'one_comment_immutable',
        'BEFORE UPDATE OF body,deleted_at,one_role ON comments',
        'OLD.one_role IS NOT NULL AND (NEW.body <> OLD.body OR NEW.deleted_at IS NOT OLD.deleted_at OR NEW.one_role IS NOT OLD.one_role)',
        'ONE_APPEND_ONLY',
    ],
    [
        'one_recurring_close',
        'BEFORE INSERT ON recurring_completions',
        'NEW.skipped=0 AND EXISTS(SELECT 1 FROM comments WHERE task_id=NEW.task_id AND one_pending=1 AND deleted_at IS NULL)',
        'ONE_UNANSWERED',
    ],
    [
        'one_plan_insert',
        'BEFORE INSERT ON one_plans',
        '(NEW.planned IS NOT NULL AND NEW.week IS NOT NULL) OR NEW.moves < 0',
        'ONE_PLAN_EXCLUSIVE',
    ],
    [
        'one_plan_update',
        'BEFORE UPDATE ON one_plans',
        '(NEW.planned IS NOT NULL AND NEW.week IS NOT NULL) OR NEW.moves < 0',
        'ONE_PLAN_EXCLUSIVE',
    ],
];
async function install(sequelize) {
    if (sequelize.getDialect() !== 'sqlite') return;
    for (const [name, event, condition, message] of guards)
        await sequelize.query(
            `CREATE TRIGGER IF NOT EXISTS ${name} ${event} WHEN ${condition} BEGIN SELECT RAISE(ABORT, '${message}'); END`
        );
}
async function uninstall(sequelize) {
    if (sequelize.getDialect() !== 'sqlite') return;
    for (const [name] of guards)
        await sequelize.query(`DROP TRIGGER IF EXISTS ${name}`);
}
module.exports = { install, uninstall };
