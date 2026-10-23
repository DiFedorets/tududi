const { DataTypes } = require('sequelize');
const { uid } = require('../utils/uid');
module.exports = (s) =>
    s.define(
        'NoteFragment',
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            uid: {
                type: DataTypes.STRING,
                unique: true,
                allowNull: false,
                defaultValue: uid,
            },
            note_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: 'notes', key: 'id' },
                onDelete: 'CASCADE',
            },
            quote: { type: DataTypes.TEXT, allowNull: false },
            prefix: { type: DataTypes.TEXT, allowNull: false },
            suffix: { type: DataTypes.TEXT, allowNull: false },
            original_from: { type: DataTypes.INTEGER, allowNull: false },
            original_to: { type: DataTypes.INTEGER, allowNull: false },
            created_revision: { type: DataTypes.INTEGER, allowNull: false },
            start_offset: { type: DataTypes.INTEGER, allowNull: true },
            end_offset: { type: DataTypes.INTEGER, allowNull: true },
            state: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: 'located',
            },
            content_hash: { type: DataTypes.STRING(64), allowNull: false },
        },
        {
            tableName: 'note_fragments',
            indexes: [
                {
                    unique: true,
                    fields: [
                        'note_id',
                        'created_revision',
                        'original_from',
                        'original_to',
                    ],
                    name: 'note_fragments_original_selection',
                },
            ],
        }
    );
