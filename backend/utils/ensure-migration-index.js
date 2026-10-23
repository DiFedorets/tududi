'use strict';

// sync() may already have created a model index on a fresh installation.
// Never swallow SQL errors or accept a different index with the same name.
module.exports = async function ensureMigrationIndex(
    q,
    table,
    fields,
    options
) {
    const indexes = await q.showIndex(table, {
        transaction: options.transaction,
    });
    const existing = indexes.find((index) => index.name === options.name);
    if (!existing) return q.addIndex(table, fields, options);
    // These migrations require full indexes, not partial unique constraints.
    if (q.sequelize.getDialect() === 'sqlite') {
        const [details] = await q.sequelize.query(
            `PRAGMA index_list("${table.replace(/"/g, '""')}")`,
            { transaction: options.transaction }
        );
        if (
            details.some(
                (index) => index.name === options.name && index.partial
            )
        ) {
            throw new Error(`Incompatible existing index: ${options.name}`);
        }
    }
    const actual = existing.fields.map((field) => field.attribute);
    if (
        Boolean(existing.unique) !== Boolean(options.unique) ||
        JSON.stringify(actual) !== JSON.stringify(fields)
    ) {
        throw new Error(`Incompatible existing index: ${options.name}`);
    }
};
