"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSetting = getSetting;
exports.setSetting = setSetting;
exports.getAllSettingsRaw = getAllSettingsRaw;
exports.deleteSetting = deleteSetting;
const database_1 = require("./database");
function getSetting(key, defaultValue = '') {
    const db = (0, database_1.getDatabase)();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row?.value ?? defaultValue;
}
function setSetting(key, value) {
    const db = (0, database_1.getDatabase)();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}
function getAllSettingsRaw() {
    const db = (0, database_1.getDatabase)();
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
        settings[row.key] = row.value;
    }
    return settings;
}
function deleteSetting(key) {
    const db = (0, database_1.getDatabase)();
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}
//# sourceMappingURL=settings-service.js.map