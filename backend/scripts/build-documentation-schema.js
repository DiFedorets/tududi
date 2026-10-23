// Disposable documentation fixture, NOT a production migration runner.
// Refuse existing files; caller must provide an explicit scratch SQLite path.
const fs = require('fs');
if (!process.env.DB_FILE || fs.existsSync(process.env.DB_FILE)) {
    throw new Error('Set DB_FILE to a new disposable SQLite file');
}
const { sequelize } = require('../models');
async function main() {
    if (sequelize.getDialect() !== 'sqlite') throw new Error('SQLite only');
    await sequelize.sync();
    // This history table and its SQL triggers are migration-owned, not a model.
    await require('../migrations/20261023000001-strict-task-project-context').up(
        sequelize.getQueryInterface(),
        require('sequelize')
    );
}
main()
    .then(() => sequelize.close())
    .catch(async (error) => {
        console.error(error.message);
        await sequelize.close();
        process.exitCode = 1;
    });
