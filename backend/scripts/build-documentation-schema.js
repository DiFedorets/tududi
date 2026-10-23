// Disposable documentation fixture, NOT a production migration runner.
// Refuse existing files; caller must provide an explicit scratch SQLite path.
const fs = require('fs');
if (!process.env.DB_FILE || fs.existsSync(process.env.DB_FILE)) {
    throw new Error('Set DB_FILE to a new disposable SQLite file');
}
const { execFileSync } = require('child_process');
const path = require('path');
// Explicitly pin SQLite, irrespective of the caller's database URL.
const env = { ...process.env, DATABASE_URL: '', DB_DIALECT: 'sqlite' };
const cwd = path.join(__dirname, '..');
for (const args of [
    ['scripts/db-prepare.js'],
    [
        require.resolve('sequelize-cli/lib/sequelize'),
        'db:migrate',
        '--config',
        'config/database.js',
    ],
]) {
    execFileSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
}
