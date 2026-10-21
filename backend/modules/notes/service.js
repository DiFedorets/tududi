'use strict';

const entitlements = require('../../services/entitlementsService');
const _ = require('lodash');
const notesRepository = require('./repository');
const { recordChanges, fields: recordFields } = require('./recordTypes');
const { validateUid, validateBackground } = require('./validation');
const {
    NotFoundError,
    ValidationError,
    ForbiddenError,
    ConflictError,
    AppError,
} = require('../../shared/errors');
const { Tag, Project, Note, sequelize } = require('../../models');
const { validateTagName } = require('../tags/tagsService');
const permissionsService = require('../../services/permissionsService');
const scopeService = require('../../services/scopeService');
const { sortTags } = require('../tasks/core/serializers');
const { logError } = require('../../services/logService');
const { noteAttachments } = require('../../services/entityAttachments');

/**
 * Serialize a note with sorted tags.
 */
function serializeNote(note) {
    const noteJson = note.toJSON ? note.toJSON() : note;
    return {
        ...noteJson,
        Tags: sortTags(noteJson.Tags),
    };
}

/**
 * Parse tags from request body (array of strings or objects with name).
 */
function parseTagsFromBody(tags) {
    if (!Array.isArray(tags)) {
        return [];
    }
    if (tags.every((t) => typeof t === 'string')) {
        return tags;
    }
    if (tags.every((t) => typeof t === 'object' && t.name)) {
        return tags.map((t) => t.name);
    }
    return [];
}

/**
 * Update note tags.
 */
async function updateNoteTags(note, tagsArray, userId, transaction) {
    if (_.isEmpty(tagsArray)) {
        await note.setTags([], { transaction });
        return;
    }

    // Validate and filter tag names
    const validTagNames = [];
    const invalidTags = [];

    for (const name of tagsArray) {
        const validation = validateTagName(name);
        if (validation.valid) {
            if (!validTagNames.includes(validation.name)) {
                validTagNames.push(validation.name);
            }
        } else {
            invalidTags.push({ name, error: validation.error });
        }
    }

    if (invalidTags.length > 0) {
        throw new ValidationError(
            `Invalid tag names: ${invalidTags.map((t) => `"${t.name}" (${t.error})`).join(', ')}`
        );
    }

    // One connection/transaction: concurrent findOrCreate transactions lock SQLite.
    const tags = [];
    for (const name of validTagNames) {
        const [tag] = await Tag.findOrCreate({
            where: { name, user_id: userId },
            defaults: { name, user_id: userId },
            transaction,
        });
        tags.push(tag);
    }
    await note.setTags(tags, { transaction });
}

/**
 * Resolve project from UID or ID and check write access.
 */
async function resolveProjectWithAccess(userId, projectUid, projectId) {
    const projectIdentifier = projectUid || projectId;

    if (!projectIdentifier || _.isEmpty(projectIdentifier.toString().trim())) {
        return null;
    }

    let project;
    if (projectUid) {
        const projectUidValue = projectUid.toString().trim();
        project = await Project.findOne({ where: { uid: projectUidValue } });
    } else {
        project = await Project.findByPk(projectId);
    }

    if (!project) {
        throw new NotFoundError('Note project not found');
    }

    const projectAccess = await permissionsService.getAccess(
        userId,
        'project',
        project.uid
    );
    const isOwner = project.user_id === userId;
    const canWrite =
        isOwner || projectAccess === 'rw' || projectAccess === 'admin';

    if (!canWrite) {
        throw new ForbiddenError('Forbidden');
    }

    return project;
}

class NotesService {
    /**
     * Get all notes for a user with optional filtering.
     */
    async getAll(userId, options = {}) {
        const { orderBy = 'title:asc', tagFilter, scopeQuery } = options;
        const [orderColumn, orderDirection] = orderBy.split(':');

        // area_uid / project_uid / tags narrow the list to a Focus scope
        const scope = scopeQuery
            ? await scopeService.resolveScope(scopeQuery, userId)
            : null;
        const whereClause = scopeService.withScope(
            await permissionsService.ownershipOrPermissionWhere('note', userId),
            await scopeService.noteScopeWhere(scope)
        );

        const notes = await notesRepository.findAllWithIncludes(whereClause, {
            orderColumn,
            orderDirection: orderDirection.toUpperCase(),
            tagFilter,
        });

        return notes.map(serializeNote);
    }

    /**
     * Get a note by UID.
     */
    async getByUid(uid) {
        const validatedUid = validateUid(uid);
        const note = await notesRepository.findByUidWithIncludes(validatedUid);

        if (!note) {
            throw new NotFoundError('Note not found.');
        }

        return serializeNote(note);
    }

    /**
     * Check if a note exists and return its UID (for authorization middleware).
     */
    async getNoteUidIfExists(uid) {
        const validatedUid = validateUid(uid);
        const note = await notesRepository.findByUid(validatedUid);
        return note ? note.uid : null;
    }

