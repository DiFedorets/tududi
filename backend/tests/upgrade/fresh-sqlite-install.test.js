const fs = require('fs');
const os = require('os');
const path = require('path');
const { Sequelize } = require('sequelize');
const { migrationFiles, removeTemp } = require('./helpers/fixtures');
const {
    runBootstrap,
    runPrepare,
    run,
    sqliteEnv,
    runUserCreate,
    describeResult,
} = require('./helpers/bootstrap');
const inspect = require('./helpers/sqlite-inspect');
const ensureIndex = require('../../utils/ensure-migration-index');

function success(result) {
    if (result?.code !== 0)
        throw new Error(describeResult('bootstrap', result));
}

describe('fresh SQLite production bootstrap', () => {
    let dir, file;
    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tududi-fresh-'));
        file = path.join(dir, 'new.sqlite3');
        const result = await runBootstrap(file);
        success(result.prepare);
        success(result.migrate);
    });
    afterAll(() => removeTemp(dir));

    it('applies the full migration chain and installs physical constraints', async () => {
        expect(await inspect.metaNames(file)).toEqual(migrationFiles());
        expect(await inspect.integrityCheck(file)).toBe('ok');
        expect(await inspect.foreignKeyCheck(file)).toEqual([]);
        const columns = await inspect.query(file, 'PRAGMA table_info(notes)');
        expect(
            columns.filter((c) => c.name === 'discussion_date')
        ).toHaveLength(1);
        const indexes = await inspect.query(
            file,
            "SELECT name FROM sqlite_master WHERE type='index'"
        );
        for (const name of [
            'task_note_links_pair_type',
            'task_note_links_note',
            'note_fragments_original_selection',
        ]) {
            expect(indexes.filter((i) => i.name === name)).toHaveLength(1);
        }
        const triggers = await inspect.query(
            file,
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'strict_%'"
        );
        expect(triggers).toHaveLength(3);
    });

    it('creates a user and boots again without changing stored rows or schema', async () => {
        success(
            await runUserCreate(
                file,
                'fresh-install@example.invalid',
                'Synthetic-install-test-42!',
                true
            )
        );
        success(
            await run(
                process.execPath,
                [
                    '-e',
                    `
            const assert=require('assert/strict');
            const request=require('supertest');
            const app=require('./app');
            const {User,sequelize}=require('./models');
            const {createApiToken}=require('./modules/users/apiTokenService');
            (async()=>{
                const user=await User.findOne({where:{email:'fresh-install@example.invalid'}});
                const token=(await createApiToken({userId:user.id,name:'install-smoke'})).rawToken;
                const created=await request(app).post('/api/v1/task').set('Authorization','Bearer '+token).send({name:'Synthetic install smoke'});
                assert.equal(created.status,201);
                const changed=await request(app).patch('/api/v1/task/'+created.body.uid).set('Authorization','Bearer '+token).send({due_date:'2032-01-05'});
                assert.equal(changed.status,200);
                await sequelize.close();
                process.exit(0);
            })().catch(()=>process.exit(1));
        `,
                ],
                sqliteEnv(file, { NODE_ENV: 'test' })
            )
        );
        const before = await inspect.snapshot(file);
        const schema = await inspect.query(
            file,
            'SELECT type,name,sql FROM sqlite_master ORDER BY type,name'
        );
        const repeat = await runBootstrap(file);
        success(repeat.prepare);
        success(repeat.migrate);
        success(
            await run(
                process.execPath,
                ['scripts/db-migrate.js'],
                sqliteEnv(file)
            )
        );
        expect(await inspect.snapshot(file)).toEqual(before);
        expect(
            await inspect.query(
                file,
                'SELECT type,name,sql FROM sqlite_master ORDER BY type,name'
            )
        ).toEqual(schema);
    });

    it('also completes an empty installation through the standalone migrator', async () => {
        const standalone = path.join(dir, 'standalone.sqlite3');
        success(await runPrepare(standalone));
        success(
            await run(
                process.execPath,
                ['scripts/db-migrate.js'],
                sqliteEnv(standalone)
            )
        );
        expect(await inspect.metaNames(standalone)).toEqual(migrationFiles());
        expect(await inspect.integrityCheck(standalone)).toBe('ok');
        expect(await inspect.foreignKeyCheck(standalone)).toEqual([]);
    });
});

describe('migration index collision handling', () => {
    let db, q;
    beforeEach(async () => {
        db = new Sequelize({
            dialect: 'sqlite',
            storage: ':memory:',
            logging: false,
        });
        q = db.getQueryInterface();
        await db.query('CREATE TABLE example (a INTEGER, b INTEGER)');
    });
    afterEach(() => db.close());
    it('does not mistake a partial unique index for the full constraint', async () => {
        await db.query(
            'CREATE UNIQUE INDEX example_pair ON example(a,b) WHERE a > 0'
        );
        await expect(
            ensureIndex(q, 'example', ['a', 'b'], {
                name: 'example_pair',
                unique: true,
            })
        ).rejects.toThrow('Incompatible existing index');
    });
    it('preserves the exact named unique index on repeated application', async () => {
        const options = { name: 'example_pair', unique: true };
        await ensureIndex(q, 'example', ['a', 'b'], options);
        await ensureIndex(q, 'example', ['a', 'b'], options);
        expect(
            (await q.showIndex('example')).filter(
                (i) => i.name === options.name
            )
        ).toHaveLength(1);
    });
    it('fails visibly rather than accepting an incompatible same-name index', async () => {
        await q.addIndex('example', ['a'], { name: 'example_pair' });
        await expect(
            ensureIndex(q, 'example', ['a', 'b'], {
                name: 'example_pair',
                unique: true,
            })
        ).rejects.toThrow('Incompatible existing index');
    });
});
