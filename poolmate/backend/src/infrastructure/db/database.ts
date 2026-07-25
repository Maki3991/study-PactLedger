import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database
} from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";

interface MigrationRecord {
  filename: string;
  checksum: string;
}

export interface MigrationState {
  applied: number;
  pending: number;
  failed: boolean;
}

export class PoolMateDatabase {
  readonly orm: BetterSQLite3Database;
  private readonly sqlite: Database.Database;
  private migrationFailed = false;

  constructor(
    databasePath: string,
    private readonly migrationsDir: string
  ) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.sqlite = new Database(databasePath);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.pragma("busy_timeout = 5000");
    this.orm = drizzle(this.sqlite);
  }

  migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS pm_migrations (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);

    const appliedRows = this.sqlite
      .prepare("SELECT filename, checksum FROM pm_migrations")
      .all() as MigrationRecord[];
    const applied = new Map(
      appliedRows.map((row) => [row.filename, row.checksum])
    );
    const migrationFiles = this.migrationFiles();

    const applyMigration = this.sqlite.transaction(
      (filename: string, migrationSql: string, checksum: string) => {
        this.sqlite.exec(migrationSql);
        this.sqlite
          .prepare(
            "INSERT INTO pm_migrations (filename, checksum, applied_at) VALUES (?, ?, ?)"
          )
          .run(filename, checksum, new Date().toISOString());
      }
    );

    try {
      for (const filename of migrationFiles) {
        const migrationSql = fs.readFileSync(
          path.join(this.migrationsDir, filename),
          "utf8"
        );
        const checksum = createHash("sha256")
          .update(migrationSql)
          .digest("hex");
        const appliedChecksum = applied.get(filename);

        if (appliedChecksum && appliedChecksum !== checksum) {
          throw new Error(`Applied migration checksum changed: ${filename}`);
        }
        if (!appliedChecksum) {
          applyMigration.exclusive(filename, migrationSql, checksum);
        }
      }
      this.migrationFailed = false;
    } catch (error) {
      this.migrationFailed = true;
      throw error;
    }
  }

  migrationState(): MigrationState {
    let migrationFiles: string[] = [];
    try {
      migrationFiles = this.migrationFiles();
    } catch {
      this.migrationFailed = true;
    }
    const applied = this.sqlite
      .prepare("SELECT COUNT(*) AS count FROM pm_migrations")
      .get() as { count: number };

    return {
      applied: applied.count,
      pending: Math.max(0, migrationFiles.length - applied.count),
      failed: this.migrationFailed
    };
  }

  private migrationFiles(): string[] {
    if (!fs.existsSync(this.migrationsDir)) {
      throw new Error(
        `Migration directory does not exist: ${this.migrationsDir}`
      );
    }
    const migrationFiles = fs
      .readdirSync(this.migrationsDir)
      .filter((filename) => filename.endsWith(".sql"))
      .sort();
    if (!migrationFiles.length) {
      throw new Error(`Migration directory is empty: ${this.migrationsDir}`);
    }
    return migrationFiles;
  }

  ping(): boolean {
    try {
      this.orm.get<{ value: number }>(sql`SELECT 1 AS value`);
      return true;
    } catch {
      return false;
    }
  }

  read<T>(operation: (connection: Database.Database) => T): T {
    return operation(this.sqlite);
  }

  immediate<T>(operation: (connection: Database.Database) => T): T {
    return this.sqlite.transaction(operation).immediate(this.sqlite);
  }

  close(): void {
    this.sqlite.close();
  }
}
