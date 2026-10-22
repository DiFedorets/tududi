const { DataTypes } = require('sequelize');
const { uid } = require('../utils/uid');
module.exports = (sequelize) =>
    sequelize.define(
        'TaskNoteLink',
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            uid: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true,
                defaultValue: uid,
            },
            task_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: 'tasks', key: 'id' },
                onDelete: 'CASCADE',
            },
            note_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: 'notes', key: 'id' },
                onDelete: 'CASCADE',
            },
            relation_type: {
                type: DataTypes.STRING,
                allowNull: false,
                validate: { isIn: [['related_to', 'source']] },
            },
            created_by_user_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onDelete: 'SET NULL',
            },
        },
        {
            tableName: 'task_note_links',
            indexes: [
                {
                    unique: true,
                    fields: ['task_id', 'note_id', 'relation_type'],
                    name: 'task_note_links_pair_type',
                },
                { fields: ['note_id'], name: 'task_note_links_note' },
            ],
        }
    );
