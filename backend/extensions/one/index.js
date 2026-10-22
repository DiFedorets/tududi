'use strict';
const express = require('express');
const service = require('./service');
const planning = require('./planning');
const routes = express.Router();
const wrap = (handler) => async (req, res, next) => {
    try {
        res.json(await handler(req));
    } catch (err) {
        next(err);
    }
};
routes.get(
    '/extensions/one',
    wrap((req) => service.dashboard(req.currentUser))
);
routes.get(
    '/extensions/one/move-counts',
    wrap((req) => service.moveCounts(req.currentUser))
);
routes.get(
    '/extensions/one/sync',
    wrap((req) => require('./syncStatus').read(req.currentUser))
);
routes.get(
    '/extensions/one/counts',
    wrap(async (req) => {
        const d = await service.dashboard(req.currentUser);
        return {
            enabled: d.enabled,
            agent_owes: d.agent_owes.length,
            human_owes: d.human_owes.length,
            today: d.today,
        };
    })
);
routes.post(
    '/extensions/one/enable',
    wrap((req) => service.enable(req.currentUser))
);
routes.get(
    '/extensions/one/tasks/:uid',
    wrap((req) => service.taskInfo(req.currentUser, req.params.uid))
);
routes.put(
    '/extensions/one/tasks/:uid/plan',
    wrap((req) => planning.set(req.currentUser, req.params.uid, req.body))
);
function registerTools(server, context, tools) {
    const user = () => require('../../models').User.findByPk(context.userId);
    tools.push({
        name: 'one_overview',
        description:
            'Read both One dialogue queues, including closed tasks, and the caller’s personal day/week plans. No model calls.',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(await service.dashboard(await user())),
                },
            ],
        }),
    });
    tools.push({
        name: 'one_task_plan',
        description:
            'Read the current personal plan and revision for a task before rescheduling it.',
        inputSchema: {
            type: 'object',
            properties: { task_uid: { type: 'string' } },
            required: ['task_uid'],
        },
        handler: async (p) => ({
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        await service.taskInfo(await user(), p.task_uid)
                    ),
                },
            ],
        }),
    });
    tools.push({
        name: 'one_schedule',
        description:
            'Set the caller’s personal planned day OR week (normalized to Monday), or clear both. Requires the revision read with one_task_plan. Uses the native task date for a concrete day. Moves are counted automatically.',
        inputSchema: {
            type: 'object',
            properties: {
                task_uid: { type: 'string' },
                planned: { type: ['string', 'null'] },
                week: { type: ['string', 'null'] },
                expected_revision: { type: 'integer' },
            },
            required: ['task_uid', 'expected_revision'],
        },
        handler: async (p) => ({
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        await planning.set(await user(), p.task_uid, p)
                    ),
                },
            ],
        }),
    });
    tools.push({
        name: 'one_reply',
        description:
            'Append an agent reply to the SAME task thread and atomically mark prior human comments answered. Use a question mark only when requesting a human reply. Does not close the task.',
        inputSchema: {
            type: 'object',
            properties: {
                task_uid: { type: 'string' },
                body: { type: 'string' },
            },
            required: ['task_uid', 'body'],
        },
        handler: async (p) => ({
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        await service.reply(await user(), p.task_uid, p.body)
                    ),
                },
            ],
        }),
    });
}
module.exports = { routes, registerTools };
