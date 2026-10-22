const { Task, Note, TaskNoteLink } = require('../../../models');
const permissions = require('../../../services/permissionsService');
class LinkError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
const opposite = (type) => (type === 'task' ? 'note' : 'task');
const model = (type) => (type === 'task' ? Task : Note);
async function resource(type, uid, userId, write = false) {
    if (!['task', 'note'].includes(type) || typeof uid !== 'string' || !uid)
        throw new LinkError(404, 'Not found');
    const access = await permissions.getAccess(userId, type, uid);
    if (access === 'none' || (write && !['rw', 'admin'].includes(access)))
        throw new LinkError(404, 'Not found');
    const row = await model(type).findOne({ where: { uid } });
    if (!row) throw new LinkError(404, 'Not found');
    return row;
}
async function list(type, uid, userId) {
    const owner = await resource(type, uid, userId);
    const otherType = opposite(type);
    const links = await TaskNoteLink.findAll({
        where: { [type + '_id']: owner.id },
        order: [['id', 'ASC']],
    });
    const result = [];
    for (const link of links) {
        const other = await model(otherType).findByPk(link[otherType + '_id']);
        if (
            !other ||
            (await permissions.getAccess(userId, otherType, other.uid)) ===
                'none'
        )
            continue;
        // Relationship metadata is visible only with access to both endpoints.
        const a = await permissions.getAccess(userId, type, owner.uid);
        const b = await permissions.getAccess(userId, otherType, other.uid);
        result.push({
            uid: link.uid,
            type: link.relation_type,
            can_remove:
                ['rw', 'admin'].includes(a) && ['rw', 'admin'].includes(b),
            target: {
                uid: other.uid,
                type: otherType,
                title: otherType === 'task' ? other.name : other.title,
                ...(otherType === 'task' ? { status: other.status } : {}),
            },
        });
    }
    return result;
}
async function create(type, uid, userId, body) {
    if (!['related_to', 'source'].includes(body?.type))
        throw new LinkError(400, 'Invalid link type');
    const a = await resource(type, uid, userId, true);
    const b = await resource(opposite(type), body.target_uid, userId, true);
    const task = type === 'task' ? a : b,
        note = type === 'note' ? a : b;
    const [link] = await TaskNoteLink.findOrCreate({
        where: { task_id: task.id, note_id: note.id, relation_type: body.type },
        defaults: { created_by_user_id: userId },
    });
    return { uid: link.uid };
}
async function remove(type, uid, userId, linkUid) {
    const a = await resource(type, uid, userId, true);
    const link = await TaskNoteLink.findOne({
        where: { uid: linkUid, [type + '_id']: a.id },
    });
    if (!link) throw new LinkError(404, 'Not found');
    const b = await model(opposite(type)).findByPk(
        link[opposite(type) + '_id']
    );
    if (!b) throw new LinkError(404, 'Not found');
    await resource(opposite(type), b.uid, userId, true);
    await link.destroy();
}
module.exports = { list, create, remove, LinkError };
