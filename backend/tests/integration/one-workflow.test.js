const request = require('supertest');
const app = require('../../app');
const {
    Task,
    Comment,
    User,
    OnePlan,
    DailyPlan,
    DailyPlanItem,
    Permission,
    Project,
    sequelize,
} = require('../../models');
const { createTestUser } = require('../helpers/testUtils');
const { createApiToken } = require('../../modules/users/apiTokenService');
const comments = require('../../modules/comments/service');
const planning = require('../../extensions/one/planning');
const workflow = require('../../extensions/one/service');
const constraints = require('../../extensions/one/constraints');
const daily = require('../../modules/daily-plan/service');
const {
    exportUserData,
    importUserData,
} = require('../../services/userDataTransfer');
const {
    completeOccurrence,
} = require('../../modules/tasks/operations/recurring');

describe('One dialogue and personal planning', () => {
    let owner, agent, outsider, task;
    beforeEach(async () => {
        await constraints.install(sequelize);
        owner = await createTestUser({
            email: 'workflow-owner@example.com',
            timezone: 'Asia/Yekaterinburg',
        });
        agent = await createTestUser({ email: 'workflow-agent@example.com' });
        outsider = await createTestUser({
            email: 'workflow-other@example.com',
        });
        await owner.update({ one_actor: 'human' });
        await agent.update({ one_actor: 'agent' });
        task = await Task.create({
            name: 'Одна задача',
            user_id: owner.id,
            due_date: '2030-02-01T00:00:00Z',
        });
    });
    it('appends an MCP agent reply under the same login and settles every prior human comment atomically', async () => {
        await comments.addComment(owner.id, task.uid, {
            body: 'Нужно уточнить',
        });
        await comments.addComment(owner.id, task.uid, {
            body: 'И ещё один вопрос',
        });
        expect((await workflow.dashboard(owner)).agent_owes).toHaveLength(1);
        await expect(task.update({ status: 2 })).rejects.toMatchObject({
            original: { message: expect.stringContaining('ONE_UNANSWERED') },
        });
        const reply = await comments.addComment(
            owner.id,
            task.uid,
            { body: 'Проверил, вот ответ.' },
            'mcp'
        );
        expect(reply.one_role).toBe('agent');
        const rows = await Comment.findAll({
            where: { task_id: task.id, one_role: 'human' },
        });
        expect(rows.every((c) => !c.one_pending && c.one_answered_at)).toBe(
            true
        );
        await task.reload();
        await task.update({ status: 2 });
        expect(task.status).toBe(2);
    });
    it('tracks agent questions, clears the human queue after a human reply, and requires the agent to answer it', async () => {
        await workflow.reply(owner, task.uid, 'Подходит этот вариант?');
        expect((await workflow.dashboard(owner)).human_owes).toHaveLength(1);
        await comments.addComment(owner.id, task.uid, {
            body: 'Да, но проверь срок.',
        });
        const state = await workflow.dashboard(owner);
        expect(state.human_owes).toHaveLength(0);
        expect(state.agent_owes).toHaveLength(1);
    });
    it('keeps debts on already completed and archived tasks visible', async () => {
        await task.update({ status: 3 });
        await comments.addComment(owner.id, task.uid, {
            body: 'Уточни результат после закрытия.',
        });
        expect((await workflow.dashboard(owner)).agent_owes[0].status).toBe(3);
    });
    it('guards bulk status writes and recurring completions, not just native UI buttons', async () => {
        await comments.addComment(owner.id, task.uid, {
            body: 'Пока не закрывай без ответа',
        });
        for (const status of [2, 3, 5])
            await expect(
                Task.update(
                    { status },
                    { where: { id: task.id }, hooks: false }
                )
            ).rejects.toMatchObject({
                original: {
                    message: expect.stringContaining('ONE_UNANSWERED'),
                },
            });
        await task.update({
            recurrence_type: 'daily',
            due_date: '2030-01-07T10:00:00Z',
        });
        await expect(
            completeOccurrence(task, {
                userId: owner.id,
                timezone: owner.timezone,
            })
        ).rejects.toMatchObject({ code: 'ONE_UNANSWERED' });
        expect((await task.reload()).due_date.toISOString()).toBe(
            '2030-01-07T10:00:00.000Z'
        );
    });
    it('shows a readable REST conflict and leaves the task open', async () => {
        await comments.addComment(owner.id, task.uid, { body: 'Вопрос' });
        const token = await createApiToken({
            userId: owner.id,
            name: 'workflow-test',
        });
        const res = await request(app)
            .patch(`/api/v1/task/${task.uid}`)
            .set('Authorization', `Bearer ${token.rawToken}`)
            .send({ status: 2 });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('ONE_UNANSWERED');
        expect((await task.reload()).status).toBe(0);
    });
    it('does not accept an agent role from ordinary REST request fields', async () => {
        const token = await createApiToken({
            userId: owner.id,
            name: 'workflow-role-test',
        });
        const res = await request(app)
            .post(`/api/v1/task/${task.uid}/comments`)
            .set('Authorization', `Bearer ${token.rawToken}`)
            .send({
                body: 'Нельзя подменить автора',
                one_role: 'agent',
                channel: 'mcp',
            });
        expect(res.status).toBe(201);
        expect(res.body.one_role).toBe('human');
        expect(res.body.one_pending).toBe(true);
    });
    it('makes tracked comments append-only through both the service and direct model update', async () => {
        const c = await comments.addComment(owner.id, task.uid, {
            body: 'Исходные слова',
        });
        await expect(
            comments.removeComment(owner.id, c.uid)
        ).rejects.toMatchObject({ statusCode: 403 });
        await expect(
            Comment.update(
                { body: 'Другие слова' },
                { where: { uid: c.uid }, hooks: false }
            )
        ).rejects.toMatchObject({
            original: { message: expect.stringContaining('ONE_APPEND_ONLY') },
        });
        expect((await Comment.findOne({ where: { uid: c.uid } })).body).toBe(
            'Исходные слова'
        );
    });
    it('normalizes a week to Monday, enforces exclusivity and leaves the deadline untouched', async () => {
        const p = await planning.set(owner, task.uid, {
            week: '2030-01-09',
            expected_revision: 0,
        });
        expect(p.week).toBe('2030-01-07');
        expect(p.planned).toBeNull();
        await expect(
            planning.set(owner, task.uid, {
                week: '2030-01-09',
                planned: '2030-01-10',
                expected_revision: p.revision,
            })
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            OnePlan.update(
                { planned: '2030-01-10' },
                { where: { user_id: owner.id }, hooks: false, validate: false }
            )
        ).rejects.toMatchObject({
            original: {
                message: expect.stringContaining('ONE_PLAN_EXCLUSIVE'),
            },
        });
        expect((await task.reload()).due_date.toISOString()).toBe(
            '2030-02-01T00:00:00.000Z'
        );
    });
    it('counts real day changes once and keeps current native day plans consistent', async () => {
        let p = await planning.set(owner, task.uid, {
            planned: '2030-01-07',
            expected_revision: 0,
        });
        expect(p.moves).toBe(0);
        const same = await planning.set(owner, task.uid, {
            planned: '2030-01-07',
            expected_revision: p.revision,
        });
        expect(same.revision).toBe(p.revision);
        p = await planning.set(owner, task.uid, {
            planned: '2030-01-08',
            expected_revision: p.revision,
        });
        expect(p.moves).toBe(1);
        expect(
            (await daily.getPlan(owner, '2030-01-07')).plan.items
        ).toHaveLength(0);
        expect(
            (await daily.getPlan(owner, '2030-01-08')).plan.items[0].task_uid
        ).toBe(task.uid);
        p = await planning.set(owner, task.uid, {
            week: '2030-01-07',
            expected_revision: p.revision,
        });
        expect(p.planned).toBeNull();
        expect(p.moves).toBe(1);
        expect(
            (await daily.getPlan(owner, '2030-01-08')).plan.items
        ).toHaveLength(0);
        p = await planning.set(owner, task.uid, {
            planned: '2030-01-09',
            expected_revision: p.revision,
        });
        expect(p.moves).toBe(2);
    });
    it('rejects a stale or missing module revision and serializes competing schedules', async () => {
        const results = await Promise.allSettled([
            planning.set(owner, task.uid, {
                planned: '2030-01-07',
                expected_revision: 0,
            }),
            planning.set(owner, task.uid, {
                planned: '2030-01-08',
                expected_revision: 0,
            }),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(
            results.find((r) => r.status === 'rejected').reason.statusCode
        ).toBe(409);
        await expect(
            planning.set(owner, task.uid, { week: '2030-01-07' })
        ).rejects.toMatchObject({ statusCode: 428 });
        expect((await planning.read(owner.id, task.uid)).moves).toBe(0);
    });
    it('syncs the native planner and rejects its stale whole-list saves', async () => {
        let p = await planning.set(owner, task.uid, {
            week: '2030-01-07',
            expected_revision: 0,
        });
        const epoch = (await daily.getPlan(owner, '2030-01-08')).one_revision;
        const day = await daily.replaceItems(
            owner,
            '2030-01-08',
            [{ task_uid: task.uid }],
            0,
            epoch
        );
        p = await planning.read(owner.id, task.uid);
        expect(p.planned).toBe('2030-01-08');
        expect(p.week).toBeNull();
        await expect(
            daily.replaceItems(owner, '2030-01-08', [], 0, day.one_revision)
        ).rejects.toMatchObject({ statusCode: 409 });
        await expect(
            daily.replaceItems(owner, '2030-01-08', [])
        ).rejects.toMatchObject({ statusCode: 428 });
        await daily.clearPlan(
            owner,
            '2030-01-08',
            day.plan.revision,
            day.one_revision
        );
        expect((await planning.read(owner.id, task.uid)).planned).toBeNull();
        await expect(
            daily.replaceItems(
                owner,
                '2030-01-08',
                [{ task_uid: task.uid }],
                0,
                (await daily.getPlan(owner, '2030-01-08')).one_revision
            )
        ).rejects.toMatchObject({ statusCode: 409 });
    });
    it('rejects an old native empty-day snapshot after a newer weekly choice', async () => {
        const snapshot = await daily.getPlan(owner, '2030-01-08');
        await planning.set(owner, task.uid, {
            week: '2030-01-07',
            expected_revision: 0,
        });
        await expect(
            daily.replaceItems(
                owner,
                '2030-01-08',
                [{ task_uid: task.uid }],
                0,
                snapshot.one_revision
            )
        ).rejects.toMatchObject({ statusCode: 409 });
        expect((await planning.read(owner.id, task.uid)).week).toBe(
            '2030-01-07'
        );
    });
    it('preserves historical native day snapshots when rescheduling current work', async () => {
        const day = await DailyPlan.create({
            user_id: owner.id,
            plan_date: '2020-01-06',
        });
        await DailyPlanItem.create({ daily_plan_id: day.id, task_id: task.id });
        await planning.set(owner, task.uid, {
            planned: '2030-01-07',
            expected_revision: 0,
        });
        expect(
            await DailyPlanItem.count({ where: { daily_plan_id: day.id } })
        ).toBe(1);
    });
    it('does not leak tasks or queues after permissions are revoked', async () => {
        const project = await Project.create({
            name: 'Общий',
            user_id: owner.id,
        });
        await task.update({ project_id: project.id });
        const permission = await Permission.create({
            user_id: agent.id,
            resource_type: 'project',
            resource_uid: project.uid,
            access_level: 'ro',
            status: 'accepted',
            propagation: 'subtree',
            granted_by_user_id: owner.id,
        });
        await comments.addComment(owner.id, task.uid, {
            body: 'Нужно ответить',
        });
        expect((await workflow.dashboard(agent)).agent_owes).toHaveLength(1);
        await permission.destroy();
        expect((await workflow.dashboard(agent)).agent_owes).toHaveLength(0);
        await expect(
            planning.read(outsider.id, task.uid)
        ).rejects.toMatchObject({ statusCode: 404 });
    });
    it('adopts only explicitly labelled archive roles without rewriting their text', async () => {
        const a = await Comment.create({
            task_id: task.id,
            user_id: owner.id,
            body: '[АРХИВ One #1 • 2026-10-16 12:00 • owner]\nНужно проверить',
        });
        await Comment.create({
            task_id: task.id,
            user_id: owner.id,
            body: 'АРХИВ T12 • 2026-10-16 12:01 • agent\n\nПроверил. Нужны уточнения?',
        });
        await Comment.create({
            task_id: task.id,
            user_id: owner.id,
            body: 'Неразмеченное старое сообщение',
        });
        const adopted = await workflow.enable(owner);
        expect(adopted.classified).toBe(2);
        const original = await a.reload();
        expect(original.one_pending).toBe(false);
        expect(original.body).toContain('[АРХИВ One');
        expect((await workflow.dashboard(owner)).unclassified_comments).toBe(1);
        expect((await workflow.enable(owner)).classified).toBe(0);
    });
    it('round-trips roles, response state, plans and move counts in the versioned native export', async () => {
        await comments.addComment(owner.id, task.uid, {
            body: 'Первый вопрос',
        });
        await workflow.reply(owner, task.uid, 'Ответ.');
        await comments.addComment(owner.id, task.uid, {
            body: 'Второй вопрос',
        });
        let p = await planning.set(owner, task.uid, {
            planned: '2030-01-07',
            expected_revision: 0,
        });
        p = await planning.set(owner, task.uid, {
            planned: '2030-01-08',
            expected_revision: p.revision,
        });
        const backup = await exportUserData(owner.id);
        expect(backup.data.history.format).toBe(2);
        await importUserData(outsider.id, backup, { preserveUids: false });
        expect((await User.findByPk(outsider.id)).one_actor).toBe('human');
        const imported = await Task.findOne({
            where: { user_id: outsider.id, name: task.name },
        });
        const restored = await planning.read(outsider.id, imported.uid);
        expect(restored.moves).toBe(1);
        expect(restored.planned).toBe('2030-01-08');
        const thread = await Comment.findAll({
            where: { task_id: imported.id },
            order: [['id', 'ASC']],
        });
        expect(thread.map((c) => [c.one_role, c.one_pending])).toEqual([
            ['human', false],
            ['agent', false],
            ['human', true],
        ]);
        await expect(imported.update({ status: 2 })).rejects.toMatchObject({
            original: { message: expect.stringContaining('ONE_UNANSWERED') },
        });
    });
    it('does not settle an unrelated human question when the agent replies to a specific thread', async () => {
        const first = await comments.addComment(owner.id, task.uid, {
            body: 'Первый вопрос',
        });
        const second = await comments.addComment(owner.id, task.uid, {
            body: 'Другой вопрос',
        });
        await comments.addComment(
            owner.id,
            task.uid,
            { body: 'Ответ на первый', parentCommentUid: first.uid },
            'mcp'
        );
        expect(
            (await Comment.findOne({ where: { uid: first.uid } })).one_pending
        ).toBe(false);
        expect(
            (await Comment.findOne({ where: { uid: second.uid } })).one_pending
        ).toBe(true);
        await expect(workflow.assertCanClose(task.id)).rejects.toMatchObject({
            code: 'ONE_UNANSWERED',
        });
    });
    it('exposes the new tools through authenticated MCP and keeps their permissions', async () => {
        const token = await createApiToken({
            userId: owner.id,
            name: 'workflow-mcp-test',
        });
        const call = async (name, args) => {
            const response = await request(app)
                .post('/api/mcp')
                .set('Authorization', `Bearer ${token.rawToken}`)
                .set('Accept', 'application/json, text/event-stream')
                .send({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name, arguments: args },
                });
            const line = response.text
                .split('\n')
                .find((line) => line.startsWith('data: '));
            return line
                ? JSON.parse(line.slice(6)).result
                : response.body.result;
        };
        await comments.addComment(owner.id, task.uid, {
            body: 'Нужен ответ через MCP',
        });
        const reply = await call('one_reply', {
            task_uid: task.uid,
            body: 'Ответ через MCP.',
        });
        expect(reply.isError).not.toBe(true);
        expect((await workflow.dashboard(owner)).agent_owes).toHaveLength(0);
        const scheduled = await call('one_schedule', {
            task_uid: task.uid,
            week: '2030-01-09',
            expected_revision: 0,
        });
        expect(scheduled.isError).not.toBe(true);
        expect((await planning.read(owner.id, task.uid)).week).toBe(
            '2030-01-07'
        );
    });
    it('installs and removes the new schema repeatedly on SQLite without damaging task text', async () => {
        const migration = require('../../migrations/20261020000002-one-dialog-planning');
        const q = sequelize.getQueryInterface(),
            S = require('sequelize');
        await migration.up(q, S);
        await migration.up(q, S);
        await migration.down(q);
        expect((await q.describeTable('comments')).one_role).toBeUndefined();
        await migration.up(q, S);
        expect((await q.describeTable('comments')).one_role).toBeDefined();
        expect((await Task.findByPk(task.id)).name).toBe('Одна задача');
    });
});
