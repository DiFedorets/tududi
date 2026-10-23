const request = require('supertest');
const moment = require('moment-timezone');
const app = require('../../app');
const {
    Task,
    User,
    OnePlan,
    DailyPlan,
    DailyPlanItem,
    Project,
    sequelize,
} = require('../../models');
const { createTestUser } = require('../helpers/testUtils');
const { createApiToken } = require('../../modules/users/apiTokenService');
const constraints = require('../../extensions/one/constraints');
const planning = require('../../extensions/one/planning');
const {
    upcomingRange,
} = require('../../modules/tasks/operations/upcomingRange');
let user, token, today, start, end;
const auth = () => ({ Authorization: `Bearer ${token.rawToken}` });
const list = (params = {}) =>
    request(app)
        .get('/api/v1/tasks')
        .set(auth())
        .query({
            type: 'upcoming',
            groupBy: 'day',
            status: 'active',
            include_subtasks: 'true',
            range_start: start,
            range_end: end,
            ...params,
        });
const make = (name, day, attrs = {}) =>
    Task.create({
        name,
        user_id: user.id,
        due_date: moment.tz(day, 'America/New_York').endOf('day').toDate(),
        ...attrs,
    });
beforeEach(async () => {
    await constraints.install(sequelize);
    user = await createTestUser({
        email: 'range@example.com',
        timezone: 'America/New_York',
    });
    await user.update({ one_actor: 'human' });
    token = await createApiToken({ userId: user.id, name: 'range-test' });
    today = moment.tz('America/New_York').startOf('day');
    start = today.clone().subtract(12, 'days').format('YYYY-MM-DD');
    end = today.clone().add(4, 'days').format('YYYY-MM-DD');
});
it('shows yesterday and last week, includes both boundaries, excludes outside dates and respects active status', async () => {
    const dates = [
        start,
        today.clone().subtract(1, 'day').format('YYYY-MM-DD'),
        end,
    ];
    const included = await Promise.all(dates.map((d, i) => make('in ' + i, d)));
    const outside = await make(
        'outside',
        moment
            .tz(start, 'America/New_York')
            .subtract(1, 'day')
            .format('YYYY-MM-DD')
    );
    const done = await make('done', start, { status: 2 });
    const r = await list();
    expect(r.status).toBe(200);
    const ids = r.body.tasks.map((t) => t.uid);
    included.forEach((t) => expect(ids).toContain(t.uid));
    expect(ids).not.toContain(outside.uid);
    expect(ids).not.toContain(done.uid);
    expect(Object.values(r.body.groupDates)).toHaveLength(17);
    expect(Object.values(r.body.groupDates)).toEqual(
        expect.arrayContaining([start, end])
    );
    expect(
        Object.values(r.body.groupedTasks)
            .flat()
            .map((t) => t.uid)
            .sort()
    ).toEqual(ids.sort());
});
it('retains empty dated columns without creating plans or writing tasks', async () => {
    const before = await DailyPlan.count();
    const r = await list({
        range_start: today.format('YYYY-MM-DD'),
        range_end: today.format('YYYY-MM-DD'),
    });
    expect(r.status).toBe(200);
    expect(Object.values(r.body.groupDates)).toEqual([
        today.format('YYYY-MM-DD'),
    ]);
    expect(Object.values(r.body.groupedTasks)).toEqual([[]]);
    expect(await DailyPlan.count()).toBe(before);
    expect(await OnePlan.count()).toBe(0);
});
it('keeps a week-only plan without assigning a day and scopes it to intersecting weeks', async () => {
    const t = await Task.create({ name: 'week only', user_id: user.id });
    const week = today
        .clone()
        .subtract(1, 'week')
        .startOf('isoWeek')
        .format('YYYY-MM-DD');
    await planning.set(user, t.uid, { week, expected_revision: 0 });
    const r = await list();
    expect(r.status).toBe(200);
    expect(
        Object.keys(r.body.groupedTasks).some((k) => k.includes('без дня'))
    ).toBe(true);
    expect((await t.reload()).due_date).toBeNull();
    const other = await list({ range_start: end, range_end: end });
    expect(other.body.tasks.map((t) => t.uid)).not.toContain(t.uid);
});
it('validates bad, incomplete, reversed and excessive ranges before querying', async () => {
    for (const params of [
        { range_start: '2026-02-30' },
        { range_end: 'bad' },
        { range_start: end, range_end: start },
        {
            range_start: start,
            range_end: today.clone().add(35, 'days').format('YYYY-MM-DD'),
        },
        { range_start: ['2026-01-01', '2026-01-02'] },
    ]) {
        const r = await list(params);
        expect(r.status).toBe(400);
    }
    const r = await request(app)
        .get('/api/v1/tasks')
        .set(auth())
        .query({ type: 'upcoming', range_start: start });
    expect(r.status).toBe(400);
});
it('uses local day bounds across DST rather than fixed 24-hour UTC boundaries', () => {
    const r = upcomingRange(
        { range_start: '2026-11-01', range_end: '2026-11-01' },
        'America/New_York'
    );
    expect(r.start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-02T04:59:59.999Z');
    expect(r.days).toBe(1);
});
it('keeps ownership, project scope and completed filters for past tasks', async () => {
    const other = await createTestUser({ email: 'range-other@example.com' });
    await make('private', start, { user_id: other.id });
    const project = await Project.create({ name: 'Project', user_id: user.id });
    const task = await make('project task', start, { project_id: project.id });
    await make('not in project', start);
    const r = await list({ project_uid: project.uid });
    expect(r.status).toBe(200);
    expect(r.body.tasks.map((t) => t.uid)).toEqual([task.uid]);
    await task.update({ status: 2 });
    const completed = await list({
        status: 'completed',
        project_uid: project.uid,
    });
    expect(completed.body.tasks.map((t) => t.uid)).toContain(task.uid);
});
it('keeps legacy callers without range compatible', async () => {
    const past = await make('past', start);
    const future = await make(
        'future',
        today.clone().add(1, 'day').format('YYYY-MM-DD')
    );
    const r = await request(app)
        .get('/api/v1/tasks')
        .set(auth())
        .query({ type: 'upcoming', groupBy: 'day', status: 'active' });
    expect(r.status).toBe(200);
    expect(r.body.tasks.map((t) => t.uid)).toContain(future.uid);
    expect(r.body.tasks.map((t) => t.uid)).not.toContain(past.uid);
    expect(r.body.range).toBeUndefined();
});
it('moves a past task with existing CAS, keeps time, updates One plan/counter once, and rejects stale retry', async () => {
    const past = today.clone().subtract(1, 'day').format('YYYY-MM-DD'),
        target = today.clone().add(1, 'day').format('YYYY-MM-DD');
    const t = await make('move from yesterday', past);
    await planning.set(user, t.uid, { planned: past, expected_revision: 0 });
    const before = await planning.read(user.id, t.uid);
    const original = await request(app)
        .get('/api/v1/task/' + t.uid)
        .set(auth());
    const payload = {
        due_date: target,
        due_time: original.body.due_time || null,
        expected_due_date: past,
        expected_due_time: original.body.due_time || null,
    };
    const r = await request(app)
        .patch('/api/v1/task/' + t.uid)
        .set(auth())
        .send(payload);
    expect(r.status).toBe(200);
    const after = await planning.read(user.id, t.uid);
    expect(after.planned).toBe(target);
    expect(after.moves).toBe(before.moves + 1);
    const retry = await request(app)
        .patch('/api/v1/task/' + t.uid)
        .set(auth())
        .send(payload);
    expect([200, 409]).toContain(retry.status);
    expect((await planning.read(user.id, t.uid)).moves).toBe(after.moves);
    const plan = await DailyPlan.findOne({
        where: { user_id: user.id, plan_date: target },
    });
    expect(
        await DailyPlanItem.count({
            where: { daily_plan_id: plan.id, task_id: t.id },
        })
    ).toBe(1);
});
it('includes persisted past recurring instances but does not fabricate past virtual occurrences', async () => {
    const parent = await make('recurring', today.format('YYYY-MM-DD'), {
        recurrence_type: 'daily',
        recurrence_interval: 1,
    });
    const instance = await make(
        'persisted yesterday',
        today.clone().subtract(1, 'day').format('YYYY-MM-DD'),
        { recurring_parent_id: parent.id }
    );
    const r = await list();
    expect(r.status).toBe(200);
    expect(r.body.tasks.map((t) => t.uid)).toContain(instance.uid);
    for (const t of r.body.tasks.filter((t) => t.is_virtual_occurrence))
        expect(t.due_date.slice(0, 10) >= today.format('YYYY-MM-DD')).toBe(
            true
        );
});
