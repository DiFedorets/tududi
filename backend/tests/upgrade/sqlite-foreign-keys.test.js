const fs = require('fs');
const os = require('os');
const path = require('path');
const { Sequelize, QueryTypes } = require('sequelize');
const {
    safeChangeColumn,
    safeRemoveColumn,
} = require('../../utils/migration-utils');
const { rebuildTables } = require('../../utils/sqlite-rebuild');
const repair = require('../../migrations/20261022000001-restore-sqlite-foreign-keys');

describe('SQLite rebuild integrity', () => {
    let db, dir, qi;
    const select = async (sql) => db.query(sql, { type: QueryTypes.SELECT });
    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tududi-fk-'));
        db = new Sequelize({
            dialect: 'sqlite',
            storage: path.join(dir, 'test.sqlite3'),
            logging: false,
        });
        qi = db.getQueryInterface();
        await db.query('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
        await db.query('INSERT INTO parent VALUES (1)');
        await db.query(
            `CREATE TABLE child (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER REFERENCES parent(id) ON DELETE SET NULL ON UPDATE CASCADE, label TEXT NOT NULL DEFAULT 'NOT NULL, original', extra TEXT, CHECK (length(label)>0), UNIQUE(parent_id,label))`
        );
        await db.query(
            'CREATE INDEX child_label ON child(label) WHERE parent_id IS NOT NULL'
        );
        await db.query('CREATE TABLE audit (child_id INTEGER)');
        await db.query('CREATE VIEW child_view AS SELECT id,label FROM child');
        await db.query(
            'CREATE TRIGGER audit_parent AFTER INSERT ON audit BEGIN SELECT id FROM parent; END'
        );
        await db.query(
            'CREATE TRIGGER child_audit AFTER INSERT ON child BEGIN INSERT INTO audit VALUES (NEW.id); END'
        );
        await db.query(
            "INSERT INTO child(id,parent_id,label) VALUES (40,1,'saved')"
        );
        await db.query("INSERT INTO child(id,label) VALUES (99,'deleted')");
        await db.query('DELETE FROM child WHERE id=99');
    });
    afterEach(async () => {
        await db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('preserves FK actions, indexes, triggers, composite uniqueness, checks, defaults and sequence', async () => {
        await safeChangeColumn(qi, 'child', 'label', {
            type: Sequelize.TEXT,
            allowNull: true,
        });
        expect(
            (await select('PRAGMA foreign_key_list(child)'))[0]
        ).toMatchObject({ on_delete: 'SET NULL', on_update: 'CASCADE' });
        expect((await select('PRAGMA foreign_keys'))[0].foreign_keys).toBe(1);
        expect(
            await select(
                "SELECT name FROM sqlite_master WHERE name IN ('child_label','child_audit')"
            )
        ).toHaveLength(2);
        await expect(
            db.query("INSERT INTO child(parent_id,label) VALUES (888,'bad')")
        ).rejects.toThrow();
        await expect(
            db.query("INSERT INTO child(parent_id,label) VALUES (1,'saved')")
        ).rejects.toThrow();
        await expect(
            db.query("INSERT INTO child(label) VALUES ('')")
        ).rejects.toThrow();
        await db.query('INSERT INTO child(parent_id) VALUES (1)');
        const row = (await select('SELECT * FROM child WHERE id>40'))[0];
        expect(
            await select('SELECT id FROM child_view WHERE id=100')
        ).toHaveLength(1);
        expect(row.id).toBe(100);
        expect(row.label).toBe('NOT NULL, original');
        expect(
            await select('SELECT * FROM audit WHERE child_id=100')
        ).toHaveLength(1);
        await db.query('DELETE FROM parent WHERE id=1');
        expect(
            (await select('SELECT parent_id FROM child')).every(
                (r) => r.parent_id === null
            )
        ).toBe(true);
    });

    it('preserves unrelated definitions when removing a column and fails atomically on dependent objects', async () => {
        await safeRemoveColumn(qi, 'child', 'extra');
        expect(
            (await select('PRAGMA table_info(child)')).some(
                (c) => c.name === 'extra'
            )
        ).toBe(false);
        await expect(safeRemoveColumn(qi, 'child', 'label')).rejects.toThrow();
        expect(
            (await select('PRAGMA table_info(child)')).some(
                (c) => c.name === 'label'
            )
        ).toBe(true);
        expect((await select('SELECT label FROM child'))[0].label).toBe(
            'saved'
        );
        expect((await select('PRAGMA foreign_keys'))[0].foreign_keys).toBe(1);
    });

    it('rolls back every table if any rebuild fails and restores enforcement', async () => {
        const before = await select(
            'SELECT name,sql FROM sqlite_master ORDER BY name'
        );
        await expect(
            rebuildTables(qi, [
                {
                    table: 'child',
                    transform: (defs) => [...defs, 'another TEXT'],
                },
                {
                    table: 'parent',
                    transform: (defs) => [...defs, 'invalid invalid invalid ('],
                },
            ])
        ).rejects.toThrow();
        expect(
            await select('SELECT name,sql FROM sqlite_master ORDER BY name')
        ).toEqual(before);
        expect((await select('PRAGMA foreign_keys'))[0].foreign_keys).toBe(1);
    });

    async function missingSchema() {
        await db.query('CREATE TABLE users (id INTEGER PRIMARY KEY)');
        await db.query(
            'CREATE TABLE calendar_tokens (id INTEGER PRIMARY KEY,user_id INTEGER)'
        );
        await db.query('CREATE TABLE people (uid TEXT UNIQUE)');
        await db.query(
            'CREATE TABLE areas (id INTEGER PRIMARY KEY,user_id INTEGER)'
        );
        await db.query(
            'CREATE TABLE goals (id INTEGER PRIMARY KEY,user_id INTEGER,area_id INTEGER)'
        );
        await db.query(
            'CREATE TABLE projects (id INTEGER PRIMARY KEY,user_id INTEGER,area_id INTEGER,goal_id INTEGER,source_template_id INTEGER)'
        );
        await db.query(
            'CREATE TABLE tasks (id INTEGER PRIMARY KEY,user_id INTEGER,project_id INTEGER,area_id INTEGER,goal_id INTEGER,recurring_parent_id INTEGER,parent_task_id INTEGER,assigned_to TEXT)'
        );
        await db.query(
            'CREATE TABLE notes (id INTEGER PRIMARY KEY,user_id INTEGER,project_id INTEGER)'
        );
        await db.query(
            'CREATE TABLE inbox_items (id INTEGER PRIMARY KEY,user_id INTEGER)'
        );
        await db.query(
            'CREATE TABLE oidc_identities (id INTEGER PRIMARY KEY,user_id INTEGER)'
        );
        await db.query('INSERT INTO users VALUES(1)');
        await db.query('INSERT INTO projects(id,user_id) VALUES(1,1)');
        await db.query(
            'INSERT INTO tasks(id,user_id,project_id) VALUES(1,1,1)'
        );
    }
    it('repairs all 19 policy links idempotently, retains optional children, cascades owners and restricts template deletion', async () => {
        await missingSchema();
        await repair.up(qi);
        await repair.up(qi);
        let count = 0;
        for (const t of [
            'calendar_tokens',
            'areas',
            'goals',
            'projects',
            'tasks',
            'notes',
            'inbox_items',
            'oidc_identities',
        ])
            count += (await select('PRAGMA foreign_key_list(' + t + ')'))
                .length;
        expect(count).toBe(19);
        for (const table of [
            'calendar_tokens',
            'areas',
            'goals',
            'projects',
            'tasks',
            'notes',
            'inbox_items',
            'oidc_identities',
        ]) {
            for (const fk of await select(
                'PRAGMA foreign_key_list(' + table + ')'
            )) {
                expect(fk.on_update).toBe(
                    fk.from === 'source_template_id' ? 'NO ACTION' : 'CASCADE'
                );
                expect(fk.on_delete).toBe(
                    fk.from === 'user_id'
                        ? 'CASCADE'
                        : fk.from === 'source_template_id'
                          ? 'NO ACTION'
                          : 'SET NULL'
                );
            }
        }

        await expect(
            db.query('UPDATE tasks SET project_id=999 WHERE id=1')
        ).rejects.toThrow();
        await db.query('DELETE FROM projects WHERE id=1');
        expect(
            (await select('SELECT project_id FROM tasks'))[0].project_id
        ).toBeNull();
        await db.query('INSERT INTO projects(id,user_id) VALUES(2,1)');
        await db.query(
            'INSERT INTO projects(id,user_id,source_template_id) VALUES(3,1,2)'
        );
        await expect(
            db.query('DELETE FROM projects WHERE id=2')
        ).rejects.toThrow();
        await db.query('DELETE FROM users WHERE id=1');
        expect(await select('SELECT * FROM tasks')).toHaveLength(0);
        expect(await select('PRAGMA foreign_key_check')).toEqual([]);
    });
    it('makes schema parity detect a missing FK while accepting SQLite identifier case', () => {
        const { diffSnapshots } = require('./helpers/schema');
        const fk = { from: 'user_id', table: 'Users', to: 'id' };
        const snapshot = (foreignKeys) => ({
            dialect: 'sqlite',
            tables: { tasks: { columns: {}, indexes: [], foreignKeys } },
        });
        expect(diffSnapshots(snapshot([fk]), snapshot([])).hard).toHaveLength(
            1
        );
        expect(
            diffSnapshots(snapshot([fk]), snapshot([{ ...fk, table: 'users' }]))
                .hard
        ).toEqual([]);
    });
    it('requires backup restoration for downgrade instead of silently removing protection', async () => {
        await expect(repair.down(qi)).rejects.toThrow(
            'Restore the verified pre-migration database backup'
        );
    });
    it('refuses orphan data before modifying schema or rows', async () => {
        await missingSchema();
        await db.query('UPDATE tasks SET project_id=999');
        const before = await select(
            'SELECT name,sql FROM sqlite_master ORDER BY name'
        );
        await expect(repair.up(qi)).rejects.toThrow(
            'Orphan references: tasks.project_id'
        );
        expect(
            await select('SELECT name,sql FROM sqlite_master ORDER BY name')
        ).toEqual(before);
        expect(
            (await select('SELECT project_id FROM tasks'))[0].project_id
        ).toBe(999);
    });
});
