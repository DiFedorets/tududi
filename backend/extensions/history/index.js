'use strict';
const express = require('express');
const service = require('./service');
const routes = express.Router();
const { requireFeature } = require('../../middleware/entitlements');
routes.post(
    '/extensions/history/answer',
    requireFeature('ai'),
    async (req, res, next) => {
        try {
            res.json(
                await require('./answer').answer(
                    req.currentUser.id,
                    req.body.query
                )
            );
        } catch (error) {
            next(error);
        }
    }
);
routes.post(
    '/extensions/history/answer/stream',
    requireFeature('ai'),
    async (req, res) => {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        const send = (event) => {
            if (res.destroyed) throw new Error('Reader disconnected');
            res.write(JSON.stringify(event) + '\n');
        };
        try {
            const result = await require('./answer').answer(
                req.currentUser.id,
                req.body.query,
                send
            );
            send({ type: 'done', ...result });
        } catch (error) {
            if (!res.destroyed)
                send({
                    type: 'error',
                    message: error.isOperational
                        ? error.message
                        : 'Не удалось завершить ответ модели. Источники доступны в поиске.',
                });
        } finally {
            res.end();
        }
    }
);
routes.get('/extensions/history/search', async (req, res, next) => {
    try {
        res.json(await service.search(req.currentUser.id, req.query));
    } catch (error) {
        next(error);
    }
});
routes.get('/extensions/history/source/:type/:uid', async (req, res, next) => {
    try {
        res.json(
            await service.source(
                req.currentUser.id,
                req.params.type,
                req.params.uid
            )
        );
    } catch (error) {
        next(error);
    }
});
function registerTools(server, context, tools) {
    tools.push({
        name: 'search_history',
        description:
            'Search full task, note and comment text. Returns source links, exact excerpts, authors, dates and transcript timecodes. Multiple words match ANY term; use quoted phrases for exact phrases. Read history_source before drawing conclusions.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                limit: { type: 'integer', minimum: 1, maximum: 100 },
                offset: { type: 'integer', minimum: 0 },
            },
            required: ['query'],
        },
        handler: async (params) => ({
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        await service.search(context.userId, params)
                    ),
                },
            ],
        }),
    });
    tools.push({
        name: 'history_source',
        description:
            'Read an authorized full source and its visible related sources. Source dates are record dates; a transcript date must be supported by its contents.',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['task', 'note', 'comment'] },
                uid: { type: 'string' },
            },
            required: ['type', 'uid'],
        },
        handler: async (params) => ({
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        await service.source(
                            context.userId,
                            params.type,
                            params.uid
                        )
                    ),
                },
            ],
        }),
    });
}
module.exports = { id: 'one-history', version: '0.1.0', routes, registerTools };
