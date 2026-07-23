import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { TaskSnapshot } from '../src/domain/trading.js'

export class TaskRepository {
  private readonly database: DatabaseSync

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
    this.database = new DatabaseSync(databasePath)
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
  }

  save(snapshot: TaskSnapshot): TaskSnapshot {
    const updated = { ...snapshot, updatedAt: new Date().toISOString() }
    this.database.prepare(`
      INSERT INTO tasks (id, mission_id, phase, snapshot_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        phase = excluded.phase,
        snapshot_json = excluded.snapshot_json,
        updated_at = excluded.updated_at
    `).run(updated.id, updated.missionId, updated.phase, JSON.stringify(updated), updated.createdAt, updated.updatedAt)
    return updated
  }

  findById(id: string): TaskSnapshot | undefined {
    const row = this.database.prepare('SELECT snapshot_json FROM tasks WHERE id = ?').get(id) as { snapshot_json: string } | undefined
    return row ? JSON.parse(row.snapshot_json) as TaskSnapshot : undefined
  }

  close(): void {
    this.database.close()
  }
}
