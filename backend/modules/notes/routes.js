'use strict';

const express = require('express');
const router = express.Router();
const notesController = require('./controller');
const { hasAccess } = require('../../middleware/authorize');
const attachmentRoutes = require('./attachmentRoutes');
const { requireFeature } = require('../../middleware/entitlements');

// All routes require authentication (handled by app.js middleware)

// List all notes
router.get('/notes', notesController.list);

// Get a single note (requires read access)
router.get(
    '/note/:uidSlug',
    hasAccess('ro', 'note', (req) => notesController.getNoteUidForAuth(req), {
        notFoundMessage: 'Note not found.',
    }),
    notesController.getOne
);

// Create a new note
router.post('/note', notesController.create);

// Update a note (requires write access)
router.patch(
    '/note/:uid',
    hasAccess('rw', 'note', (req) => notesController.getNoteUidForAuth(req), {
        notFoundMessage: 'Note not found.',
    }),
    notesController.update
);

// Delete a note (requires write access)
router.delete(
    '/note/:uid',
    hasAccess('rw', 'note', (req) => notesController.getNoteUidForAuth(req), {
        notFoundMessage: 'Note not found.',
    }),
    notesController.delete
);

// Get backlinks — notes that reference this note via [[title]]
router.get(
    '/note/:uid/backlinks',
    hasAccess('ro', 'note', (req) => notesController.getNoteUidForAuth(req), {
        notFoundMessage: 'Note not found.',
    }),
    notesController.backlinks
);

// Public sharing: only the owner can read or change it (checked in the
// service). Making a link is not part of a Cloud trial; turning one off is
// always allowed.
router.get(
    '/note/:uid/public-share',
    hasAccess('ro', 'note', (req) => notesController.getNoteUidForAuth(req), {
        notFoundMessage: 'Note not found.',
    }),
    notesController.getPublicShare
);

router.post(
    '/note/:uid/public-share',
    hasAccess('ro', 'note', (req) => notesController.getNoteUidForAuth(req), {
        notFoundMessage: 'Note not found.',
    }),
    requireFeature('public_notes'),
    notesController.enablePublicShare
);

router.patch(
    '/note/:uid/public-share',
    hasAccess('ro', 'note', (req) => notesController.getNoteUidForAuth(req), {
        notFoundMessage: 'Note not found.',
    }),
    requireFeature('public_notes'),
    notesController.updatePublicShare
);

router.post(
    '/note/:uid/public-share/rotate',
    hasAccess('ro', 'note', (req) => notesController.getNoteUidForAuth(req), {
        notFoundMessage: 'Note not found.',
    }),
    requireFeature('public_notes'),
    notesController.rotatePublicShare
);

router.delete(
    '/note/:uid/public-share',
    hasAccess('ro', 'note', (req) => notesController.getNoteUidForAuth(req), {
        notFoundMessage: 'Note not found.',
    }),
    notesController.disablePublicShare
);

router.use(attachmentRoutes);

router.use(require('../tasks/noteLinks/routes')('note'));

const fragments = require('./fragments');
const { getAuthenticatedUserId } = require('../../utils/request-utils');
const fragmentRoute = (action) => async (req, res, next) => {
    try {
        const args = [getAuthenticatedUserId(req), req.params.noteUid];
        if (action === 'create')
            return res
                .status(201)
                .json(await fragments.create(...args, req.body));
        res.json(await fragments.get(...args, req.params.fragmentUid));
    } catch (error) {
        if (error instanceof fragments.FragmentError)
            return res.status(error.status).json({ error: error.message });
        next(error);
    }
};
router.post('/note/:noteUid/fragments', fragmentRoute('create'));
router.get('/note/:noteUid/fragments/:fragmentUid', fragmentRoute('get'));
module.exports = router;
