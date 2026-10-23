// Run only against an explicitly supplied disposable copy; never sync/clear DB.
const assert = require('assert/strict');
assert.equal(process.env.ISSUE11_DISPOSABLE, 'yes');
assert(
    process.env.DB_FILE?.startsWith('/audit/'),
    'Use only a mounted /audit/ disposable copy'
);
const request = require('supertest');
const moment = require('moment-timezone');
const app = require('../../app');
const { Task, RecurringCompletion, sequelize } = require('../../models');
const { createTestUser } = require('../helpers/testUtils');
const { createApiToken } = require('../../modules/users/apiTokenService');
const planning = require('../../extensions/one/planning');
const daily = require('../../modules/daily-plan/service');
const {
    completeOccurrence,
} = require('../../modules/tasks/operations/recurring');
const Q = require('sequelize').QueryTypes;
const results = [];
let user, token;
const day = (t) =>
    t.due_date
        ? moment(t.due_date).tz('Asia/Yekaterinburg').format('YYYY-MM-DD')
        : null;
async function state(task) {
    await task.reload();
    const p = await planning.read(user.id, task.uid);
    const items = await sequelize.query(
        'SELECT d.plan_date,i.start_minute,i.duration_minutes FROM daily_plan_items i JOIN daily_plans d ON d.id=i.daily_plan_id WHERE i.task_id=:id ORDER BY d.plan_date',
        { replacements: { id: task.id }, type: Q.SELECT }
    );
    return {
        native: day(task),
        status: task.status,
        planned: p.planned,
        week: p.week,
        moves: p.moves,
        last: p.last_planned,
        revision: p.revision,
        items,
    };
}
async function task(name, extra = {}) {
    return Task.create({ name, user_id: user.id, ...extra });
}
const patch = (t, body) =>
    request(app)
        .patch('/api/v1/task/' + t.uid)
        .set('Authorization', 'Bearer ' + token)
        .send(body);
async function mcpTool(name, args) {
    const r = await request(app)
        .post('/api/mcp')
        .set('Authorization', 'Bearer ' + token)
        .set('Accept', 'application/json, text/event-stream')
        .send({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: args },
        });
    const line = r.text.split('\n').find((l) => l.startsWith('data: '));
    const result = line ? JSON.parse(line.slice(6)).result : r.body.result;
    if (result?.isError) throw new Error('MCP_CONFLICT');
    assert(result, 'Missing MCP result');
    return result;
}
const mcp = (t, planned, revision) =>
    mcpTool('one_schedule', {
        task_uid: t.uid,
        planned,
        expected_revision: revision,
    });
