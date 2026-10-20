'use strict';
const constraints = require('../extensions/one/constraints');
module.exports = {
    async up(q, S) {
        const additions = [
            [
                'users',
                'one_plan_revision',
                { type: S.INTEGER, allowNull: false, defaultValue: 0 },
            ],
            ['users', 'one_actor', { type: S.STRING(16), allowNull: true }],
            ['comments', 'one_role', { type: S.STRING(16), allowNull: true }],
            [
                'comments',
                'one_pending',
                { type: S.BOOLEAN, allowNull: false, defaultValue: false },
            ],
            ['comments', 'one_answered_at', { type: S.DATE, allowNull: true }],
            [
                'daily_plans',
                'revision',
                { type: S.INTEGER, allowNull: false, defaultValue: 0 },
            ],
        ];
        for (const [table, column, definition] of additions)
            if (!(await q.describeTable(table))[column])
                await q.addColumn(table, column, definition);
        const tables = (await q.showAllTables()).map((t) =>
            typeof t === 'string' ? t : t.tableName
        );
        if (!tables.includes('one_plans')) {
            await q.createTable('one_plans', {
                id: { type: S.INTEGER, primaryKey: true, autoIncrement: true },
                uid: { type: S.STRING, allowNull: false, unique: true },
                user_id: {
                    type: S.INTEGER,
                    allowNull: false,
                    references: { model: 'users', key: 'id' },
                    onDelete: 'CASCADE',
                },
                task_id: {
                    type: S.INTEGER,
                    allowNull: false,
                    references: { model: 'tasks', key: 'id' },
                    onDelete: 'CASCADE',
                },
                planned: { type: S.DATEONLY, allowNull: true },
                week: { type: S.DATEONLY, allowNull: true },
                last_planned: { type: S.DATEONLY, allowNull: true },
                moves: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
                revision: {
                    type: S.INTEGER,
                    allowNull: false,
                    defaultValue: 0,
                },
                created_at: { type: S.DATE, allowNull: false },
                updated_at: { type: S.DATE, allowNull: false },
            });
        }
        if (
            !(await q.showIndex('one_plans')).some(
                (i) => i.name === 'one_plans_user_task'
            )
        )
            await q.addIndex('one_plans', ['user_id', 'task_id'], {
                unique: true,
                name: 'one_plans_user_task',
            });
        if (
            !(await q.showIndex('comments')).some(
                (i) => i.name === 'comments_one_pending'
            )
        )
            await q.addIndex('comments', ['task_id', 'one_pending'], {
                name: 'comments_one_pending',
            });
        await constraints.install(q.sequelize);
    },
    async down(q) {
        await constraints.uninstall(q.sequelize);
        await q.dropTable('one_plans');
        await q.removeIndex('comments', 'comments_one_pending');
        for (const [table, column] of [
            ['daily_plans', 'revision'],
            ['comments', 'one_answered_at'],
            ['comments', 'one_pending'],
            ['comments', 'one_role'],
            ['users', 'one_actor'],
            ['users', 'one_plan_revision'],
        ])
            if (q.sequelize.getDialect() === 'sqlite')
                await q.sequelize.query(
                    `ALTER TABLE "${table}" DROP COLUMN "${column}"`
                );
            else await q.removeColumn(table, column);
    },
};
