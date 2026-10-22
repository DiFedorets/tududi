'use strict';

const { QueryTypes, Transaction } = require('sequelize');
const quote = (name) => '"' + name.replace(/"/g, '""') + '"';

// Token boundaries retain quoted strings and nested expressions verbatim.
function tokens(sql) {
    const result = [];
    let start = -1,
        depth = 0,
        quoted = null;
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (start < 0 && /\s/.test(ch)) continue;
        if (start < 0) start = i;
        if (quoted) {
            if (ch === quoted) {
                if (sql[i + 1] === quoted && quoted !== ']') i++;
                else quoted = null;
            }
        } else if (['"', "'", '`', '['].includes(ch)) {
            quoted = ch === '[' ? ']' : ch;
        } else if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (
            start >= 0 &&
            !quoted &&
            depth === 0 &&
            (i + 1 === sql.length || /\s/.test(sql[i + 1]))
        ) {
            result.push(sql.slice(start, i + 1));
            start = -1;
        }
    }
    if (quoted || depth !== 0) throw new Error('Unsupported SQLite definition');
    return result;
}

function splitDefinitions(sql) {
    const open = sql.indexOf('('),
        close = sql.lastIndexOf(')');
    if (open < 0 || close < open) throw new Error('Unsupported CREATE TABLE');
    const body = sql.slice(open + 1, close);
    const definitions = [];
    let start = 0,
        depth = 0,
        quoted = null;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (quoted) {
            if (ch === quoted) {
                if (body[i + 1] === quoted && quoted !== ']') i++;
                else quoted = null;
            }
        } else if (['"', "'", '`', '['].includes(ch))
            quoted = ch === '[' ? ']' : ch;
        else if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) {
            definitions.push(body.slice(start, i).trim());
            start = i + 1;
        }
    }
    definitions.push(body.slice(start).trim());
    return { definitions, suffix: sql.slice(close + 1) };
}

