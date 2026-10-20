'use strict';
const { DataTypes } = require('sequelize');
const { uid } = require('../utils/uid');
module.exports = (sequelize) =>
    sequelize.define(
        'OnePlan',
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
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onDelete: 'CASCADE',
            },
            task_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: 'tasks', key: 'id' },
                onDelete: 'CASCADE',
            },
            planned: { type: DataTypes.DATEONLY, allowNull: true },
            week: { type: DataTypes.DATEONLY, allowNull: true },
            last_planned: { type: DataTypes.DATEONLY, allowNull: true },
            moves: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            revision: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
        },
        {
            tableName: 'one_plans',
            indexes: [
                {
                    name: 'one_plans_user_task',
                    unique: true,
                    fields: ['user_id', 'task_id'],
                },
            ],
            validate: {
                exclusive() {
                    if (this.planned && this.week)
                        throw new Error('Choose day or week');
                },
            },
        }
    );
