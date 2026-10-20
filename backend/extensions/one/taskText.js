const { Op, fn, col, where } = require('sequelize');
const { Task, User } = require('../../models');
const { AppError } = require('../../shared/errors');
const fields = ['name', 'note'];
const normalized = (value) => (value == null ? '' : value);
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const conflict = () =>
    new AppError(
        'Название или описание уже изменены. Ваш текст не записан; перечитайте задачу и объедините изменения.',
        409,
        'TASK_TEXT_CONFLICT'
    );
async function assertExpected(task, input) {
    const expected = input.expected_fields;
    if (
        expected !== undefined &&
        (!expected ||
            typeof expected !== 'object' ||
            Array.isArray(expected) ||
            Object.keys(expected).some((key) => !fields.includes(key)))
    )
        throw new AppError(
            'expected_fields содержит только исходные name и note.',
            400,
            'TASK_TEXT_EXPECTATION_INVALID'
        );
    const enabled = (await User.findByPk(task.user_id))?.one_actor;
    if (
        enabled &&
        expected &&
        fields.some((field) => owns(input, field)) &&
        Object.keys(input).some(
            (key) =>
                key.startsWith('recurrence_') ||
                key === 'completion_based' ||
                key === 'update_parent_recurrence'
        )
    )
        throw new AppError(
            'Сохраните текст и настройки повторения отдельными действиями.',
            400,
            'TASK_TEXT_COMPOUND_UPDATE'
        );
    for (const field of fields) {
        if (!owns(input, field)) continue;
        if (expected && owns(expected, field)) {
            if (typeof expected[field] !== 'string' && expected[field] !== null)
                throw new AppError(
                    'Исходный текст должен быть строкой или null.',
                    400,
                    'TASK_TEXT_EXPECTATION_INVALID'
                );
            if (normalized(expected[field]) !== normalized(task[field]))
                throw conflict();
        } else if (
            enabled &&
            normalized(input[field]) !== normalized(task[field])
        )
            throw new AppError(
                'Перед изменением текста прочитайте задачу и передайте исходное значение в expected_fields.',
                428,
                'TASK_TEXT_EXPECTATION_REQUIRED'
            );
    }
}
async function update(task, attributes, input, options = {}) {
    const expected = input.expected_fields;
    const checked = fields.filter(
        (field) => owns(input, field) && expected && owns(expected, field)
    );
    if (!checked.length) return task.update(attributes, options);
    const [count] = await Task.update(attributes, {
        ...options,
        where: {
            id: task.id,
            [Op.and]: checked.map((field) =>
                where(
                    fn('COALESCE', col(field), ''),
                    normalized(expected[field])
                )
            ),
        },
    });
    if (count !== 1) throw conflict();
    await task.reload(options);
    return task;
}
module.exports = { assertExpected, update };
