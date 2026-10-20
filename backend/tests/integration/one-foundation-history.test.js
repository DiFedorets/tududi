const request = require('supertest');
const app = require('../../app');
const {
    Project,
    Task,
    Note,
    Comment,
    TaskRelation,
    TaskEvent,
    DailyPlan,
    DailyPlanItem,
    Permission,
    Role,
} = require('../../models');
const { createTestUser } = require('../helpers/testUtils');
const notes = require('../../modules/notes/service');
const history = require('../../extensions/history/service');
const {
    exportUserData,
    importUserData,
} = require('../../services/userDataTransfer');
const { createApiToken } = require('../../modules/users/apiTokenService');

describe('One foundation and history', () => {
    let owner, reader, outsider, project;
    beforeEach(async () => {
        owner = await createTestUser({ email: 'owner-one@example.com' });
        reader = await createTestUser({ email: 'reader-one@example.com' });
        outsider = await createTestUser({ email: 'outsider-one@example.com' });
        project = await Project.create({
            name: 'Общий проект',
            user_id: owner.id,
        });
        await Permission.create({
            user_id: reader.id,
            resource_type: 'project',
            resource_uid: project.uid,
            access_level: 'rw',
            status: 'accepted',
            propagation: 'subtree',
            granted_by_user_id: owner.id,
        });
    });
    it('rejects a stale editor save and preserves the new body; permits a refreshed save', async () => {
        const note = await notes.create(owner.id, {
            title: 'Исходная',
            content: 'baseline',
            project_uid: project.uid,
        });
        const newer = await notes.update(reader.id, note.uid, {
            content: 'ответ агента',
            expected_revision: note.revision,
        });
        await expect(
            notes.update(owner.id, note.uid, {
                title: 'Новый заголовок',
                content: 'baseline',
                expected_revision: note.revision,
            })
        ).rejects.toMatchObject({ statusCode: 409 });
        expect((await notes.getByUid(note.uid)).content).toBe('ответ агента');
        await expect(
            notes.update(owner.id, note.uid, { content: 'unversioned' })
        ).rejects.toMatchObject({ statusCode: 428 });
        const saved = await notes.update(owner.id, note.uid, {
            title: 'Объединённая',
            expected_revision: newer.revision,
        });
        expect(saved.content).toBe('ответ агента');
        expect(saved.revision).toBe(newer.revision + 1);
    });
    it('commits two fresh tags together and rolls back the note on an invalid tag', async () => {
        const note = await notes.create(owner.id, {
            title: 'Атомарная',
            content: 'текст',
            tags: ['новая-один', 'новая-два'],
        });
        expect(note.Tags.map((tag) => tag.name).sort()).toEqual(
            ['новая-два', 'новая-один'].sort()
        );
        const before = await Note.count();
        await expect(
            notes.create(owner.id, {
                title: 'Не должна остаться',
                tags: ['x'.repeat(300)],
            })
        ).rejects.toThrow();
        expect(await Note.count()).toBe(before);
    });
    it('finds Cyrillic text and archived comments, follows links, and enforces current shares', async () => {
        const task = await Task.create({
            name: '#262 спросить Антона',
            note: 'Витамин и Сахалин — вопрос, не подтверждение отправки',
            status: 2,
            user_id: owner.id,
            project_id: project.id,
        });
        const meeting = await Task.create({
            name: 'Встреча 15.10',
            note: '21:24 Витамин: проводим аудит\n22:43 Сахалин: отправлю концепцию',
            user_id: owner.id,
            project_id: project.id,
        });
        await TaskRelation.create({
            source_task_id: task.id,
            target_task_id: meeting.id,
            relation_type: 'related_to',
        });
        const comment = await Comment.create({
            task_id: task.id,
            user_id: reader.id,
            body: 'Урбан Скетч: обсуждали отличие подхода',
        });
        const note = await notes.create(owner.id, {
            title: 'САХАЛИН',
            content: `Полный протокол ${'/task/' + task.uid}`,
            project_uid: project.uid,
        });
        await notes.create(outsider.id, {
            title: 'Сахалин секретный',
            content: 'Чужая закрытая заметка',
        });
        const result = await history.search(reader.id, {
            query: 'витамин и сахалин',
        });
        expect(result.results.map((row) => row.uid)).toEqual(
            expect.arrayContaining([task.uid, meeting.uid, note.uid])
        );
        expect(
            result.results.some((row) => row.title.includes('секретный'))
        ).toBe(false);
        expect(
            (
                await history.search(reader.id, { query: 'урбан скетч' })
            ).results.some((row) => row.uid === comment.uid)
        ).toBe(true);
        const source = await history.source(reader.id, 'task', task.uid);
        expect(source.related.map((row) => row.uid)).toEqual(
            expect.arrayContaining([meeting.uid, comment.uid, note.uid])
        );
        const token = (
            await createApiToken({
                userId: reader.id,
                name: 'history integration',
                expiresAt: null,
            })
        ).rawToken;
        const response = await request(app)
            .get('/api/extensions/history/search?query=САХАЛИН')
            .set('Authorization', `Bearer ${token}`);
        expect(response.status).toBe(200);
        expect(response.body.results.some((row) => row.uid === note.uid)).toBe(
            true
        );
        const registry = [];
        require('../../modules/mcp/toolRegistry').registerAllTools(
            {},
            { userId: reader.id, user: reader },
            registry
        );
        const tool = registry.find((entry) => entry.name === 'search_history');
        const toolResponse = JSON.parse(
            (await tool.handler({ query: 'САХАЛИН' })).content[0].text
        );
        expect(toolResponse.results.map((row) => row.uid)).toEqual(
            response.body.results.map((row) => row.uid)
        );
        await Permission.destroy({ where: { user_id: reader.id } });
        expect(
            (await history.search(reader.id, { query: 'Сахалин' })).total
        ).toBe(0);
        await expect(
            history.source(reader.id, 'note', note.uid)
        ).rejects.toThrow('Source not found');
    });
    it('lets the project owner discover and plan guest-created work while blocking outsiders', async () => {
        const task = await Task.create({
            name: 'Создал агент Сахалин',
            user_id: reader.id,
            project_id: project.id,
        });
        await notes.create(reader.id, {
            title: 'Сахалин от агента',
            content: 'Текст общего проекта',
            project_uid: project.uid,
        });
        expect(
            (await history.search(owner.id, { query: 'Сахалин' })).total
        ).toBe(2);
        const plan =
            await require('../../modules/daily-plan/service').replaceItems(
                owner,
                '2026-10-20',
                [{ task_uid: task.uid }]
            );
        expect(plan.plan.items[0].task_uid).toBe(task.uid);
        expect(
            (await history.search(outsider.id, { query: 'Сахалин' })).total
        ).toBe(0);
    });
    it('uses only permitted sources in the model request, cites their links and handles an empty answer', async () => {
        const ai = require('../../modules/ai-assistant/service');
        await Task.create({
            name: 'Витамин',
            note: '21:24 обсуждали аудит',
            user_id: owner.id,
        });
        await notes.create(outsider.id, {
            title: 'Витамин секретный',
            content: 'DO NOT SEND PRIVATE',
        });
        jest.spyOn(ai, 'getOpenAIClient').mockResolvedValue({});
        jest.spyOn(ai, 'getAIModel').mockResolvedValue('test-model');
        const call = jest.spyOn(ai, 'callWithFallback').mockResolvedValue({
            choices: [
                {
                    message: {
                        content: 'Обсуждали аудит [источник](/task/test).',
                    },
                },
            ],
        });
        const response =
            await require('../../extensions/history/answer').answer(
                owner.id,
                'Витамин'
            );
        expect(response.answer).toContain('аудит');
        expect(JSON.stringify(call.mock.calls[0])).not.toContain(
            'DO NOT SEND PRIVATE'
        );
        expect(JSON.stringify(call.mock.calls[0])).toContain('21:24');
        expect(response.sources).toHaveLength(1);
        call.mockResolvedValue({ choices: [{ message: { content: '' } }] });
        await expect(
            require('../../extensions/history/answer').answer(
                owner.id,
                'Витамин'
            )
        ).rejects.toMatchObject({ statusCode: 502 });
    });
    it('round-trips comments with replies, relations, events, and plan references using remapped UIDs', async () => {
        const first = await Task.create({
            name: 'Первая',
            user_id: owner.id,
            project_id: project.id,
        });
        const second = await Task.create({ name: 'Вторая', user_id: owner.id });
        const parent = await Comment.create({
            user_id: owner.id,
            task_id: first.id,
            body: 'Вопрос?',
        });
        await Comment.create({
            user_id: owner.id,
            task_id: first.id,
            parent_comment_id: parent.id,
            body: 'Ответ',
        });
        await TaskRelation.create({
            source_task_id: first.id,
            target_task_id: second.id,
            relation_type: 'blocks',
        });
        await TaskEvent.create({
            user_id: owner.id,
            task_id: first.id,
            event_type: 'created',
            new_value: { name: 'Первая' },
        });
        const plan = await DailyPlan.create({
            user_id: owner.id,
            plan_date: '2026-10-20',
        });
        await DailyPlanItem.create({
            daily_plan_id: plan.id,
            task_id: first.id,
            start_minute: 600,
            duration_minutes: 45,
        });
        const backup = await exportUserData(owner.id);
        // Personal restore alongside source: original numeric ids must never be reused.
        const stats = await importUserData(outsider.id, {
            ...backup,
            instance: undefined,
        });
        expect(stats.history.comments).toBe(2);
        expect(stats.history.relations).toBe(1);
        expect(stats.history.plans).toBe(1);
        const restored = await Task.findOne({
            where: { user_id: outsider.id, name: 'Первая' },
        });
        expect(restored.id).not.toBe(first.id);
        const comments = await Comment.findAll({
            where: { task_id: restored.id },
        });
        expect(comments.map((row) => row.body).sort()).toEqual(
            ['Вопрос?', 'Ответ'].sort()
        );
        expect(
            comments.find((row) => row.body === 'Ответ').parent_comment_id
        ).toBe(comments.find((row) => row.body === 'Вопрос?').id);
        expect(await TaskEvent.count({ where: { task_id: restored.id } })).toBe(
            1
        );
        const restoredPlan = await DailyPlan.findOne({
            where: { user_id: outsider.id },
        });
        expect(
            (
                await DailyPlanItem.findOne({
                    where: { daily_plan_id: restoredPlan.id },
                })
            ).task_id
        ).toBe(restored.id);
        expect(restored.project_id).not.toBe(project.id);
    });
    it('restores a complete instance with collaborator authors, identical events and foreign-owned project links', async () => {
        await Role.destroy({ where: { user_id: owner.id } });
        await Role.create({ user_id: owner.id, is_admin: true, role: 'admin' });
        const task = await Task.create({
            name: 'Задача агента',
            user_id: reader.id,
            project_id: project.id,
        });
        const note = await notes.create(reader.id, {
            title: 'Заметка агента',
            content: 'Сохраняем автора',
            project_uid: project.uid,
        });
        await Comment.create({
            user_id: owner.id,
            task_id: task.id,
            body: 'Комментарий хозяина',
        });
        const when = new Date('2026-10-15T12:00:00Z');
        for (let i = 0; i < 2; i++)
            await TaskEvent.create({
                user_id: reader.id,
                task_id: task.id,
                event_type: 'created',
                created_at: when,
                new_value: { test: true },
            });
        const plan = await DailyPlan.create({
            user_id: owner.id,
            plan_date: '2026-10-20',
        });
        await DailyPlanItem.create({
            daily_plan_id: plan.id,
            task_id: task.id,
            duration_minutes: 60,
        });
        const backup = await exportUserData(owner.id);
        expect(backup.instance).toBeDefined();
        await importUserData(owner.id, backup);
        expect(await TaskEvent.count({ where: { task_id: task.id } })).toBe(2);
        const erase =
            require('../../services/accountErasureService').eraseUserAccount;
        const fresh = await createTestUser({ email: 'fresh-one@example.com' });
        await Role.destroy({ where: { user_id: fresh.id } });
        await Role.create({ user_id: fresh.id, is_admin: true, role: 'admin' });
        await erase(reader.id);
        await erase(outsider.id);
        await erase(owner.id);
        await importUserData(fresh.id, backup);
        const restoredTask = await Task.findOne({ where: { uid: task.uid } });
        const restoredProject = await Project.findOne({
            where: { uid: project.uid },
        });
        expect(restoredTask.project_id).toBe(restoredProject.id);
        expect(
            (await Note.findOne({ where: { uid: note.uid } })).project_id
        ).toBe(restoredProject.id);
        const comment = await Comment.findOne({
            where: { task_id: restoredTask.id },
        });
        expect(comment.body).toBe('Комментарий хозяина');
        expect(comment.user_id).toBe(fresh.id);
        expect(
            await TaskEvent.count({ where: { task_id: restoredTask.id } })
        ).toBe(2);
        const restoredPlan = await DailyPlan.findOne({
            where: { user_id: fresh.id },
        });
        expect(
            (
                await DailyPlanItem.findOne({
                    where: { daily_plan_id: restoredPlan.id },
                })
            ).task_id
        ).toBe(restoredTask.id);
        const second = await importUserData(fresh.id, backup);
        expect(second.history.events).toBe(0);
        expect(
            await TaskEvent.count({ where: { task_id: restoredTask.id } })
        ).toBe(2);
    });
    it('applies the extension migration on an already synced fresh schema', async () => {
        const { sequelize } = require('../../models');
        const { Sequelize } = require('sequelize');
        const migration = require('../../migrations/20261020000001-note-revision');
        const note = await notes.create(owner.id, {
            title: 'Сохраняется при миграции',
            content: 'body',
        });
        await migration.up(sequelize.getQueryInterface(), Sequelize);
        await migration.up(sequelize.getQueryInterface(), Sequelize);
        expect((await notes.getByUid(note.uid)).content).toBe('body');
    });
    it('streams visible text with source metadata and first-token timing', async () => {
        const ai = require('../../modules/ai-assistant/service');
        await Task.create({
            name: 'Витамин поток',
            note: '21:24 аудит',
            user_id: owner.id,
        });
        jest.spyOn(ai, 'getOpenAIClient').mockResolvedValue({});
        jest.spyOn(ai, 'getAIModel').mockResolvedValue('test-model');
        jest.spyOn(ai, 'callWithFallback').mockImplementation(async () =>
            (async function* () {
                yield { choices: [{ delta: { content: 'Есть источник.' } }] };
                yield { choices: [], usage: { total_tokens: 5 } };
            })()
        );
        const token = (
            await createApiToken({
                userId: owner.id,
                name: 'stream test',
                expiresAt: null,
            })
        ).rawToken;
        const response = await request(app)
            .post('/api/extensions/history/answer/stream')
            .set('Authorization', `Bearer ${token}`)
            .send({ query: 'Витамин' });
        expect(response.status).toBe(200);
        const events = response.text
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(events.map((event) => event.type)).toEqual([
            'sources',
            'delta',
            'done',
        ]);
        expect(events[2].answer).toBe('Есть источник.');
        expect(events[2].first_token_ms).toEqual(expect.any(Number));
    });
});
