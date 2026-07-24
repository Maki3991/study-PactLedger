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
        owner_id TEXT,
        phase TEXT NOT NULL,
        snapshot_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS owner_id TEXT;
      CREATE INDEX IF NOT EXISTS tasks_owner_created_idx
        ON tasks (owner_id, created_at DESC);
    `)
  }

  async save(snapshot: TaskSnapshot): Promise<TaskSnapshot> {
    const updated = { ...snapshot, updatedAt: new Date().toISOString() }
    if (!this.pool) {
      this.memory.set(updated.id, structuredClone(updated))
      return updated
    }

    await this.pool.query(`
      INSERT INTO tasks (id, mission_id, owner_id, phase, snapshot_json, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      ON CONFLICT(id) DO UPDATE SET
        mission_id = EXCLUDED.mission_id,
        owner_id = EXCLUDED.owner_id,
        phase = EXCLUDED.phase,
        snapshot_json = EXCLUDED.snapshot_json,
        updated_at = EXCLUDED.updated_at
    `, [
      updated.id,
      updated.missionId,
      updated.ownerId ?? null,
      updated.phase,
      JSON.stringify(updated),
      updated.createdAt,
      updated.updatedAt,
    ])
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
    return parseSnapshot(result.rows[0]?.snapshot_json)
  }

  async findByUser(userId: string): Promise<TaskSnapshot[]> {
    if (!this.pool) {
      return [...this.memory.values()]
        .filter((snapshot) => snapshot.ownerId === userId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((snapshot) => structuredClone(snapshot))
    }

    const result = await this.pool.query<{ snapshot_json: TaskSnapshot | string }>(`
      SELECT snapshot_json FROM tasks
      WHERE owner_id = $1
      ORDER BY created_at DESC
    `, [userId])
    return result.rows
      .map((row) => parseSnapshot(row.snapshot_json))
      .filter((snapshot): snapshot is TaskSnapshot => Boolean(snapshot))
  }
}

function parseSnapshot(payload: TaskSnapshot | string | undefined): TaskSnapshot | undefined {
  if (!payload) return undefined
  return typeof payload === 'string' ? JSON.parse(payload) as TaskSnapshot : payload
}
