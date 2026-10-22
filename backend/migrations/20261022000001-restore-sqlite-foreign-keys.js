'use strict';
const { QueryTypes } = require('sequelize');
const {
    rebuildTables,
    columnName,
    removeReference,
} = require('../utils/sqlite-rebuild');

// Explicit, versioned policy: optional links retain the child; required owner
// links match existing model CASCADE semantics. Never infer from future models.
const links = {
    calendar_tokens: [['user_id', 'users', 'id', 'CASCADE']],
    areas: [['user_id', 'users', 'id', 'CASCADE']],
    projects: [
        ['user_id', 'users', 'id', 'CASCADE'],
        ['area_id', 'areas', 'id', 'SET NULL'],
        ['goal_id', 'goals', 'id', 'SET NULL'],
        ['source_template_id', 'projects', 'id', 'NO ACTION'],
    ],
    tasks: [
        ['user_id', 'users', 'id', 'CASCADE'],
        ['project_id', 'projects', 'id', 'SET NULL'],
        ['area_id', 'areas', 'id', 'SET NULL'],
        ['goal_id', 'goals', 'id', 'SET NULL'],
        ['recurring_parent_id', 'tasks', 'id', 'SET NULL'],
        ['parent_task_id', 'tasks', 'id', 'SET NULL'],
        ['assigned_to', 'people', 'uid', 'SET NULL'],
    ],
    notes: [
        ['user_id', 'users', 'id', 'CASCADE'],
        ['project_id', 'projects', 'id', 'SET NULL'],
    ],
    inbox_items: [['user_id', 'users', 'id', 'CASCADE']],
    oidc_identities: [['user_id', 'users', 'id', 'CASCADE']],
    goals: [
        ['area_id', 'areas', 'id', 'SET NULL'],
        ['user_id', 'users', 'id', 'CASCADE'],
    ],
};
const quote = (name) => '"' + name.replace(/"/g, '""') + '"';
module.exports = {
    async up(qi) {
        if (qi.sequelize.getDialect() !== 'sqlite') return;
        const edits = [];
        // Audit every intended relation first; abort rather than alter bad data.
        for (const [table, refs] of Object.entries(links)) {
            const existing = await qi.sequelize.query(
                'PRAGMA foreign_key_list(' + quote(table) + ')',
                { type: QueryTypes.SELECT }
            );
            const missing = [];
            for (const [column, parent, key, onDelete] of refs) {
                const bad = await qi.sequelize.query(
                    'SELECT COUNT(*) AS n FROM ' +
                        quote(table) +
                        ' c WHERE c.' +
                        quote(column) +
                        ' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ' +
                        quote(parent) +
                        ' p WHERE p.' +
                        quote(key) +
                        '=c.' +
                        quote(column) +
                        ')',
                    { type: QueryTypes.SELECT }
                );
                if (Number(bad[0].n))
                    throw new Error(
                        'Orphan references: ' + table + '.' + column
                    );
                const found = existing.find((fk) => fk.from === column);
                if (
                    found &&
                    (found.table.toLowerCase() !== parent.toLowerCase() ||
                        found.to.toLowerCase() !== key.toLowerCase())
                )
                    throw new Error(
                        'Unexpected foreign key target: ' + table + '.' + column
                    );
                const onUpdate =
                    column === 'source_template_id' ? 'NO ACTION' : 'CASCADE';
                if (
                    !found ||
                    found.on_delete !== onDelete ||
                    found.on_update !== onUpdate
                )
                    missing.push([column, parent, key, onDelete]);
            }
            if (missing.length)
                edits.push({
                    table,
                    transform: (definitions) => {
                        for (const [column, parent, key, onDelete] of missing) {
                            if (
                                !definitions.some(
                                    (d) => columnName(d) === column
                                )
                            )
                                throw new Error(
                                    'Missing column: ' + table + '.' + column
                                );
                            definitions = definitions
                                .filter((d) => {
                                    if (columnName(d) !== null) return true;
                                    const match = d.match(
                                        /FOREIGN\s+KEY\s*\(\s*["`\[]?([\w]+)["`\]]?\s*\)/i
                                    );
                                    return !match || match[1] !== column;
                                })
                                .map((d) =>
                                    columnName(d) === column
                                        ? removeReference(d)
                                        : d
                                );
                            definitions.push(
                                'FOREIGN KEY (' +
                                    quote(column) +
                                    ') REFERENCES ' +
                                    quote(parent) +
                                    '(' +
                                    quote(key) +
                                    ') ON DELETE ' +
                                    onDelete +
                                    ' ON UPDATE ' +
                                    (column === 'source_template_id'
                                        ? 'NO ACTION'
                                        : 'CASCADE')
                            );
                        }
                        return definitions;
                    },
                });
        }
        if (edits.length) await rebuildTables(qi, edits);
    },
    async down() {
        throw new Error(
            'Restore the verified pre-migration database backup to roll back SQLite FK repair; constraints must not be silently removed.'
        );
    },
};