async function adapter(t, p, planned, values = {}) {
    const { spawn } = require('child_process');
    const input = {
        command: 'apply',
        operations: [
            {
                uid: t.uid,
                values,
                expected_plan: {
                    planned: p.planned,
                    week: p.week,
                    moves: p.moves,
                    revision: p.revision,
                },
                plan: { planned, week: null, moves: p.moves + 1 },
                operation_id: 'synthetic-audit-' + Date.now(),
            },
        ],
    };
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            ['/audit/adapter.disposable.cjs'],
            { env: process.env }
        );
        let out = '',
            err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.on('error', reject);
        child.on('close', (code) => {
            try {
                assert.equal(code, 0, err);
                const result = JSON.parse(out).results[0];
                if (!result.ok) reject(new Error(result.error));
                else resolve(result);
            } catch (e) {
                reject(e);
            }
        });
        child.stdin.end(JSON.stringify(input));
    });
}
async function scenario(name, fn) {
    try {
        await fn();
        results.push({ name, pass: true });
    } catch (e) {
        results.push({ name, pass: false, error: e.code || e.message });
    }
}
(async () => {
    assert.equal(sequelize.getDialect(), 'sqlite');
    await sequelize.query('PRAGMA foreign_keys=ON');
    const tables = await sequelize.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        { type: Q.SELECT }
    );
    const original = {};
    for (const { name } of tables) {
        original[name] = (
            await sequelize.query(
                'SELECT * FROM "' + name.replace(/"/g, '""') + '"',
                { type: Q.SELECT }
            )
        ).map((r) => JSON.stringify(r));
    }
    user = await createTestUser({
        email: 'issue11-' + Date.now() + '@example.invalid',
        timezone: 'Asia/Yekaterinburg',
        one_actor: 'human',
    });
    token = (
        await createApiToken({ userId: user.id, name: 'issue11-disposable' })
    ).rawToken;
    const fs = require('fs');
    fs.writeFileSync(
        '/audit/adapter.disposable.cjs',
        fs
            .readFileSync('/audit/adapter.original.private.cjs', 'utf8')
            .replaceAll('user_id:1', 'user_id:' + user.id)
            .replaceAll(
                '/app/backend/node_modules/sequelize',
                '/app/node_modules/sequelize'
            )
    );
    await scenario(
        'recurrence direct service: next occurrence keeps planning aligned',
        async () => {
            const t = await task('Synthetic recurrence service', {
                recurrence_type: 'daily',
                recurrence_interval: 1,
                completion_based: false,
            });
            await planning.set(user, t.uid, {
                planned: '2032-01-05',
                expected_revision: 0,
            });
            const before = await state(t);
            await completeOccurrence(t, {
                timezone: user.timezone,
                userId: user.id,
            });
            const after = await state(t);
            results.push({
                observation: 'recurrence-direct',
                before,
                after,
                completionRows: await RecurringCompletion.count({
                    where: { task_id: t.id },
                }),
            });
            assert.equal(
                after.native,
                after.planned,
                'Next occurrence and OnePlan diverged'
            );
        }
    );
    await scenario('recurrence via REST completion and reopening', async () => {
        const t = await task('Synthetic recurrence REST', {
            recurrence_type: 'daily',
            recurrence_interval: 1,
            completion_based: false,
        });
        await planning.set(user, t.uid, {
            planned: '2032-01-05',
            expected_revision: 0,
        });
        const r = await patch(t, { status: 2 });
        assert.equal(r.status, 200);
        const after = await state(t);
        await patch(t, { status: 0 });
        const reopened = await state(t);
        results.push({
            observation: 'recurrence-rest',
            after,
            reopened,
            completionRows: await RecurringCompletion.count({
                where: { task_id: t.id },
            }),
        });
        assert.equal(
            after.native,
            after.planned,
            'REST completion diverged from OnePlan'
        );
        assert.deepEqual(after, reopened);
    });
    await scenario(
        'actual MCP complete_task keeps recurrence plans aligned',
        async () => {
            const t = await task('Synthetic recurrence MCP', {
                recurrence_type: 'daily',
                recurrence_interval: 1,
                completion_based: false,
            });
            await planning.set(user, t.uid, {
                planned: '2032-01-05',
                expected_revision: 0,
            });
            await mcpTool('complete_task', { id: t.uid });
            const after = await state(t);
            results.push({
                observation: 'recurrence-mcp',
                after,
                completionRows: await RecurringCompletion.count({
                    where: { task_id: t.id },
                }),
            });
            assert.equal(
                after.native,
                after.planned,
                'MCP next occurrence and OnePlan diverged'
            );
        }
    );
    await scenario('occurrence child does not move series', async () => {
        const parent = await task('Synthetic series', {
            recurrence_type: 'daily',
            due_date: '2032-01-05T07:00:00Z',
        });
        const child = await task('Synthetic occurrence', {
            recurring_parent_id: parent.id,
            due_date: '2032-01-05T07:00:00Z',
        });
        const before = day(parent);
        assert.equal(
            (await patch(child, { due_date: '2032-01-07' })).status,
            200
        );
        await parent.reload();
        assert.equal(day(parent), before);
    });
    for (const pair of [
        ['rest', 'mcp'],
        ['rest', 'day'],
        ['mcp', 'day'],
        ['mcp', 'mcp'],
        ['rest', 'rest'],
        ['rest', 'adapter'],
        ['mcp', 'adapter'],
        ['day', 'adapter'],
    ]) {
        await scenario('race ' + pair.join(' vs '), async () => {
            for (let round = 0; round < 3; round++) {
                const t = await task(
                    'Synthetic race ' + pair.join('-') + round
                );
                await planning.set(user, t.uid, {
                    planned: '2032-01-05',
                    expected_revision: 0,
                });
                const p = await planning.read(user.id, t.uid);
                const d = await daily.getPlan(user, '2032-01-08');
                const operation = (kind, index) =>
                    kind === 'rest'
                        ? patch(t, {
                              due_date: '2032-01-0' + (6 + index),
                              expected_due_date: '2032-01-05',
                          }).then((r) => {
                              if (r.status !== 200)
                                  throw new Error('HTTP_' + r.status);
                              return r.status;
                          })
                        : kind === 'mcp'
                          ? mcp(t, '2032-01-0' + (6 + index), p.revision)
                          : kind === 'adapter'
                            ? adapter(t, p, '2032-01-09')
                            : daily.replaceItems(
                                  user,
                                  '2032-01-08',
                                  [
                                      {
                                          task_uid: t.uid,
                                          start_minute: 600,
                                          duration_minutes: 45,
                                      },
                                  ],
                                  d.plan?.revision || 0,
                                  d.one_revision
                              );
                const out = await Promise.allSettled(pair.map(operation));
                const after = await state(t);
                results.push({
                    observation: 'race',
                    pair,
                    round,
                    outcomes: out.map((r) =>
                        r.status === 'fulfilled'
                            ? 'success'
                            : r.reason.code || r.reason.message
                    ),
                    after,
                });
                assert.equal(
                    out.filter((r) => r.status === 'fulfilled').length,
                    1,
                    'Expected one winner'
                );
                assert.equal(after.native, after.planned);
                assert.equal(after.moves, 1);
                assert.equal(
                    after.items.filter((i) => i.plan_date >= '2032-01-01')
                        .length,
                    1
                );
            }
        });
    }
    await scenario(
        'older empty-day editor snapshot rejects newer adapter day choice',
        async () => {
            const t = await task('Synthetic adapter epoch');
            const p = await planning.set(user, t.uid, {
                planned: '2032-01-05',
                expected_revision: 0,
            });
            const old = await daily.getPlan(user, '2032-01-10');
            await adapter(t, p, '2032-01-09');
            const adapterAfter = await state(t);
            let rejected = false;
            try {
                await daily.replaceItems(
                    user,
                    '2032-01-10',
                    [{ task_uid: t.uid }],
                    old.plan?.revision || 0,
                    old.one_revision
                );
            } catch (e) {
                rejected = true;
            }
            results.push({
                observation: 'stale-day-after-adapter',
                oldDayRevision: old.plan?.revision || 0,
                oldEpoch: old.one_revision,
                adapterAfter,
                afterStaleSave: await state(t),
                rejected,
            });
            assert(rejected, 'Stale empty-day snapshot overwrote adapter date');
        }
    );
    await scenario(
        'ended recurring series can really reopen without losing its plan',
        async () => {
            const t = await task('Synthetic ended series', {
                recurrence_type: 'daily',
                recurrence_interval: 1,
                recurrence_end_date: '2032-01-05',
            });
            await planning.set(user, t.uid, {
                planned: '2032-01-05',
                expected_revision: 0,
            });
            assert.equal((await patch(t, { status: 2 })).status, 200);
            const completed = await state(t);
            assert.equal(completed.status, 2);
            assert.equal((await patch(t, { status: 0 })).status, 200);
            const reopened = await state(t);
            assert.equal(reopened.status, 0);
            assert.equal(reopened.planned, completed.planned);
            assert.equal(reopened.moves, completed.moves);
        }
    );
    await scenario(
        'adapter wins first: stale REST and MCP do not overwrite it',
        async () => {
            const t = await task('Synthetic adapter first');
            const p = await planning.set(user, t.uid, {
                planned: '2032-01-05',
                expected_revision: 0,
            });
            await adapter(t, p, '2032-01-09');
            const before = await state(t);
            assert.equal(
                (
                    await patch(t, {
                        due_date: '2032-01-06',
                        expected_due_date: '2032-01-05',
                    })
                ).status,
                409
            );
            await assert.rejects(mcp(t, '2032-01-07', p.revision));
            assert.deepEqual(await state(t), before);
        }
    );
    await scenario(
        'stale adapter rolls back both task text and plan',
        async () => {
            const t = await task('Synthetic adapter rollback');
            const name = t.name;
            const p = await planning.set(user, t.uid, {
                planned: '2032-01-05',
                expected_revision: 0,
            });
            await patch(t, {
                due_date: '2032-01-06',
                expected_due_date: '2032-01-05',
            });
            const before = await state(t);
            await assert.rejects(
                adapter(t, p, '2032-01-09', {
                    name: 'Synthetic must roll back',
                }),
                /STALE_PLAN/
            );
            assert.deepEqual(await state(t), before);
            assert.equal(t.name, name);
        }
    );
    await scenario(
        'stale empty-day snapshot cannot replace a newer week from MCP',
        async () => {
            const t = await task('Synthetic stale week');
            await planning.set(user, t.uid, {
                planned: '2032-01-05',
                expected_revision: 0,
            });
            const old = await daily.getPlan(user, '2032-01-11');
            const p = await planning.read(user.id, t.uid);
            await mcpTool('one_schedule', {
                task_uid: t.uid,
                week: '2032-01-05',
                expected_revision: p.revision,
            });
            const before = await state(t);
            await assert.rejects(
                daily.replaceItems(
                    user,
                    '2032-01-11',
                    [{ task_uid: t.uid }],
                    old.plan?.revision || 0,
                    old.one_revision
                )
            );
            assert.deepEqual(await state(t), before);
        }
    );
    await scenario(
        'stale time-only snapshot cannot erase a newer due time',
        async () => {
            const t = await task('Synthetic stale time');
            await patch(t, { due_date: '2032-01-05', due_time: '10:30' });
            assert.equal(
                (
                    await patch(t, {
                        due_date: '2032-01-06',
                        expected_due_date: '2032-01-05',
                        expected_due_time: null,
                    })
                ).status,
                409
            );
            const s = await state(t);
            assert.equal(s.native, '2032-01-05');
            assert.equal(s.moves, 0);
            assert.equal(t.due_has_time, true);
        }
    );
    await scenario(
        'stale clear and week cannot overwrite newer native date',
        async () => {
            const t = await task('Synthetic stale clear');
            const p = await planning.set(user, t.uid, {
                planned: '2032-01-05',
                expected_revision: 0,
            });
            await patch(t, {
                due_date: '2032-01-06',
                expected_due_date: '2032-01-05',
            });
            for (const input of [{ planned: null }, { week: '2032-01-05' }]) {
                await assert.rejects(
                    planning.set(user, t.uid, {
                        ...input,
                        expected_revision: p.revision,
                    })
                );
            }
            assert.equal((await state(t)).planned, '2032-01-06');
            assert.equal((await state(t)).moves, 1);
        }
    );
    await scenario(
        'retry after successful REST move does not double count',
        async () => {
            const t = await task('Synthetic retry');
            await planning.set(user, t.uid, {
                planned: '2032-01-05',
                expected_revision: 0,
            });
            const body = {
                due_date: '2032-01-06',
                expected_due_date: '2032-01-05',
            };
            assert.equal((await patch(t, body)).status, 200);
            assert.equal((await patch(t, body)).status, 409);
            assert.equal((await state(t)).moves, 1);
        }
    );
    await scenario(
        'explicit no-CAS REST path is last writer wins',
        async () => {
            const t = await task('Synthetic no CAS');
            await planning.set(user, t.uid, {
                planned: '2032-01-05',
                expected_revision: 0,
            });
            await patch(t, { due_date: '2032-01-06' });
            await patch(t, { due_date: '2032-01-07' });
            const s = await state(t);
            assert.equal(s.native, '2032-01-07');
            assert.equal(s.moves, 2);
            results.push({ observation: 'no-CAS', after: s });
        }
    );
    const changed = [];
    for (const { name } of tables) {
        const now = new Set(
            (
                await sequelize.query(
                    'SELECT * FROM "' + name.replace(/"/g, '""') + '"',
                    { type: Q.SELECT }
                )
            ).map((r) => JSON.stringify(r))
        );
        if (original[name].some((row) => !now.has(row))) changed.push(name);
    }
    results.push({
        existingRowsChanged: changed,
        foreignKeyErrors: (
            await sequelize.query('PRAGMA foreign_key_check', {
                type: Q.SELECT,
            })
        ).length,
        integrity: await sequelize.query('PRAGMA integrity_check', {
            type: Q.SELECT,
        }),
    });
    require('fs').writeFileSync(
        '/audit/results.json',
        JSON.stringify(results, null, 2)
    );
    console.log(
        JSON.stringify(results.filter((r) => r.name || r.existingRowsChanged))
    );
    await sequelize.close();
    process.exit(results.some((r) => r.pass === false) ? 2 : 0);
})().catch((e) => {
    console.error(e.stack);
    process.exit(1);
});
