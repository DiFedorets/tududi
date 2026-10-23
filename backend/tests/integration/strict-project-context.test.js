const request = require('supertest');
const app = require('../../app');
const { Task, Project, Area, Goal, sequelize } = require('../../models');
const { createTestUser } = require('../helpers/testUtils');
describe('Strict project task context', () => {
    let user, agent, a, b, ga, gb, pa, pb;
    beforeEach(async () => {
        user = await createTestUser({ email: 'strict@example.com' });
        agent = request.agent(app);
        await agent
            .post('/api/login')
            .send({ email: user.email, password: 'password123' });
        a = await Area.create({ name: 'A', user_id: user.id });
        b = await Area.create({ name: 'B', user_id: user.id });
        ga = await Goal.create({
            title: 'GA',
            user_id: user.id,
            area_id: a.id,
        });
        gb = await Goal.create({
            title: 'GB',
            user_id: user.id,
            area_id: b.id,
        });
        pa = await Project.create({
            name: 'PA',
            user_id: user.id,
            area_id: a.id,
            goal_id: ga.id,
        });
        pb = await Project.create({
            name: 'PB',
            user_id: user.id,
            area_id: b.id,
            goal_id: gb.id,
        });
    });
    const make = (fields = {}) =>
        Task.create({ name: 'Task', user_id: user.id, ...fields });
    const ctx = (t) => ({ area_id: t.area_id, goal_id: t.goal_id });
    it('inherits immediately in REST create response and persisted rows, despite supplied direct values', async () => {
        const r = await agent.post('/api/task').send({
            name: 'Created',
            project_id: pa.id,
            area_id: b.id,
            goal_id: gb.id,
        });
        expect(r.status).toBe(201);
        expect(ctx(r.body)).toEqual({ area_id: a.id, goal_id: ga.id });
        expect(ctx(await Task.findByPk(r.body.id))).toEqual(ctx(r.body));
    });
    it('allows direct context only without a project', async () => {
        const t = await make({ area_id: b.id, goal_id: gb.id });
        expect(ctx(t)).toEqual({ area_id: b.id, goal_id: gb.id });
        await t.update({ area_id: a.id, goal_id: ga.id });
        expect(ctx(await t.reload())).toEqual({
            area_id: a.id,
            goal_id: ga.id,
        });
    });
    it('moves both fields with the project and retains the last context when detached', async () => {
        const t = await make({ project_id: pa.id });
        await t.update({ project_id: pb.id });
        expect(ctx(t)).toEqual({ area_id: b.id, goal_id: gb.id });
        await t.update({ project_id: null });
        expect(ctx(await t.reload())).toEqual({
            area_id: b.id,
            goal_id: gb.id,
        });
        await t.update({ area_id: a.id, goal_id: null });
        expect(ctx(await t.reload())).toEqual({ area_id: a.id, goal_id: null });
    });
    it('does not allow direct API overrides while attached', async () => {
        const t = await make({ project_id: pa.id });
        const r = await agent
            .patch(`/api/task/${t.uid}`)
            .send({ area_id: b.id, goal_id: gb.id });
        expect(r.status).toBe(200);
        expect(ctx(r.body)).toEqual({ area_id: a.id, goal_id: ga.id });
    });
    it('inherits nulls from a project without context', async () => {
        const p = await Project.create({ name: 'Empty', user_id: user.id });
        const t = await make({ area_id: b.id, goal_id: gb.id });
        await t.update({ project_id: p.id });
        expect(ctx(t)).toEqual({ area_id: null, goal_id: null });
    });
    it('propagates project edits to all tasks in the same transaction and logs old context', async () => {
        const t = await make({ project_id: pa.id });
        await pa.update({ area_id: b.id, goal_id: gb.id });
        expect(ctx(await t.reload())).toEqual({
            area_id: b.id,
            goal_id: gb.id,
        });
        const [rows] = await sequelize.query(
            'SELECT * FROM task_context_history WHERE task_id=? AND reason=?',
            { replacements: [t.id, 'project_context_changed'] }
        );
        expect(rows[0]).toMatchObject({ area_id: a.id, goal_id: ga.id });
    });
    it('protects bulk/raw adapter writes as well as ORM writes', async () => {
        const t = await make({ project_id: pa.id });
        await sequelize.query(
            'UPDATE tasks SET project_id=?, area_id=NULL, goal_id=NULL WHERE id=?',
            { replacements: [pb.id, t.id] }
        );
        expect(ctx(await t.reload())).toEqual({
            area_id: b.id,
            goal_id: gb.id,
        });
        await sequelize.query(
            'UPDATE projects SET area_id=?,goal_id=? WHERE id=?',
            { replacements: [a.id, ga.id, pb.id] }
        );
        expect(ctx(await t.reload())).toEqual({
            area_id: a.id,
            goal_id: ga.id,
        });
    });
    it('rolls back the whole propagation and history with the enclosing transaction', async () => {
        const t = await make({ project_id: pa.id });
        await expect(
            sequelize.transaction(async (transaction) => {
                await pa.update(
                    { area_id: b.id, goal_id: gb.id },
                    { transaction }
                );
                throw Error('rollback');
            })
        ).rejects.toThrow('rollback');
        expect(ctx(await t.reload())).toEqual({
            area_id: a.id,
            goal_id: ga.id,
        });
        const [rows] = await sequelize.query(
            "SELECT * FROM task_context_history WHERE reason='project_context_changed'"
        );
        expect(rows).toHaveLength(0);
    });
    it('keeps numeric area filters, UID filters, search and goal pages consistent', async () => {
        const t = await make({ project_id: pa.id });
        for (const query of [{ area_id: a.id }, { area_uid: a.uid }]) {
            const r = await agent
                .get('/api/tasks')
                .query({ type: 'all', ...query });
            expect(r.status).toBe(200);
            expect(r.body.tasks.map((t) => t.uid)).toContain(t.uid);
        }
        const other = await agent.get('/api/tasks').query({ area_uid: b.uid });
        expect(other.body.tasks.map((t) => t.uid)).not.toContain(t.uid);
        const found = await agent
            .get('/api/search')
            .query({ q: 'Task', filters: 'Task', area_uid: a.uid });
        expect(found.body.results.map((t) => t.uid)).toContain(t.uid);
        const goal = await agent.get(`/api/goals/${ga.uid}`);
        expect(goal.body.goal.Tasks.map((t) => t.uid)).toContain(t.uid);
    });
    it('handles deletion of inherited areas/goals with actual FK enforcement', async () => {
        const t = await make({ project_id: pa.id });
        await sequelize.query('PRAGMA foreign_keys=ON');
        try {
            await a.destroy();
            expect((await t.reload()).area_id).toBeNull();
            await ga.destroy();
            expect((await t.reload()).goal_id).toBeNull();
            expect((await t.reload()).project_id).toBe(pa.id);
        } finally {
            await sequelize.query('PRAGMA foreign_keys=OFF');
        }
    });
    it('retains dates, notes and identifiers when context propagates', async () => {
        const t = await make({
            project_id: pa.id,
            note: 'Keep text',
            due_date: '2026-10-26',
        });
        const before = t.toJSON();
        await pa.update({ area_id: b.id, goal_id: gb.id });
        const after = (await t.reload()).toJSON();
        for (const key of Object.keys(before).filter(
            (k) => !['area_id', 'goal_id'].includes(k)
        ))
            expect(after[key]).toEqual(before[key]);
    });
});
