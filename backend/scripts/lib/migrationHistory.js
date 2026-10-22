// Old standalone runs could write to an accidental second journal. Never
// infer successful schema changes from that journal or copy its rows.
async function guardMigrationHistory(sequelize) {
    const tables = await sequelize.getQueryInterface().showAllTables();
    if (!tables.includes('sequelize_meta')) return;

    const [legacy] = await sequelize.query('SELECT name FROM "sequelize_meta"');
    const [canonical] = tables.includes('SequelizeMeta')
        ? await sequelize.query('SELECT name FROM "SequelizeMeta"')
        : [[]];
    const applied = new Set(canonical.map((row) => row.name));
    if (legacy.some((row) => !applied.has(row.name))) {
        throw new Error(
            'LEGACY_MIGRATION_HISTORY_REQUIRES_REVIEW: sequelize_meta contains migrations absent from SequelizeMeta. Inspect the schema and restore or reconcile a copy before retrying; no history was copied.'
        );
    }
}

module.exports = { guardMigrationHistory };