    /**
     * Create a new note.
     */
    async create(
        userId,
        {
            title,
            content,
            project_uid,
            project_id,
            tags,
            color,
            background,
            record_kind,
            record_state,
            application_ref,
        }
    ) {
        await entitlements.assertCanCreate(userId, 'note');
        const noteAttributes = {
            title,
            content,
            ...recordChanges(
                null,
                { title, content, record_kind, record_state, application_ref },
                true
            ),
        };

        if (color !== undefined) {
            noteAttributes.color = color;
        }
        if (background !== undefined) {
            noteAttributes.background = validateBackground(background);
        }

        // Handle project assignment with permission check
        const project = await resolveProjectWithAccess(
            userId,
            project_uid,
            project_id
        );
        if (project) {
            noteAttributes.project_id = project.id;
        }

        const note = await sequelize.transaction(async (transaction) => {
            const created = await Note.create(
                { ...noteAttributes, user_id: userId },
                { transaction }
            );
            await updateNoteTags(
                created,
                parseTagsFromBody(tags),
                userId,
                transaction
            );
            return created;
        });

        // Reload with associations
        const noteWithAssociations = await notesRepository.findByIdWithIncludes(
            note.id
        );
        const serialized = serializeNote(noteWithAssociations);

        return {
            ...serialized,
            uid: noteWithAssociations.uid,
        };
    }

    /**
     * Update a note.
     */
    async update(
        userId,
        uid,
        {
            title,
            content,
            project_uid,
            project_id,
            tags,
            color,
            background,
            pin_to_sidebar,
            expected_revision,
            record_kind,
            record_state,
            application_ref,
        }
    ) {
        const validatedUid = validateUid(uid);
        const note = await notesRepository.findOne({ uid: validatedUid });

        if (!note) {
            throw new NotFoundError('Note not found.');
        }

        const recordInput = {
            title,
            content,
            record_kind,
            record_state,
            application_ref,
        };
        for (const key of Object.keys(recordInput))
            if (recordInput[key] === undefined) delete recordInput[key];
        const updateData = recordChanges(note, recordInput);
        if (title !== undefined) updateData.title = title;
        if (content !== undefined) updateData.content = content;
        if (color !== undefined) updateData.color = color;
        if (background !== undefined)
            updateData.background = validateBackground(background);
        if (pin_to_sidebar !== undefined)
            updateData.pin_to_sidebar = pin_to_sidebar;

        // Handle project assignment
        const projectIdentifier =
            project_uid !== undefined ? project_uid : project_id;

        if (projectIdentifier !== undefined) {
            if (projectIdentifier && projectIdentifier.toString().trim()) {
                let project;

                if (
                    project_uid !== undefined &&
                    typeof project_uid === 'string'
                ) {
                    const projectUidValue = project_uid.trim();
                    project = await Project.findOne({
                        where: { uid: projectUidValue },
                    });
                } else if (project_id !== undefined) {
                    project = await Project.findByPk(project_id);
                }

                if (!project) {
                    throw new ValidationError('Invalid project.');
                }

                const projectAccess = await permissionsService.getAccess(
                    userId,
                    'project',
                    project.uid
                );
                const isOwner = project.user_id === userId;
                const canWrite =
                    isOwner ||
                    projectAccess === 'rw' ||
                    projectAccess === 'admin';

                if (!canWrite) {
                    throw new ForbiddenError('Forbidden');
                }

                updateData.project_id = project.id;
            } else {
                updateData.project_id = null;
            }
        }

        // Text and tag edits require an explicit version from the reader.
        // Cosmetic one-click updates remain compatible with older clients.
        if (
            expected_revision === undefined &&
            (title !== undefined ||
                content !== undefined ||
                tags !== undefined ||
                recordFields.some((k) => recordInput[k] !== undefined))
        ) {
            throw new AppError(
                'Read the current note and pass expected_revision before editing text or tags.',
                428,
                'NOTE_REVISION_REQUIRED'
            );
        }
        const revision = expected_revision ?? note.revision;
        if (!Number.isInteger(revision) || revision < 0) {
            throw new ValidationError(
                'expected_revision must be a non-negative integer'
            );
        }
        await sequelize.transaction(async (transaction) => {
            const [changed] = await Note.update(
                { ...updateData, revision: revision + 1 },
                { where: { id: note.id, revision }, transaction }
            );
            if (changed !== 1) {
                throw new ConflictError(
                    'Note changed since you opened it. Keep your draft and reload the current version.'
                );
            }
            if (tags !== undefined) {
                await updateNoteTags(
                    note,
                    parseTagsFromBody(tags),
                    userId,
                    transaction
                );
            }
        });

        // Reload with associations
        const noteWithAssociations =
            await notesRepository.findByIdWithDetailedIncludes(note.id);
        return serializeNote(noteWithAssociations);
    }

    /**
     * Get all notes that contain [[noteTitle]] in their content (backlinks).
     */
    async getBacklinks(userId, uid) {
        const validatedUid = validateUid(uid);
        const note = await notesRepository.findByUid(validatedUid);
        if (!note) {
            throw new NotFoundError('Note not found.');
        }

        const { title } =
            await notesRepository.findByUidWithIncludes(validatedUid);
        const backlinks = await notesRepository.findBacklinks(userId, title);
        return backlinks
            .filter((b) => b.uid !== validatedUid)
            .map((b) => ({ uid: b.uid, title: b.title }));
    }

    /**
     * Delete a note.
     */
    async delete(uid) {
        const validatedUid = validateUid(uid);
        const note = await notesRepository.findOne({ uid: validatedUid });

        if (!note) {
            throw new NotFoundError('Note not found.');
        }

        await noteAttachments.removeAll(note.id);
        await notesRepository.destroy(note);
        return { message: 'Note deleted successfully.' };
    }
}

module.exports = new NotesService();
module.exports.serializeNote = serializeNote;
