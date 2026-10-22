'use strict';
const fs = require('node:fs/promises');
function present(raw, now = Date.now()) {
    const stamp = Date.parse(raw.checkedAt);
    if (!Number.isFinite(stamp) || stamp > now + 60000) throw Error('INVALID_SYNC_TIMESTAMP');
    const expired = Number.isFinite(Date.parse(raw.expiresAt)) && Date.parse(raw.expiresAt) <= now;
    const stale = now - stamp > Math.max(120000, (Number(raw.intervalSeconds) || 30) * 4000);
    const conflicts = (Array.isArray(raw.conflicts) ? raw.conflicts : []).map(c => ({
        id: String(c.id), field: String(c.field), reason: String(c.reason).slice(0, 1600),
        ...(/^\/(task|notes)\/[a-z0-9]{15}$/.test(c.href || '') ? { href: c.href } : {}),
    }));
    const state = expired ? 'expired' : stale ? 'stale' : raw.error ? 'error' : !raw.running ? 'stopped' : conflicts.length ? 'conflict' : 'healthy';
    return { state, checkedAt: raw.checkedAt, lastSuccessAt: raw.lastSuccessAt || null,
        expiresAt: raw.expiresAt, intervalSeconds: raw.intervalSeconds,
        error: raw.error ? String(raw.error).slice(0, 1600) : null, conflicts,
        records: raw.records, notes: raw.notes, files: raw.files };
}
async function read(user) {
    // This temporary bridge belongs to the pilot owner's account only.
    if (user?.id !== 1) return { state: 'unavailable' };
    try {
        const filename = '/app/backups/one-sync-status.json';
        if ((await fs.stat(filename)).size > 1024 * 1024) throw Error('STATUS_TOO_LARGE');
        return present(JSON.parse(await fs.readFile(filename, 'utf8')));
    } catch (e) {
        return { state: e.code === 'ENOENT' ? 'unavailable' : 'unreadable' };
    }
}
module.exports = { read, present };
