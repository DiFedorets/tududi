'use strict';
module.exports = {
    async up(queryInterface, Sequelize) {
        // Fresh installations sync the current model schema before marking
        // historical migrations. Existing installations need these columns.
        const additions = [
            [
                'notes',
                'revision',
                { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
            ],
            [
                'comments',
                'source_author',
                { type: Sequelize.JSON, allowNull: true },
            ],
            [
                'task_events',
                'restore_uid',
                { type: Sequelize.STRING(64), allowNull: true },
            ],
        ];
        for (const [table, column, definition] of additions) {
            const columns = await queryInterface.describeTable(table);
            if (!columns[column])
                await queryInterface.addColumn(table, column, definition);
        }
        const indexes = await queryInterface.showIndex('task_events');
        if (
            !indexes.some((index) => index.name === 'task_events_restore_uid')
        ) {
            await queryInterface.addIndex('task_events', ['restore_uid'], {
                name: 'task_events_restore_uid',
                unique: true,
            });
        }
    },
    async down(queryInterface) {
        await queryInterface.removeIndex(
            'task_events',
            'task_events_restore_uid'
        );
        await queryInterface.removeColumn('task_events', 'restore_uid');
        await queryInterface.removeColumn('comments', 'source_author');
        await queryInterface.removeColumn('notes', 'revision');
    },
};
