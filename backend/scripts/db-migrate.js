#!/usr/bin/env node

/**
 * Database Migration Script
 * Runs pending Umzug migration files to update the database schema
 */

require('dotenv').config();
const path = require('path');
const { Sequelize } = require('sequelize');
const Umzug = require('umzug');
const { buildSequelizeOptions } = require('../config/db');
const { guardMigrationHistory } = require('./lib/migrationHistory');

const sequelize = new Sequelize(buildSequelizeOptions({ logging: false }));

const umzug = new Umzug({
    migrations: {
        path: path.join(__dirname, '../migrations'),
        params: [sequelize.getQueryInterface(), Sequelize],
    },
    storage: 'sequelize',
    // Match sequelize-cli and db-prepare regardless of the application's
    // underscored model defaults. Otherwise Umzug creates sequelize_meta and
    // replays migrations already recorded in SequelizeMeta.
    storageOptions: { sequelize, tableName: 'SequelizeMeta' },
});

async function migrateDatabase() {
    try {
        await guardMigrationHistory(sequelize);
        console.log('Running pending migrations...');
        const pending = await umzug.pending();
        if (pending.length === 0) {
            console.log(
                '✅ No pending migrations - database schema is up to date'
            );
        } else {
            console.log(`Found ${pending.length} pending migration(s):`);
            pending.forEach((m) => console.log(`  - ${m.file}`));
            await umzug.up();
            console.log('✅ Migrations completed successfully');
        }
        await sequelize.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error running migrations:', error.message);
        await sequelize.close();
        process.exit(1);
    }
}

migrateDatabase();
