import type { PoolClient } from 'pg'
import { pool } from './pool'
import type { TaskSnapshot, AgentRun, StrategyCandidate, FirewallRule, TimelineEvent, TaskPhase } from '../types'

// ── helpers ──────────────────────────────────────────────────────────────────

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function nowLabel(): string {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// ── writes ───────────────────────────────────────────────────────────────────

export async function insertTask(
  client: PoolClient,
  id: string,
  missionId: string,
  objective: string,
  budgetUsdt: number,
  maxLossPct: number,
  maxAssetPct: number,
  asset: string,
): Promise<void> {
  await client.query(
    `INSERT INTO tasks (id, mission_id, objective, budget_usdt, max_loss_pct, max_asset_pct, asset)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, missionId, objective, budgetUsdt, maxLossPct, maxAssetPct, asset],
  )
}

export async function updateTaskPhase(
  taskId: string,
  phase: TaskPhase,
  execState?: string,
  txHash?: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE tasks SET phase=$2, exec_state=COALESCE($3, exec_state),
       tx_hash=COALESCE($4, tx_hash), updated_at=NOW()
     WHERE id=$1`,
    [taskId, phase, execState ?? null, txHash ?? null],
  )
}

export async function upsertAgents(taskId: string, agents: AgentRun[]): Promise<void> {
  for (const a of agents) {
    await pool.query(
      `INSERT INTO agent_runs (id, task_id, name, role, status, detail, elapsed)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id, task_id) DO UPDATE
         SET status=$5, detail=$6, elapsed=$7`,
      [a.id, taskId, a.name, a.role, a.status, a.detail, a.elapsed],
    )
  }
}

export async function upsertCandidates(taskId: string, candidates: StrategyCandidate[]): Promise<void> {
  for (const c of candidates) {
    await pool.query(
      `INSERT INTO strategy_candidates (id, task_id, name, status, note, return_pct, drawdown_pct, sharpe, signal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id, task_id) DO UPDATE
         SET status=$4, note=$5, return_pct=$6, drawdown_pct=$7, sharpe=$8, signal=$9`,
      [c.id, taskId, c.name, c.status, c.note, c.returnPct, c.drawdownPct, c.sharpe, c.signal],
    )
  }
}

export async function upsertFirewallRules(taskId: string, rules: FirewallRule[]): Promise<void> {
  // delete then reinsert for simplicity (rules rarely change)
  await pool.query(`DELETE FROM firewall_rules WHERE task_id=$1`, [taskId])
  for (const r of rules) {
    await pool.query(
      `INSERT INTO firewall_rules (task_id, label, lim, current, state) VALUES ($1,$2,$3,$4,$5)`,
      [taskId, r.label, r.limit, r.current, r.state],
    )
  }
}

export async function appendTimeline(taskId: string, event: TimelineEvent): Promise<void> {
  await pool.query(
    `INSERT INTO timeline_events (task_id, time_label, title, detail, tone)
     VALUES ($1,$2,$3,$4,$5)`,
    [taskId, event.time, event.title, event.detail, event.tone],
  )
}

// ── reads ────────────────────────────────────────────────────────────────────

export async function getTaskSnapshot(taskId: string): Promise<TaskSnapshot | null> {
  const taskRes = await pool.query(
    `SELECT id, mission_id, objective, phase, exec_state, tx_hash, created_at, updated_at
     FROM tasks WHERE id=$1`,
    [taskId],
  )
  if (taskRes.rowCount === 0) return null
  const t = taskRes.rows[0]

  const agentRes = await pool.query(
    `SELECT id, name, role, status, detail, elapsed FROM agent_runs WHERE task_id=$1 ORDER BY id`,
    [taskId],
  )
  const candidateRes = await pool.query(
    `SELECT id, name, status, note, return_pct, drawdown_pct, sharpe, signal
     FROM strategy_candidates WHERE task_id=$1 ORDER BY id`,
    [taskId],
  )
  const firewallRes = await pool.query(
    `SELECT label, lim, current, state FROM firewall_rules WHERE task_id=$1 ORDER BY id`,
    [taskId],
  )
  const timelineRes = await pool.query(
    `SELECT time_label, title, detail, tone FROM timeline_events WHERE task_id=$1 ORDER BY id`,
    [taskId],
  )

  const snapshot: TaskSnapshot = {
    id: t.id,
    missionId: t.mission_id,
    objective: t.objective,
    phase: t.phase,
    agents: agentRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      status: r.status,
      detail: r.detail,
      elapsed: r.elapsed,
    })),
    candidates: candidateRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      note: r.note,
      returnPct: parseFloat(r.return_pct),
      drawdownPct: parseFloat(r.drawdown_pct),
      sharpe: parseFloat(r.sharpe),
      signal: r.signal,
    })),
    firewallRules: firewallRes.rows.map((r) => ({
      label: r.label,
      limit: r.lim,
      current: r.current,
      state: r.state,
    })),
    timeline: timelineRes.rows.map((r) => ({
      time: r.time_label,
      title: r.title,
      detail: r.detail,
      tone: r.tone,
    })),
    execution: {
      state: t.exec_state,
      network: 'Injective Testnet',
      transactionHash: t.tx_hash ?? undefined,
    },
    createdAt: t.created_at.toISOString(),
    updatedAt: t.updated_at.toISOString(),
  }
  return snapshot
}
