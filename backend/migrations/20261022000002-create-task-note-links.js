'use strict';
module.exports = {
    async up(q, S) {
        await q.sequelize.transaction(async (transaction) => {
            await q.createTable(
                'task_note_links',
                {
                    id: {
                        type: S.INTEGER,
                        primaryKey: true,
                        autoIncrement: true,
                        allowNull: false,
                    },
                    uid: { type: S.STRING, allowNull: false, unique: true },
                    task_id: {
                        type: S.INTEGER,
                        allowNull: false,
                        references: { model: 'tasks', key: 'id' },
                        onDelete: 'CASCADE',
                    },
                    note_id: {
                        type: S.INTEGER,
                        allowNull: false,
                        references: { model: 'notes', key: 'id' },
                        onDelete: 'CASCADE',
                    },
                    relation_type: { type: S.STRING, allowNull: false },
                    created_by_user_id: {
                        type: S.INTEGER,
                        allowNull: true,
                        references: { model: 'users', key: 'id' },
                        onDelete: 'SET NULL',
                    },
                    created_at: { type: S.DATE, allowNull: false },
                    updated_at: { type: S.DATE, allowNull: false },
                },
                { transaction }
            );
            await q.addIndex(
                'task_note_links',
                ['task_id', 'note_id', 'relation_type'],
                { unique: true, name: 'task_note_links_pair_type', transaction }
            );
            await q.addIndex('task_note_links', ['note_id'], {
                name: 'task_note_links_note',
                transaction,
            });
        });
    },
    async down(q) {
        await q.dropTable('task_note_links');
    },
};
