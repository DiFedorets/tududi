const request = require('supertest');
const app = require('../../app');
const { Task, Note } = require('../../models');
const { createTestUser } = require('../helpers/testUtils');
describe('Native note record types', () => {
    let agent, user;
    beforeEach(async () => {
        user = await createTestUser({ email: 'record-types@example.com' });
        agent = request.agent(app);
        await agent
            .post('/api/login')
            .send({ email: user.email, password: 'password123' });
    });
    const make = async (kind = 'knowledge') => {
        const result = await agent.post('/api/note').send({
            title: 'Saved material',
            content: 'Specific learning or rule',
            record_kind: kind,
        });
        expect(result.status).toBe(201);
        return result.body;
    };
    const patch = (note, values) =>
        agent
            .patch(`/api/note/${note.uid}`)
            .send({ expected_revision: note.revision, ...values });
    it('offers the same subtype and readiness contract through MCP without creating tasks', async () => {
        const tools = [];
        require('../../modules/mcp/tools/noteTools').registerNoteTools(
            null,
            { userId: user.id },
            tools
        );
        const create = tools.find((t) => t.name === 'create_note');
        expect(create.inputSchema.properties.record_kind.enum).toContain(
            'lesson'
        );
        const result = await create.handler({
            title: 'MCP lesson',
            content: 'Lesson text',
            record_kind: 'lesson',
        });
        let note = JSON.parse(result.content[0].text).note;
        expect(note.record_kind).toBe('lesson');
        expect(note.record_state).toBe('draft');
        const update = tools.find((t) => t.name === 'update_note');
        await expect(
            update.handler({
                uid: note.uid,
                expected_revision: note.revision,
                record_state: 'ready',
            })
        ).rejects.toThrow();
        let saved = await update.handler({
            uid: note.uid,
            expected_revision: note.revision,
            application_ref: 'memory#one',
        });
        note = JSON.parse(saved.content[0].text).note;
        saved = await update.handler({
            uid: note.uid,
            expected_revision: note.revision,
            record_state: 'ready',
        });
        expect(JSON.parse(saved.content[0].text).note.record_state).toBe(
            'ready'
        );
        expect(await Task.count()).toBe(0);
    });
    it('stores knowledge as a native Note without a duplicate Task', async () => {
        const before = await Task.count();
        const note = await make();
        expect(note.record_kind).toBe('knowledge');
        expect(note.record_state).toBe('ready');
        expect(await Task.count()).toBe(before);
        expect(await Note.count()).toBe(1);
    });
    it.each(['lesson', 'decision'])(
        '%s requires a saved application address and explicit readiness',
        async (kind) => {
            let note = await make(kind);
            expect(note.record_state).toBe('draft');
            expect((await patch(note, { record_state: 'ready' })).status).toBe(
                400
            );
            expect(
                (
                    await patch(note, {
                        application_ref: 'AGENTS.md#rule',
                        record_state: 'ready',
                    })
                ).status
            ).toBe(400);
            let result = await patch(note, {
                application_ref: 'AGENTS.md#rule',
            });
            expect(result.status).toBe(200);
            note = result.body;
            result = await patch(note, { record_state: 'ready' });
            expect(result.status).toBe(200);
            note = result.body;
            expect(note.record_state).toBe('ready');
            expect(note.ready_at).toBeTruthy();
            // Full-object autosave cannot apply edited material silently.
            result = await patch(note, { ...note, content: 'Changed rule' });
            expect(result.status).toBe(200);
            expect(result.body.record_state).toBe('draft');
            expect(result.body.ready_at).toBeNull();
            expect(result.body.content).toBe('Changed rule');
            expect((await patch(note, { record_state: 'ready' })).status).toBe(
                409
            );
        }
    );
    it.each(['lesson', 'decision'])(
        'cannot create an already applied %s',
        async (kind) => {
            const result = await agent.post('/api/note').send({
                title: 'Rule',
                content: 'Text',
                record_kind: kind,
                record_state: 'ready',
                application_ref: 'memory#1',
            });
            expect(result.status).toBe(400);
            expect(await Note.count()).toBe(0);
        }
    );
    it('requires a revision for metadata and ignores forged readiness timestamps', async () => {
        const note = await make('lesson');
        expect(
            (
                await agent
                    .patch(`/api/note/${note.uid}`)
                    .send({ record_kind: 'decision' })
            ).status
        ).toBe(428);
        const result = await patch(note, {
            ready_at: '2000-01-01',
            application_ref: 'memory#1',
        });
        expect(result.status).toBe(200);
        expect(result.body.ready_at).toBeNull();
    });
    it('keeps incomplete knowledge as a draft and allows clearing saved text', async () => {
        const note = await make();
        const result = await patch(note, { content: '' });
        expect(result.status).toBe(200);
        expect(result.body.record_state).toBe('draft');
        expect(
            (await patch(result.body, { record_state: 'ready' })).status
        ).toBe(400);
    });
    it.each([
        { record_kind: 'task' },
        { record_state: 'applied' },
        { application_ref: 42 },
    ])('rejects malformed metadata %j', async (values) => {
        expect(
            (
                await agent
                    .post('/api/note')
                    .send({ title: 'x', content: 'y', ...values })
            ).status
        ).toBe(400);
    });
});
