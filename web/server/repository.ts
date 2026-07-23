import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { TaskSnapshot } from '../src/domain/trading.js'

export function openDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
  return new DatabaseSync(databasePath)
}

export class TaskRepository {
  private readonly database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.database = database
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    this.ensureUserColumn()
  }

  save(snapshot: TaskSnapshot): TaskSnapshot {
    const updated = { ...snapshot, updatedAt: new Date().toISOString() }
    this.database.prepare(`
      INSERT INTO tasks (id, mission_id, phase, snapshot_json, created_at, updated_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        phase = excluded.phase,
        snapshot_json = excluded.snapshot_json,
        updated_at = excluded.updated_at
    `).run(
      updated.id,
      updated.missionId,
      updated.phase,
      JSON.stringify(updated),
      updated.createdAt,
      updated.updatedAt,
      updated.ownerId ?? null,
    )
    return updated
  }

  findById(id: string): TaskSnapshot | undefined {
    const row = this.database.prepare('SELECT snapshot_json FROM tasks WHERE id = ?').get(id) as { snapshot_json: string } | undefined
    return row ? JSON.parse(row.snapshot_json) as TaskSnapshot : undefined
  }

  findByUser(userId: string): TaskSnapshot[] {
    const rows = this.database.prepare(`
      SELECT snapshot_json FROM tasks WHERE user_id = ? ORDER BY created_at DESC
    `).all(userId) as { snapshot_json: string }[]
    return rows.map((row) => JSON.parse(row.snapshot_json) as TaskSnapshot)
  }

  close(): void {
    this.database.close()
  }

  private ensureUserColumn(): void {
    const columns = this.database.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]
    if (!columns.some((column) => column.name === 'user_id')) {
      this.database.exec('ALTER TABLE tasks ADD COLUMN user_id TEXT')
    }
  }
}
