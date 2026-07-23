import type { Pool } from 'pg'
import type { TaskSnapshot } from '../src/domain/trading.js'

export class TaskRepository {
  private readonly memory = new Map<string, TaskSnapshot>()

  constructor(private readonly pool?: Pool) {}

  async initialize(): Promise<void> {
    if (!this.pool) return
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        snapshot_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `)
  }

  async save(snapshot: TaskSnapshot): Promise<TaskSnapshot> {
    const updated = { ...snapshot, updatedAt: new Date().toISOString() }
    if (!this.pool) {
      this.memory.set(updated.id, structuredClone(updated))
      return updated
    }

    await this.pool.query(`
      INSERT INTO tasks (id, mission_id, phase, snapshot_json, created_at, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6)
      ON CONFLICT(id) DO UPDATE SET
        mission_id = EXCLUDED.mission_id,
        phase = EXCLUDED.phase,
        snapshot_json = EXCLUDED.snapshot_json,
        updated_at = EXCLUDED.updated_at
    `, [updated.id, updated.missionId, updated.phase, JSON.stringify(updated), updated.createdAt, updated.updatedAt])
    return updated
  }

  async findById(id: string): Promise<TaskSnapshot | undefined> {
    if (!this.pool) {
      const snapshot = this.memory.get(id)
      return snapshot ? structuredClone(snapshot) : undefined
    }

    const result = await this.pool.query<{ snapshot_json: TaskSnapshot | string }>(
      'SELECT snapshot_json FROM tasks WHERE id = $1',
      [id],
    )
    const payload = result.rows[0]?.snapshot_json
    if (!payload) return undefined
    return typeof payload === 'string' ? JSON.parse(payload) as TaskSnapshot : payload
  }
}
