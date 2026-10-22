const { Task, TaskAttachment } = require('../../models');
const { deleteAttachmentFiles } = require('../../utils/attachment-utils');

class TaskRepository {
    constructor() {
        this.model = Task;
    }

    async findById(id, options = {}) {
        return await this.model.findByPk(id, options);
    }

    async findByIdAndUser(id, userId, options = {}) {
        const whereClause = { id, user_id: userId };
        return await this.model.findOne({
            where: whereClause,
            ...options,
        });
    }

    async findByUid(uid, options = {}) {
        return await this.model.findOne({
            where: { uid },
            ...options,
        });
    }

    async findRecurringChildren(recurringParentId, options = {}) {
        const { where = {}, ...restOptions } = options;
        return await this.model.findAll({
            where: { recurring_parent_id: recurringParentId, ...where },
            ...restOptions,
        });
    }

    async findAll(filters = {}, options = {}) {
        const { where = {}, ...restOptions } = options;
        return await this.model.findAll({
            where: { ...where, ...filters },
            ...restOptions,
        });
    }

    async findByUser(userId, filters = {}, options = {}) {
        const { where = {}, ...restOptions } = options;
        return await this.model.findAll({
            where: { user_id: userId, ...where, ...filters },
            ...restOptions,
        });
    }

    async create(taskData, options = {}) {
        const { User, sequelize } = require('../../models');
        const user =
            taskData.due_date &&
            (await User.findByPk(taskData.user_id, {
                transaction: options.transaction,
            }));
        if (
            !user?.one_actor ||
            (taskData.recurrence_type && taskData.recurrence_type !== 'none')
        )
            return this.model.create(taskData, options);
        const create = async (transaction) => {
            const task = await this.model.create(taskData, {
                ...options,
                transaction,
            });
            const moment = require('moment-timezone');
            await require('../../extensions/one/planning').change(
                user,
                task,
                {
                    planned: moment(task.due_date)
                        .tz(user.timezone || 'UTC')
                        .format('YYYY-MM-DD'),
                    week: null,
                },
                transaction
            );
            return task;
        };
        return options.transaction
            ? create(options.transaction)
            : require('../../extensions/one/write')(() =>
                  sequelize.transaction({ type: 'IMMEDIATE' }, create)
              );
    }

    async update(id, userId, updates) {
        const task = await this.findByIdAndUser(id, userId);
        if (!task) {
            return null;
        }
        await task.update(updates);
        return task;
    }

    async delete(id, userId) {
        const task = await this.findByIdAndUser(id, userId, {
            include: [{ model: TaskAttachment, as: 'Attachments' }],
        });
        if (!task) {
            return null;
        }
        // Unlink attachment files from disk before destroying rows, so a
        // dangling file never outlives the record that gated its access
        // (GHSA-43p8-ch4p-gqg4).
        await deleteAttachmentFiles(task.Attachments);
        await TaskAttachment.destroy({ where: { task_id: task.id } });
        await task.destroy();
        return task;
    }

    async count(filters = {}, options = {}) {
        const { where = {}, ...restOptions } = options;
        return await this.model.count({
            where: { ...where, ...filters },
            ...restOptions,
        });
    }

    async bulkUpdate(updates, conditions) {
        return await this.model.update(updates, conditions);
    }

    async findChildren(parentTaskId, userId, options = {}) {
        const { where = {}, ...restOptions } = options;
        return await this.model.findAll({
            where: { parent_task_id: parentTaskId, user_id: userId, ...where },
            ...restOptions,
        });
    }

    async findByUidOnly(uid, options = {}) {
        return await this.model.findOne({
            where: { uid },
            attributes: options.attributes || ['uid'],
            ...options,
        });
    }

    async clearRecurringParent(recurringParentId) {
        return await this.model.update(
            { recurring_parent_id: null },
            { where: { recurring_parent_id: recurringParentId } }
        );
    }

    async destroyMany(conditions) {
        return await this.model.destroy(conditions);
    }

    async createMany(tasksData) {
        return await Promise.all(
            tasksData.map((taskData) => this.model.create(taskData))
        );
    }

    async updateChildren(parentTaskId, userId, updates) {
        return await this.model.update(updates, {
            where: { parent_task_id: parentTaskId, user_id: userId },
        });
    }

    async updateChildrenWithConditions(
        parentTaskId,
        userId,
        updates,
        extraWhere = {}
    ) {
        return await this.model.update(updates, {
            where: {
                parent_task_id: parentTaskId,
                user_id: userId,
                ...extraWhere,
            },
        });
    }
}

module.exports = new TaskRepository();
