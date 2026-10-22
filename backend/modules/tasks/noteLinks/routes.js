const express = require('express');
const service = require('./service');
const { getAuthenticatedUserId } = require('../../../utils/request-utils');
const { logError } = require('../../../services/logService');
module.exports = (type) => {
    const router = express.Router();
    const path = `/${type}/:linkResourceUid/${type === 'task' ? 'note' : 'task'}-links`;
    const handler = (action) => async (req, res) => {
        try {
            const args = [
                type,
                req.params.linkResourceUid,
                getAuthenticatedUserId(req),
            ];
            if (action === 'list')
                return res.json({ links: await service.list(...args) });
            if (action === 'create')
                return res
                    .status(201)
                    .json(await service.create(...args, req.body));
            await service.remove(...args, req.params.linkUid);
            res.status(204).send();
        } catch (error) {
            if (error instanceof service.LinkError)
                return res.status(error.status).json({ error: error.message });
            logError('Task-note link failed', error);
            res.status(500).json({ error: 'Could not update links' });
        }
    };
    router.get(path, handler('list'));
    router.post(path, handler('create'));
    router.delete(path + '/:linkUid', handler('remove'));
    return router;
};
