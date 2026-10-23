const request = require('supertest');
const app = require('../../app');
const {
    Task,
    User,
    OnePlan,
    DailyPlan,
    DailyPlanItem,
    sequelize,
} = require('../../models');
const { createTestUser } = require('../helpers/testUtils');
const { createApiToken } = require('../../modules/users/apiTokenService');
const native = require('../../extensions/one/nativePlanning');
const planning = require('../../extensions/one/planning');
const moment = require('moment-timezone');
describe('Native planning with the unchanged One bridge contract', () => {
    let owner, task, token;
    beforeEach(async () => {
        owner = await createTestUser({
            email: 'native-plan@example.com',
            timezone: 'Asia/Yekaterinburg',
        });
        await owner.update({ one_actor: 'human' });
        task = await Task.create({ name: 'Native plan', user_id: owner.id });
        token = (
            await createApiToken({ userId: owner.id, name: 'native-plan' })
        ).rawToken;
    });
    const patch = (uid, body) =>
        request(app)
            .patch(`/api/v1/task/${uid}`)
            .set('Authorization', `Bearer ${token}`)
            .send(body);
    it('remembers the last day across clearing and only counts a different reselection', async () => {
        const select = async (due_date) => {
            expect((await patch(task.uid, { due_date })).status).toBe(200);
            return OnePlan.findOne({ where: { task_id: task.id } });
        };
        expect((await select('2032-01-05')).moves).toBe(0);
        expect((await select(null)).moves).toBe(0);
        expect((await select('2032-01-05')).moves).toBe(0);
        await select(null);
        const plan = await select('2032-01-06');
        expect(plan.moves).toBe(1);
        expect(plan.last_planned).toBe('2032-01-06');
        expect(plan.planned).toBe('2032-01-06');
    });
    it('preserves the plan and move count through defer, completion and reopening', async () => {
        expect((await patch(task.uid, { due_date: '2032-01-05' })).status).toBe(
            200
        );
        expect((await patch(task.uid, { due_date: '2032-01-06' })).status).toBe(
            200
        );
        const before = await OnePlan.findOne({ where: { task_id: task.id } });
        const itemCount = await DailyPlanItem.count({
            where: { task_id: task.id },
        });
        for (const body of [
            { defer_until: '2032-01-04' },
            { status: Task.STATUS.DONE },
            { status: Task.STATUS.NOT_STARTED },
        ]) {
            expect((await patch(task.uid, body)).status).toBe(200);
            const after = await OnePlan.findByPk(before.id);
            expect(after.planned).toBe(before.planned);
            expect(after.moves).toBe(before.moves);
            expect(after.revision).toBe(before.revision);
        }
        expect(await DailyPlanItem.count({ where: { task_id: task.id } })).toBe(
            itemCount
        );
    });
    it('batches move counts for visible tasks and never exposes another personal plan', async () => {
        await OnePlan.create(
            { user_id: owner.id, task_id: task.id, moves: 3 },
            { nativeProjection: false }
        );
        const response = await request(app)
            .get('/api/v1/extensions/one/move-counts')
            .set('Authorization', `Bearer ${token}`);
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ [task.uid]: 3 });
        const outsider = await createTestUser({
            email: 'counter-outsider@example.com',
        });
        await outsider.update({ one_actor: 'human' });
        await OnePlan.create(
            { user_id: outsider.id, task_id: task.id, moves: 99 },
            { nativeProjection: false }
        );
        expect(
            await require('../../extensions/one/service').moveCounts(outsider)
        ).toEqual({});
        expect(
            await require('../../extensions/one/service').moveCounts(owner)
        ).toEqual({ [task.uid]: 3 });
    });
    it('initializes a native task created with a date without counting a move', async () => {
        const created = await request(app)
            .post('/api/v1/task')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Created with native date', due_date: '2030-01-07' });
        expect(created.status).toBe(201);
        expect(await planning.read(owner.id, created.body.uid)).toMatchObject({
            planned: '2030-01-07',
            moves: 0,
        });
        expect(
            (await patch(created.body.uid, { due_date: '2030-01-08' })).status
        ).toBe(200);
        expect(await planning.read(owner.id, created.body.uid)).toMatchObject({
            planned: '2030-01-08',
            moves: 1,
        });
    });
    it('counts native date changes, preserves time-only edits and exports the same plan', async () => {
        expect((await patch(task.uid, { due_date: '2030-01-07' })).status).toBe(
            200
        );
        expect(await planning.read(owner.id, task.uid)).toMatchObject({
            planned: '2030-01-07',
            moves: 0,
        });
        expect((await patch(task.uid, { due_date: '2030-01-08' })).status).toBe(
            200
        );
        expect(await planning.read(owner.id, task.uid)).toMatchObject({
            planned: '2030-01-08',
            moves: 1,
        });
        expect(
            (
                await patch(task.uid, {
                    due_date: '2030-01-08',
                    due_time: '10:00',
                })
            ).status
        ).toBe(200);
        expect(await planning.read(owner.id, task.uid)).toMatchObject({
            planned: '2030-01-08',
            moves: 1,
        });
        expect((await patch(task.uid, { due_date: null })).status).toBe(200);
        expect((await patch(task.uid, { due_date: '2030-01-09' })).status).toBe(
            200
        );
        expect(await planning.read(owner.id, task.uid)).toMatchObject({
            planned: '2030-01-09',
            moves: 2,
        });
        const days = await DailyPlan.findAll({ where: { user_id: owner.id } });
        const memberships = await DailyPlanItem.findAll({
            where: { task_id: task.id },
        });
        expect(memberships).toHaveLength(1);
        expect(
            days.find((day) => day.id === memberships[0].daily_plan_id)
                .plan_date
        ).toBe('2030-01-09');
    });
    it('projects direct transactional writes made by the existing adapter, without double counting', async () => {
        await sequelize.transaction(async (transaction) => {
            await OnePlan.create(
                {
                    user_id: owner.id,
                    task_id: task.id,
                    planned: '2030-01-07',
                    last_planned: '2030-01-07',
                    moves: 4,
                    revision: 2,
                },
                { transaction }
            );
        });
        expect(
            moment((await task.reload()).due_date)
                .tz(owner.timezone)
                .format('YYYY-MM-DD')
        ).toBe('2030-01-07');
        expect((await patch(task.uid, { due_date: '2030-01-08' })).status).toBe(
            200
        );
        const plan = await OnePlan.findOne({ where: { task_id: task.id } });
        expect(plan.moves).toBe(5);
        await sequelize.transaction(async (transaction) => {
            await plan.update(
                {
                    planned: '2030-01-09',
                    moves: 6,
                    revision: plan.revision + 1,
                },
                { transaction }
            );
        });
        expect(
            moment((await task.reload()).due_date)
                .tz(owner.timezone)
                .format('YYYY-MM-DD')
        ).toBe('2030-01-09');
        expect((await plan.reload()).moves).toBe(6);
    });
    it('prepares old plans idempotently without changing metadata or week precision', async () => {
        await OnePlan.create(
            {
                user_id: owner.id,
                task_id: task.id,
                planned: '2030-01-07',
                last_planned: '2030-01-07',
                moves: 8,
                revision: 3,
            },
            { nativeProjection: false }
        );
        const other = await Task.create({
            name: 'Week only',
            user_id: owner.id,
        });
        await OnePlan.create(
            {
                user_id: owner.id,
                task_id: other.id,
                week: '2030-01-07',
                moves: 2,
            },
            { nativeProjection: false }
        );
        expect(await native.reconcile()).toMatchObject({
            projected: 1,
            weeks: 1,
            conflicts: [],
        });
        expect(await native.reconcile()).toMatchObject({
            projected: 0,
            weeks: 1,
            conflicts: [],
        });
        expect(await planning.read(owner.id, task.uid)).toMatchObject({
            moves: 8,
            revision: 3,
        });
        expect((await other.reload()).due_date).toBeNull();
    });
    it('rolls back all preparation if existing native and imported dates disagree', async () => {
        await task.update({ due_date: '2030-02-01T00:00:00Z' });
        await OnePlan.create(
            { user_id: owner.id, task_id: task.id, planned: '2030-01-07' },
            { nativeProjection: false }
        );
        await expect(native.reconcile()).rejects.toThrow(
            'NATIVE_PLAN_DATE_CONFLICT'
        );
        expect((await task.reload()).due_date.toISOString()).toBe(
            '2030-02-01T00:00:00.000Z'
        );
    });
    it('shows a saved week only in native Upcoming and respects ownership', async () => {
        const week = moment()
            .tz(owner.timezone)
            .startOf('isoWeek')
            .format('YYYY-MM-DD');
        await OnePlan.create(
            { user_id: owner.id, task_id: task.id, week },
            { nativeProjection: false }
        );
        const response = await request(app)
            .get('/api/v1/tasks?type=upcoming&groupBy=day')
            .set('Authorization', `Bearer ${token}`);
        expect(response.status).toBe(200);
        expect(
            response.body.groupedTasks['Неделя с ' + week + ' · без дня'].some(
                (item) => item.uid === task.uid
            )
        ).toBe(true);
    });
    it('rejects a stale board date without changing plans or moves', async () => {
        expect(
            (
                await patch(task.uid, {
                    due_date: '2032-01-05',
                    expected_due_date: null,
                })
            ).status
        ).toBe(200);
        const stale = await patch(task.uid, {
            due_date: '2032-01-06',
            expected_due_date: null,
        });
        expect(stale.status).toBe(409);
        let plan = await OnePlan.findOne({ where: { task_id: task.id } });
        expect(plan.planned).toBe('2032-01-05');
        expect(plan.moves).toBe(0);
        expect(
            (
                await patch(task.uid, {
                    due_date: '2032-01-06',
                    expected_due_date: '2032-01-05',
                })
            ).status
        ).toBe(200);
        plan = await plan.reload();
        expect(plan.planned).toBe('2032-01-06');
        expect(plan.moves).toBe(1);
        expect(
            (
                await patch(task.uid, {
                    due_date: '2032-01-06',
                    expected_due_date: '2032-01-06',
                })
            ).status
        ).toBe(200);
        expect((await plan.reload()).moves).toBe(1);
    });
    it('does not overwrite a time changed since the board was read', async () => {
        await patch(task.uid, { due_date: '2032-01-05', due_time: '10:30' });
        const response = await patch(task.uid, {
            due_date: '2032-01-06',
            due_time: null,
            expected_due_date: '2032-01-05',
            expected_due_time: null,
        });
        expect(response.status).toBe(409);
        expect((await task.reload()).due_has_time).toBe(true);
        const ok = await patch(task.uid, {
            due_date: '2032-01-06',
            due_time: '10:30',
            expected_due_date: '2032-01-05',
            expected_due_time: '10:30',
        });
        expect(ok.status).toBe(200);
        expect(ok.body.due_time).toBe('10:30');
    });
    it('allows only one concurrent board move and preserves a newer One projection', async () => {
        await patch(task.uid, { due_date: '2032-01-05' });
        const responses = await Promise.all(
            ['2032-01-06', '2032-01-07'].map((due_date) =>
                patch(task.uid, { due_date, expected_due_date: '2032-01-05' })
            )
        );
        expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
        const plan = await OnePlan.findOne({ where: { task_id: task.id } });
        expect(plan.moves).toBe(1);
        await sequelize.transaction(
            { type: 'IMMEDIATE' },
            async (transaction) => {
                await plan.update(
                    { planned: '2032-01-08', revision: plan.revision + 1 },
                    { transaction }
                );
            }
        );
        expect(
            (
                await patch(task.uid, {
                    due_date: '2032-01-09',
                    expected_due_date: '2032-01-05',
                })
            ).status
        ).toBe(409);
        expect((await plan.reload()).planned).toBe('2032-01-08');
    });
});
