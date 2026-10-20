'use strict';
const { Op } = require('sequelize');
const { Comment, Task, User, sequelize } = require('../../models');
const { AppError, ForbiddenError } = require('../../shared/errors');
async function assertCanClose(taskId, transaction) {
    if (
        await Comment.count({
            where: { task_id: taskId, one_pending: true, deleted_at: null },
            transaction,
        })
    )
        throw new AppError(
            'Сначала ответьте на комментарий человека в этой задаче.',
            409,
            'ONE_UNANSWERED'
        );
}
async function roleFor(task, userId, channel) {
    const owner = await User.findByPk(task.user_id);
    if (!owner?.one_actor) return null;
    require('./planning').supported();
    const actor = await User.findByPk(userId);
    return channel === 'mcp' || actor?.one_actor === 'agent'
        ? 'agent'
        : 'human';
}
async function create(task, userId, values, channel) {
    const role = await roleFor(task, userId, channel);
    // One transaction makes adding the reply and settling prior comments atomic.
    if (!role)
        return Comment.create({ ...values, task_id: task.id, user_id: userId });
    return require('./write')(() =>
        sequelize.transaction({ type: 'IMMEDIATE' }, async (transaction) => {
            const comment = await Comment.create(
                {
                    ...values,
                    task_id: task.id,
                    user_id: userId,
                    one_role: role,
                    one_pending: role === 'human',
                },
                { transaction }
            );
            if (role === 'agent')
                await Comment.update(
                    { one_pending: false, one_answered_at: comment.created_at },
                    {
                        where: {
                            task_id: task.id,
                            one_pending: true,
                            id: { [Op.lt]: comment.id },
                            ...(values.parent_comment_id
                                ? {
                                      [Op.or]: [
                                          { id: values.parent_comment_id },
                                          {
                                              parent_comment_id:
                                                  values.parent_comment_id,
                                          },
                                      ],
                                  }
                                : {}),
                        },
                        transaction,
                    }
                );
            return comment;
        })
    );
}
function assertMutable(comment) {
    if (comment.one_role)
        throw new ForbiddenError(
            'Лента One только дополняется. Напишите уточнение новым комментарием.'
        );
}
module.exports = { assertCanClose, create, assertMutable, roleFor };
