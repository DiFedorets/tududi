'use strict';
module.exports = {
    async up(q, S) {
        await q.sequelize.transaction(async (transaction) => {
            await q.addColumn(
                'notes',
                'discussion_date',
                { type: S.DATEONLY, allowNull: true },
                { transaction }
            );
            await q.createTable(
                'note_fragments',
                {
                    id: {
                        type: S.INTEGER,
                        primaryKey: true,
                        autoIncrement: true,
                        allowNull: false,
                    },
                    uid: { type: S.STRING, unique: true, allowNull: false },
                    note_id: {
                        type: S.INTEGER,
                        allowNull: false,
                        references: { model: 'notes', key: 'id' },
                        onDelete: 'CASCADE',
                    },
                    quote: { type: S.TEXT, allowNull: false },
                    prefix: { type: S.TEXT, allowNull: false },
                    suffix: { type: S.TEXT, allowNull: false },
                    original_from: { type: S.INTEGER, allowNull: false },
                    original_to: { type: S.INTEGER, allowNull: false },
                    created_revision: { type: S.INTEGER, allowNull: false },
                    start_offset: { type: S.INTEGER, allowNull: true },
                    end_offset: { type: S.INTEGER, allowNull: true },
                    state: { type: S.STRING, allowNull: false },
                    content_hash: { type: S.STRING(64), allowNull: false },
                    created_at: { type: S.DATE, allowNull: false },
                    updated_at: { type: S.DATE, allowNull: false },
                },
                { transaction }
            );
            await q.addIndex(
                'note_fragments',
                ['note_id', 'created_revision', 'original_from', 'original_to'],
                {
                    unique: true,
                    name: 'note_fragments_original_selection',
                    transaction,
                }
            );
        });
    },
    async down(q) {
        await q.sequelize.transaction(async (transaction) => {
            await q.dropTable('note_fragments', { transaction });
            await q.sequelize.query(
                'ALTER TABLE notes DROP COLUMN discussion_date',
                { transaction }
            );
        });
    },
};
