'use strict';
module.exports = {
    async up(q, S) {
        const columns = await q.describeTable('notes');
        for (const [name, def] of [
            [
                'record_kind',
                {
                    type: S.STRING(20),
                    allowNull: false,
                    defaultValue: 'knowledge',
                },
            ],
            [
                'record_state',
                { type: S.STRING(20), allowNull: false, defaultValue: 'draft' },
            ],
            ['application_ref', { type: S.STRING(2000), allowNull: true }],
            ['ready_at', { type: S.DATE, allowNull: true }],
        ])
            if (!columns[name]) await q.addColumn('notes', name, def);
        // Existing material is knowledge. No guessed lesson/decision types,
        // no new tasks, no claims about external memory or instructions.
        if (!columns.record_kind)
            await q.sequelize.query(
                "UPDATE notes SET record_state='ready', ready_at=updated_at WHERE title IS NOT NULL AND TRIM(title)<>'' AND content IS NOT NULL AND TRIM(content)<>''"
            );
    },
    async down(q) {
        for (const name of [
            'ready_at',
            'application_ref',
            'record_state',
            'record_kind',
        ])
            await q.removeColumn('notes', name);
    },
};