function columnName(definition) {
    const first = tokens(definition)[0];
    if (/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)$/i.test(first)) return null;
    if (/^["`\[]/.test(first))
        return first.slice(1, -1).replace(/""/g, '"').replace(/``/g, '`');
    return first;
}

function removeReference(definition) {
    const tail = tokens(definition);
    const index = tail.findIndex((part) => part.toUpperCase() === 'REFERENCES');
    if (index >= 0) {
        let end = index + 2;
        while (
            end < tail.length &&
            !/^(CONSTRAINT|PRIMARY|NOT|UNIQUE|CHECK|DEFAULT|COLLATE|GENERATED)$/i.test(
                tail[end]
            )
        )
            end++;
        tail.splice(index, end - index);
    }
    return tail.join(' ');
}

function changeDefinition(qi, definition, change) {
    const parts = tokens(definition);
    const constraint =
        /^(CONSTRAINT|PRIMARY|NOT|NULL|UNIQUE|CHECK|DEFAULT|COLLATE|REFERENCES|GENERATED)$/i;
    let end = 1;
    while (end < parts.length && !constraint.test(parts[end])) end++;
    const type = qi.sequelize.normalizeDataType(change.type).toSql();
    let tail = parts.slice(end);
    if ('allowNull' in change) {
        tail = tail.filter(
            (part, i, all) =>
                !(
                    part.toUpperCase() === 'NOT' &&
                    all[i + 1]?.toUpperCase() === 'NULL'
                ) &&
                !(
                    part.toUpperCase() === 'NULL' &&
                    all[i - 1]?.toUpperCase() === 'NOT'
                )
        );
        if (!change.allowNull) tail.push('NOT', 'NULL');
    }
    if ('defaultValue' in change) {
        const index = tail.findIndex(
            (part) => part.toUpperCase() === 'DEFAULT'
        );
        if (index >= 0) tail.splice(index, 2);
        if (change.defaultValue !== undefined) {
            const value =
                typeof change.defaultValue === 'object' &&
                change.defaultValue !== null
                    ? JSON.stringify(change.defaultValue)
                    : change.defaultValue;
            tail.push('DEFAULT', qi.sequelize.escape(value));
        }
    }
    if (change.unique && !tail.some((part) => part.toUpperCase() === 'UNIQUE'))
        tail.push('UNIQUE');
    // References are normally retained verbatim. The historical nullable-area
    // migration supplies the same reference with a changed delete action.
    if (change.references) {
        const index = tail.findIndex(
            (part) => part.toUpperCase() === 'REFERENCES'
        );
        if (index >= 0) {
            let endRef = index + 2;
            while (
                endRef < tail.length &&
                !/^(CONSTRAINT|PRIMARY|NOT|UNIQUE|CHECK|DEFAULT|COLLATE|GENERATED)$/i.test(
                    tail[endRef]
                )
            )
                endRef++;
            tail.splice(index, endRef - index);
        }
        tail.push(
            'REFERENCES',
            quote(change.references.model) +
                '(' +
                quote(change.references.key || 'id') +
                ')'
        );
        if (change.onDelete) tail.push('ON DELETE', change.onDelete);
        if (change.onUpdate) tail.push('ON UPDATE', change.onUpdate);
    }
    return [parts[0], type, ...tail].join(' ');
}

// One dedicated connection, enforcement changed outside the transaction, all
// DDL/data/objects atomic. Never rename the old parent table first.
async function rebuildTables(qi, edits) {
    const sequelize = qi.sequelize;
    const session = new Transaction(sequelize);
    const connection = await sequelize.connectionManager.getConnection({
        uuid: session.id,
    });
    session.connection = connection;
    if (connection.filename !== ':memory:') connection.uuid = session.id;
    const options = { transaction: session };
    const query = (sql, extra = {}) =>
        sequelize.query(sql, {
            ...options,
            type: /^(SELECT|PRAGMA(?!.*=))/i.test(sql)
                ? QueryTypes.SELECT
                : QueryTypes.RAW,
            ...extra,
        });
    const original = (await query('PRAGMA foreign_keys'))[0].foreign_keys;
    let active = false;
    try {
        await query('PRAGMA foreign_keys=OFF');
        if ((await query('PRAGMA foreign_keys'))[0].foreign_keys !== 0)
            throw new Error(
                'Cannot disable foreign keys outside a transaction'
            );
        await query('BEGIN IMMEDIATE');
        active = true;
        // Views and triggers on other tables can refer to the parent while it
        // is temporarily absent. Recreate them only after every table exists.
        const dependentObjects = await query(
            "SELECT type,name,sql FROM sqlite_master WHERE type IN ('trigger','view') AND sql IS NOT NULL ORDER BY type,name"
        );
        for (const object of dependentObjects)
            await query('DROP ' + object.type + ' ' + quote(object.name));
        for (const edit of edits) {
            const rows = await query(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=:table",
                { replacements: { table: edit.table } }
            );
            if (!rows.length) throw new Error('Missing table: ' + edit.table);
            const { definitions, suffix } = splitDefinitions(rows[0].sql);
            const objects = await query(
                "SELECT type,name,sql FROM sqlite_master WHERE tbl_name=:table AND type='index' AND sql IS NOT NULL",
                { replacements: { table: edit.table } }
            );
            const columns = await query(
                'PRAGMA table_xinfo(' + quote(edit.table) + ')'
            );
            const writable = columns
                .filter((c) => !c.hidden && c.name !== edit.remove)
                .map((c) => quote(c.name));
            const next = edit.transform(definitions);
            const temp = '__fk_rebuild_' + edit.table;
            const sequence = await query(
                "SELECT name FROM sqlite_master WHERE name='sqlite_sequence'"
            );
            const seq = sequence.length
                ? await query(
                      'SELECT seq FROM sqlite_sequence WHERE name=:table',
                      { replacements: { table: edit.table } }
                  )
                : [];
            await query(
                'CREATE TABLE ' +
                    quote(temp) +
                    ' (' +
                    next.join(', ') +
                    ')' +
                    suffix
            );
            await query(
                'INSERT INTO ' +
                    quote(temp) +
                    ' (' +
                    writable.join(',') +
                    ') SELECT ' +
                    writable.join(',') +
                    ' FROM ' +
                    quote(edit.table)
            );
            await query('DROP TABLE ' + quote(edit.table));
            await query(
                'ALTER TABLE ' + quote(temp) + ' RENAME TO ' + quote(edit.table)
            );
            for (const object of objects) await query(object.sql);
            if (seq.length)
                await query(
                    'UPDATE sqlite_sequence SET seq=MAX(seq,:seq) WHERE name=:table',
                    { replacements: { seq: seq[0].seq, table: edit.table } }
                );
        }
        for (const object of dependentObjects) await query(object.sql);
        const violations = await query('PRAGMA foreign_key_check');
        if (violations.length)
            throw new Error(
                'Foreign key violations after rebuild: ' +
                    JSON.stringify(violations)
            );
        await query('COMMIT');
        active = false;
    } catch (error) {
        if (active) await query('ROLLBACK');
        throw error;
    } finally {
        try {
            await query('PRAGMA foreign_keys=' + (original ? 'ON' : 'OFF'));
        } finally {
            await sequelize.connectionManager.releaseConnection(connection);
        }
    }
}

module.exports = {
    rebuildTables,
    columnName,
    changeDefinition,
    splitDefinitions,
    removeReference,
};
