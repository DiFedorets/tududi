const request = require('supertest');
const app = require('../../app');
const { Note, NoteFragment, Permission, sequelize } = require('../../models');
const { createTestUser } = require('../helpers/testUtils');
describe('Discussion date and persistent note fragments', () => {
    let user, other, agent, outsider, note;
    beforeEach(async () => {
        user = await createTestUser({ email: 'fragment-owner@test.com' });
        other = await createTestUser({ email: 'fragment-other@test.com' });
        agent = request.agent(app);
        outsider = request.agent(app);
        await agent
            .post('/api/login')
            .send({ email: user.email, password: 'password123' });
        await outsider
            .post('/api/login')
            .send({ email: other.email, password: 'password123' });
        note = await Note.create({
            title: 'Discussion',
            content: 'Before TARGET after. Another TARGET.',
            user_id: user.id,
        });
    });
    async function create(from = 7, to = 13, a = agent, extra = {}) {
        await note.reload();
        return a.post(`/api/note/${note.uid}/fragments`).send({
            from,
            to,
            expected_revision: note.revision,
            expected_content: note.content,
            ...extra,
        });
    }
    const get = (uid, a = agent, n = note.uid) =>
        a.get(`/api/note/${n}/fragments/${uid}`);
    async function patch(data) {
        await note.reload();
        return agent
            .patch(`/api/note/${note.uid}`)
            .send({ ...data, expected_revision: note.revision });
    }
    it('uses editor offsets for Windows newlines without rewriting source text', async () => {
        await note.update({ content: 'Header\r\nTARGET\r\nTail' });
        const f = await create(7, 13, agent, {
            expected_content: 'Header\nTARGET\nTail',
        });
        expect(f.status).toBe(201);
        expect((await get(f.body.uid)).body).toMatchObject({
            state: 'located',
            from: 7,
            to: 13,
            quote: 'TARGET',
        });
        expect((await note.reload()).content).toBe('Header\r\nTARGET\r\nTail');
    });
    it('creates an idempotent link without changing note text, revision or readiness', async () => {
        const before = (await note.reload()).toJSON();
        const a = await create(),
            b = await create();
        expect(a.status).toBe(201);
        expect(b.body.uid).toBe(a.body.uid);
        expect(await NoteFragment.count()).toBe(1);
        expect((await note.reload()).toJSON()).toEqual(before);
        expect((await get(a.body.uid)).body).toMatchObject({
            quote: 'TARGET',
            state: 'located',
            from: 7,
            to: 13,
        });
    });
    it('survives rename and maps inserts/deletes before the quote', async () => {
        const f = await create();
        expect((await patch({ title: 'New name' })).status).toBe(200);
        expect((await get(f.body.uid)).body.state).toBe('located');
        await patch({ content: 'Added ' + note.content });
        expect((await get(f.body.uid)).body.from).toBe(13);
        await note.reload();
        await patch({ content: note.content.slice(6) });
        expect((await get(f.body.uid)).body.from).toBe(7);
    });
    it('keeps the quote when editing only after it', async () => {
        const f = await create();
        await patch({ content: note.content + ' Tail' });
        expect((await get(f.body.uid)).body).toMatchObject({
            state: 'located',
            from: 7,
            to: 13,
        });
    });
    it('marks an edited quote without moving to another matching occurrence', async () => {
        const f = await create();
        await patch({ content: note.content.replace('TARGET', 'changed') });
        expect((await get(f.body.uid)).body).toMatchObject({
            state: 'changed',
            quote: 'TARGET',
            from: null,
            to: null,
        });
    });
    it('does not silently reattach a removed fragment even after identical text returns', async () => {
        const f = await create();
        const original = note.content;
        await patch({ content: note.content.replace('TARGET', '') });
        expect((await get(f.body.uid)).body.state).toBe('changed');
        await patch({ content: original });
        expect((await get(f.body.uid)).body.state).toBe('changed');
    });
    it('rejects stale or unsaved content, invalid/empty/oversized selections', async () => {
        expect(
            (await create(7, 13, agent, { expected_revision: 99 })).status
        ).toBe(409);
        expect(
            (await create(7, 13, agent, { expected_content: 'unsaved' })).status
        ).toBe(409);
        expect((await create(5, 5)).status).toBe(400);
        expect((await create(0, 5000)).status).toBe(400);
        expect((await create(6, 7)).status).toBe(400);
        expect(await NoteFragment.count()).toBe(0);
    });
    it('does not leak fragments through inaccessible or unrelated notes', async () => {
        const f = await create();
        expect((await get(f.body.uid, outsider)).status).toBe(404);
        expect((await create(7, 13, outsider)).status).toBe(404);
        const another = await Note.create({
            title: 'Other',
            content: 'Text',
            user_id: user.id,
        });
        expect((await get(f.body.uid, agent, another.uid)).status).toBe(404);
    });
    it('allows a reader to follow an existing fragment but not create a stored anchor', async () => {
        const f = await create();
        await Permission.create({
            user_id: other.id,
            resource_type: 'note',
            resource_uid: note.uid,
            access_level: 'ro',
            granted_by_user_id: user.id,
        });
        expect((await get(f.body.uid, outsider)).status).toBe(200);
        expect((await create(7, 13, outsider)).status).toBe(404);
    });
    it('returns no fragment or quote when the note is deleted', async () => {
        const f = await create();
        await sequelize.query('PRAGMA foreign_keys=ON');
        try {
            await note.destroy();
            expect((await get(f.body.uid)).status).toBe(404);
            expect(await NoteFragment.count()).toBe(0);
        } finally {
            await sequelize.query('PRAGMA foreign_keys=OFF');
        }
    });
    it('detects raw edits bypassing the tracker and never guesses a location', async () => {
        const f = await create();
        await sequelize.query('UPDATE notes SET content=? WHERE id=?', {
            replacements: [note.content + ' bypassed', note.id],
        });
        expect((await get(f.body.uid)).body.state).toBe('changed');
    });
    it('saves, clears and validates a separate calendar date with CAS', async () => {
        const before = (await note.reload()).toJSON();
        expect((await patch({ discussion_date: '2024-02-29' })).status).toBe(
            200
        );
        await note.reload();
        expect(note.discussion_date).toBe('2024-02-29');
        expect(note.content).toBe(before.content);
        expect(note.record_state).toBe(before.record_state);
        expect((await patch({ discussion_date: '2025-02-29' })).status).toBe(
            400
        );
        expect(
            (
                await agent
                    .patch(`/api/note/${note.uid}`)
                    .send({ discussion_date: '2026-10-23' })
            ).status
        ).toBe(428);
        expect(
            (
                await agent.patch(`/api/note/${note.uid}`).send({
                    discussion_date: '2026-10-23',
                    expected_revision: 999,
                })
            ).status
        ).toBe(409);
        expect((await patch({ discussion_date: null })).status).toBe(200);
        expect((await note.reload()).discussion_date).toBeNull();
    });
    it('creates a date without inferring it from created_at and never sets old dates automatically', async () => {
        expect((await note.reload()).discussion_date).toBeNull();
        const r = await agent.post('/api/note').send({
            title: 'Meeting',
            content: 'Discussion',
            discussion_date: '2026-10-22',
        });
        expect(r.status).toBe(201);
        expect(r.body.discussion_date).toBe('2026-10-22');
    });
    it('rolls body and anchor updates back together on tracker failure', async () => {
        const f = await create();
        const before = note.content;
        const spy = jest
            .spyOn(NoteFragment.prototype, 'update')
            .mockRejectedValueOnce(new Error('tracking failure'));
        try {
            expect((await patch({ content: 'Prefix ' + before })).status).toBe(
                500
            );
        } finally {
            spy.mockRestore();
        }
        expect((await note.reload()).content).toBe(before);
        expect((await get(f.body.uid)).body).toMatchObject({
            state: 'located',
            from: 7,
            to: 13,
        });
    });
});
