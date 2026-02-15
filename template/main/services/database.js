"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDatabase = getDatabase;
exports.initDatabase = initDatabase;
exports.closeDatabase = closeDatabase;
exports.generateId = generateId;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const crypto_1 = require("crypto");
let db = null;
function getDatabase() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}
function initDatabase(config) {
    // Store database in user data directory
    const userDataPath = electron_1.app.getPath('userData');
    const dbPath = path.join(userDataPath, config.filename);
    // Ensure directory exists
    if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
    }
    db = new better_sqlite3_1.default(dbPath);
    // Enable WAL mode for better performance
    db.pragma('journal_mode = WAL');
    // Run migrations
    runMigrations(config.migrations);
}
function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}
function runMigrations(migrations) {
    if (!db)
        return;
    // Create migrations table if not exists
    db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
    const appliedMigrations = db
        .prepare('SELECT name FROM migrations')
        .all()
        .map((row) => row.name);
    for (const migration of migrations) {
        if (!appliedMigrations.includes(migration.name)) {
            console.log(`Running migration: ${migration.name}`);
            const transaction = db.transaction(() => {
                db.exec(migration.sql);
                db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.name);
            });
            try {
                transaction();
            }
            catch (error) {
                console.error(`Migration ${migration.name} failed:`, error);
                throw error; // Re-throw to prevent app from starting with broken DB
            }
        }
    }
}
// Helper functions for common operations
function generateId() {
    return (0, crypto_1.randomUUID)();
}
//# sourceMappingURL=database.js.map