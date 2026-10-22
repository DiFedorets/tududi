const request = require('supertest');
const app = require('../../app');
const {
    Task,
    Note,
    TaskNoteLink,
    Permission,
    sequelize,
} = require('../../models');
const { createTestUser } = require('../helpers/testUtils');
const history = require('../../extensions/history/service');
describe('Task-note links', () => {
    let owner, outsider, agent, otherAgent, task, note;
    beforeEach(async () => {
        owner = await createTestUser({ email: 'links-owner@test.com' });
        outsider = await createTestUser({ email: 'links-other@test.com' });
        agent = request.agent(app);
        otherAgent = request.agent(app);
        await agent
            .post('/api/login')
            .send({ email: owner.email, password: 'password123' });
        await otherAgent
            .post('/api/login')
            .send({ email: outsider.email, password: 'password123' });
        task = await Task.create({
            name: 'Prepare proposal',
            user_id: owner.id,
            note: '[Existing](https://example.com)',
        });
        note = await Note.create({
            title: 'Discussion',
            content: 'Original text',
            user_id: owner.id,
        });
    });
    const create = (t, n, a, type = 'source') =>
        a
            .post(`/api/task/${t.uid}/note-links`)
            .send({ target_uid: n.uid, type });
    const share = (row, type, access) =>
        Permission.create({
            user_id: outsider.id,
            resource_type: type,
            resource_uid: row.uid,
            access_level: access,
            granted_by_user_id: owner.id,
        });
    it('shows a single source link from both sides and retains texts, dates and revisions', async () => {
        const before = (await task.reload()).toJSON(),
            original = (await note.reload()).toJSON();
        expect((await create(task, note, agent)).status).toBe(201);
        const a = await agent.get(`/api/task/${task.uid}/note-links`);
        const b = await agent.get(`/api/note/${note.uid}/task-links`);
        expect(a.body.links[0]).toMatchObject({
            type: 'source',
            target: { uid: note.uid, title: 'Discussion' },
        });
        expect(b.body.links[0]).toMatchObject({
            type: 'source',
            target: { uid: task.uid, title: 'Prepare proposal' },
        });
        expect(await TaskNoteLink.count()).toBe(1);
        expect((await task.reload()).toJSON()).toEqual(before);
        expect((await note.reload()).toJSON()).toEqual(original);
    });
    it('is idempotent from either endpoint', async () => {
        const a = await create(task, note, agent);
        const b = await agent
            .post(`/api/note/${note.uid}/task-links`)
            .send({ target_uid: task.uid, type: 'source' });
        expect(b.status).toBe(201);
        expect(b.body.uid).toBe(a.body.uid);
        expect(await TaskNoteLink.count()).toBe(1);
    });
    it('supports related links and rejects invalid types without writes', async () => {
        expect((await create(task, note, agent, 'related_to')).status).toBe(
            201
        );
        expect((await create(task, note, agent, 'blocks')).status).toBe(400);
        expect(await TaskNoteLink.count()).toBe(1);
    });
    it('does not disclose inaccessible endpoints or their links', async () => {
        await create(task, note, agent);
        await share(task, 'task', 'rw');
        expect(
            (await otherAgent.get(`/api/task/${task.uid}/note-links`)).body
                .links
        ).toEqual([]);
        expect(
            (await otherAgent.get(`/api/note/${note.uid}/task-links`)).status
        ).toBe(404);
        expect((await create(task, note, otherAgent)).status).toBe(404);
    });
    it('allows read-only viewing but requires write access to both endpoints for changes', async () => {
        const res = await create(task, note, agent);
        await share(task, 'task', 'rw');
        await share(note, 'note', 'ro');
        const rows = await otherAgent.get(`/api/task/${task.uid}/note-links`);
        expect(rows.body.links[0].can_remove).toBe(false);
        expect(
            (await create(task, note, otherAgent, 'related_to')).status
        ).toBe(404);
        expect(
            (
                await otherAgent.delete(
                    `/api/task/${task.uid}/note-links/${res.body.uid}`
                )
            ).status
        ).toBe(404);
    });
    it('survives rename, archive and completion and removes only the link from either side', async () => {
        const res = await create(task, note, agent);
        await task.update({ name: 'Renamed', status: 3 });
        await note.update({ title: 'New title' });
        const rows = await agent.get(`/api/task/${task.uid}/note-links`);
        expect(rows.body.links[0].target.title).toBe('New title');
        expect(
            (
                await agent.delete(
                    `/api/note/${note.uid}/task-links/${res.body.uid}`
                )
            ).status
        ).toBe(204);
        expect(await Task.count()).toBe(1);
        expect(await Note.count()).toBe(1);
        expect(await TaskNoteLink.count()).toBe(0);
    });
    it('cannot delete a link through an unrelated record', async () => {
        const res = await create(task, note, agent);
        const another = await Task.create({ name: 'Other', user_id: owner.id });
        expect(
            (
                await agent.delete(
                    `/api/task/${another.uid}/note-links/${res.body.uid}`
                )
            ).status
        ).toBe(404);
        expect(await TaskNoteLink.count()).toBe(1);
    });
    it('deleting an endpoint cascades only its links and preserves the other endpoint', async () => {
        await create(task, note, agent);
        await sequelize.query('PRAGMA foreign_keys=ON');
        try {
            await note.destroy();
            expect(await TaskNoteLink.count()).toBe(0);
            expect(await Task.count()).toBe(1);
        } finally {
            await sequelize.query('PRAGMA foreign_keys=OFF');
        }
    });
    it('history follows explicit links in both directions without exposing hidden sources', async () => {
        await create(task, note, agent);
        expect(
            (await history.source(owner.id, 'task', task.uid)).related.some(
                (r) => r.uid === note.uid
            )
        ).toBe(true);
        expect(
            (await history.source(owner.id, 'note', note.uid)).related.some(
                (r) => r.uid === task.uid
            )
        ).toBe(true);
        await share(task, 'task', 'ro');
        expect(
            (await history.source(outsider.id, 'task', task.uid)).related.some(
                (r) => r.uid === note.uid
            )
        ).toBe(false);
    });
    it('requires authentication', async () => {
        expect(
            (await request(app).get(`/api/task/${task.uid}/note-links`)).status
        ).toBe(401);
    });
});
