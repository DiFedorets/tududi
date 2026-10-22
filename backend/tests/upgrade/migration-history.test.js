const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');
const { BACKEND_DIR } = require('./helpers/fixtures');
const {
    run,
    runPrepare,
    runMigrate,
    sqliteEnv,
    describeResult,
} = require('./helpers/bootstrap');

const pending = '20250116000000-add-first-day-of-week-to-users.js';
const migrations = fs
    .readdirSync(path.join(BACKEND_DIR, 'migrations'))
    .filter((name) => name.endsWith('.js'))
    .sort();

describe('standalone and production migration history', () => {
    let directory, filename, db;
    const query = (sql, params = []) =>
        new Promise((resolve, reject) =>
            db.all(sql, params, (error, rows) =>
                error ? reject(error) : resolve(rows)
            )
        );
    const standalone = () =>
        run('node', ['scripts/db-migrate.js'], sqliteEnv(filename));
    const expectSuccess = (result) => {
        if (result.code !== 0)
            throw new Error(describeResult('migration', result));
    };
    async function journal(table, names) {
        await query(`CREATE TABLE "${table}" (name TEXT PRIMARY KEY NOT NULL)`);
        for (const name of names)
            await query(`INSERT INTO "${table}" VALUES (?)`, [name]);
    }
    async function snapshot() {
        const schema = await query(
            'SELECT name, sql FROM sqlite_master ORDER BY name'
        );
        const rows = {};
        for (const item of schema.filter((item) =>
            item.sql?.startsWith('CREATE TABLE')
        )) {
            rows[item.name] = await query(
                `SELECT * FROM "${item.name}" ORDER BY 1`
            );
        }
        return { schema, rows };
    }
    beforeEach(async () => {
        directory = fs.mkdtempSync(
            path.join(os.tmpdir(), 'tududi-migration-history-')
        );
        filename = path.join(directory, 'test.sqlite3');
        db = new sqlite3.Database(filename);
        await query(
            'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)'
        );
        await query("INSERT INTO users VALUES (1, 'Preserved contact')");
    });
    afterEach(async () => {
        await new Promise((resolve, reject) =>
            db.close((error) => (error ? reject(error) : resolve()))
        );
        fs.rmSync(directory, { recursive: true, force: true });
    });
    it('records a pending migration where production reads it and remains idempotent', async () => {
        await journal(
            'SequelizeMeta',
            migrations.filter((name) => name !== pending)
        );
        expectSuccess(await standalone());
        expect(await query('SELECT first_day_of_week FROM users')).toEqual([
            { first_day_of_week: 1 },
        ]);
        expect(
            (await query('SELECT name FROM SequelizeMeta ORDER BY name')).map(
                (row) => row.name
            )
        ).toEqual(migrations);
        const after = await snapshot();
        expectSuccess(await runMigrate(filename));
        expectSuccess(await standalone());
        expect(await snapshot()).toEqual(after);
        expect(
            (
                await query("SELECT name FROM sqlite_master WHERE type='table'")
            ).map((row) => row.name)
        ).not.toContain('sequelize_meta');
    });
    it('recognizes a migration applied by production without replaying it', async () => {
        await journal(
            'SequelizeMeta',
            migrations.filter((name) => name !== pending)
        );
        expectSuccess(await runMigrate(filename));
        const after = await snapshot();
        expectSuccess(await standalone());
        expect(await snapshot()).toEqual(after);
    });
    it('leaves a redundant legacy journal and all data untouched', async () => {
        await journal('SequelizeMeta', migrations);
        await journal('sequelize_meta', migrations.slice(0, 35));
        const before = await snapshot();
        expectSuccess(await standalone());
        expect(await snapshot()).toEqual(before);
    });
    it.each([false, true])(
        'refuses unverified legacy entries before writes (canonical exists: %s)',
        async (canonicalExists) => {
            if (canonicalExists)
                await journal(
                    'SequelizeMeta',
                    migrations.filter((name) => name !== pending)
                );
            await journal('sequelize_meta', [pending]);
            const before = await snapshot();
            const result = await standalone();
            expect(result.code).not.toBe(0);
            expect(result.stderr).toContain(
                'LEGACY_MIGRATION_HISTORY_REQUIRES_REVIEW'
            );
            expect(await snapshot()).toEqual(before);
            const production = await runPrepare(filename);
            expect(production.code).not.toBe(0);
            expect(production.stderr).toContain(
                'LEGACY_MIGRATION_HISTORY_REQUIRES_REVIEW'
            );
            expect(await snapshot()).toEqual(before);
        }
    );
});
