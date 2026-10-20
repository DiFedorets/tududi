const request = require('supertest');
const app = require('../../app');
const { Task, TaskEvent } = require('../../models');
const { createTestUser } = require('../helpers/testUtils');
const { createApiToken } = require('../../modules/users/apiTokenService');
const text = require('../../extensions/one/taskText');

describe('One task text compare-and-set', () => {
    let owner, task, token;
    beforeEach(async () => {
        owner = await createTestUser({ email: 'text-owner@example.com' });
        await owner.update({ one_actor: 'human' });
        task = await Task.create({
            name: 'Original title',
            note: 'Before',
            status: 0,
            user_id: owner.id,
            due_date: '2030-02-01T00:00:00Z',
        });
        token = (
            await createApiToken({
                userId: owner.id,
                name: 'text-conflict-test',
            })
        ).rawToken;
    });
    const patch = (body) =>
        request(app)
            .patch(`/api/v1/task/${task.uid}`)
            .set('Authorization', `Bearer ${token}`)
            .send(body);
    it('requires a read baseline for a One text edit, then accepts the matching source', async () => {
        expect((await patch({ note: 'After' })).status).toBe(428);
        expect(
            (await patch({ note: 'After', expected_fields: { note: 17 } }))
                .status
        ).toBe(400);
        const saved = await patch({
            name: 'New title',
            note: 'After',
            expected_fields: { name: 'Original title', note: 'Before' },
        });
        expect(saved.status).toBe(200);
        expect((await task.reload()).note).toBe('After');
    });
    it('rejects a stale description without changing tags, deadline or events', async () => {
        await task.update({ note: 'Agent changed it' });
        const events = await TaskEvent.count();
        const refused = await patch({
            note: 'Stale draft',
            tags: [{ name: 'must-not-be-created' }],
            due_date: '2030-05-01',
            expected_fields: { note: 'Before' },
        });
        expect(refused.status).toBe(409);
        expect(refused.body.code).toBe('TASK_TEXT_CONFLICT');
        await task.reload();
        expect(task.note).toBe('Agent changed it');
        expect(task.due_date.toISOString()).toBe('2030-02-01T00:00:00.000Z');
        expect(await task.getTags()).toHaveLength(0);
        expect(await TaskEvent.count()).toBe(events);
    });
    it('allows only one of two simultaneous text writes from the same source', async () => {
        const results = await Promise.all(
            ['First writer', 'Second writer'].map((note) =>
                patch({ note, expected_fields: { note: 'Before' } })
            )
        );
        expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
        expect((await task.reload()).note).toBe(
            results.find((x) => x.status === 200).body.note
        );
    });
    it('keeps an independent status change while saving text from an older card', async () => {
        expect((await patch({ status: 1 })).status).toBe(200);
        expect(
            (
                await patch({
                    note: 'Human text',
                    expected_fields: { note: 'Before' },
                })
            ).status
        ).toBe(200);
        expect((await task.reload()).status).toBe(1);
    });
    it('checks the source in the UPDATE itself, after a successful earlier preflight', async () => {
        const input = {
            note: 'Human text',
            expected_fields: { note: 'Before' },
        };
        await text.assertExpected(task, input);
        await Task.update(
            { note: 'Late agent change' },
            { where: { id: task.id } }
        );
        await expect(
            text.update(task, { note: input.note }, input)
        ).rejects.toMatchObject({ code: 'TASK_TEXT_CONFLICT' });
        expect((await task.reload()).note).toBe('Late agent change');
    });
    it('rejects mixed text/recurrence writes before recurrence side effects', async () => {
        const result = await patch({
            note: 'New',
            recurrence_type: 'daily',
            expected_fields: { note: 'Before' },
        });
        expect(result.status).toBe(400);
        expect(result.body.code).toBe('TASK_TEXT_COMPOUND_UPDATE');
        expect((await task.reload()).recurrence_type).toBe('none');
        expect(task.note).toBe('Before');
    });
    it('enforces the same source check through actual MCP, including the description alias', async () => {
        const call = async (args) => {
            const response = await request(app)
                .post('/api/mcp')
                .set('Authorization', `Bearer ${token}`)
                .set('Accept', 'application/json, text/event-stream')
                .send({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: {
                        name: 'update_task',
                        arguments: { id: task.uid, ...args },
                    },
                });
            const line = response.text
                .split('\n')
                .find((x) => x.startsWith('data: '));
            const rpc = line ? JSON.parse(line.slice(6)) : response.body;
            return rpc.result || rpc;
        };
        const missing = await call({ description: 'MCP text' });
        expect(missing.isError).toBe(true);
        expect((await task.reload()).note).toBe('Before');
        const saved = await call({
            description: 'MCP text',
            expected_fields: { note: 'Before' },
        });
        expect(saved.isError).not.toBe(true);
        expect((await task.reload()).note).toBe('MCP text');
        const stale = await call({
            description: 'Stale MCP text',
            expected_fields: { note: 'Before' },
        });
        expect(stale.isError).toBe(true);
        expect((await task.reload()).note).toBe('MCP text');
    });
});
