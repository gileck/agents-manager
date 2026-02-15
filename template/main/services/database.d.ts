import Database from 'better-sqlite3';
export interface Migration {
    name: string;
    sql: string;
}
export interface DatabaseConfig {
    filename: string;
    migrations: Migration[];
}
export declare function getDatabase(): Database.Database;
export declare function initDatabase(config: DatabaseConfig): void;
export declare function closeDatabase(): void;
export declare function generateId(): string;
//# sourceMappingURL=database.d.ts.map