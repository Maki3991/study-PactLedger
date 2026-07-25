import type { Pool } from 'pg'
import type { DecisionRecord, KnowledgeReference, QuantEvidence } from '../../src/domain/trading.js'
import type { StrategyProposal } from '../../src/domain/trading.js'

export class AgentMemory {
  private readonly memory = new Map<string, DecisionRecord>()

  constructor(private readonly pool?: Pool) {}

  get hasPersistentStorage(): boolean {
    return Boolean(this.pool)
  }

  async initialize(): Promise<void> {
    if (!this.pool) return
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agent_decisions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        date TEXT NOT NULL,
        market_regime TEXT,
        proposals_json JSONB NOT NULL,
        selected_strategy TEXT,
        evidence_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_decisions_symbol_idx ON agent_decisions (symbol, created_at DESC);
      CREATE INDEX IF NOT EXISTS agent_decisions_task_idx ON agent_decisions (task_id);
    `)
  }

  async save(record: DecisionRecord): Promise<void> {
    if (!this.pool) {
      if (this.memory.has(record.id)) return
      this.memory.set(record.id, structuredClone(record))
      return
    }
    await this.pool.query(`
      INSERT INTO agent_decisions (id, task_id, symbol, date, market_regime, proposals_json, selected_strategy, evidence_json, created_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)
      ON CONFLICT(id) DO NOTHING
    `, [
      record.id,
      record.taskId,
      record.symbol,
      record.date,
      record.marketRegime,
      JSON.stringify(record.proposals),
      record.selectedStrategy,
      JSON.stringify(record.evidence),
      record.createdAt,
    ])
  }

  async findBySymbol(symbol: string): Promise<DecisionRecord[]> {
    if (!this.pool) {
      return [...this.memory.values()]
        .filter((r) => r.symbol === symbol)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((r) => structuredClone(r))
    }
    const result = await this.pool.query<{
      id: string; task_id: string; symbol: string; date: string;
      market_regime: string | null; proposals_json: StrategyProposal[];
      selected_strategy: string | null; evidence_json: QuantEvidence;
      created_at: string;
    }>(`
      SELECT id, task_id, symbol, date, market_regime, proposals_json, selected_strategy, evidence_json, created_at
      FROM agent_decisions
      WHERE symbol = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [symbol])
    return result.rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      symbol: row.symbol,
      date: row.date,
      marketRegime: row.market_regime ?? 'unknown',
      proposals: typeof row.proposals_json === 'string'
        ? JSON.parse(row.proposals_json) as StrategyProposal[]
        : row.proposals_json,
      selectedStrategy: row.selected_strategy ?? '',
      evidence: typeof row.evidence_json === 'string'
        ? JSON.parse(row.evidence_json) as QuantEvidence
        : row.evidence_json,
      createdAt: row.created_at,
    }))
  }

  async findRecent(limit = 20): Promise<DecisionRecord[]> {
    if (!this.pool) {
      return [...this.memory.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map((record) => structuredClone(record))
    }
    const result = await this.pool.query<{
      id: string; task_id: string; symbol: string; date: string;
      market_regime: string | null; proposals_json: StrategyProposal[];
      selected_strategy: string | null; evidence_json: QuantEvidence;
      created_at: string;
    }>(`
      SELECT id, task_id, symbol, date, market_regime, proposals_json, selected_strategy, evidence_json, created_at
      FROM agent_decisions
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit])
    return result.rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      symbol: row.symbol,
      date: row.date,
      marketRegime: row.market_regime ?? 'unknown',
      proposals: typeof row.proposals_json === 'string'
        ? JSON.parse(row.proposals_json) as StrategyProposal[]
        : row.proposals_json,
      selectedStrategy: row.selected_strategy ?? '',
      evidence: typeof row.evidence_json === 'string'
        ? JSON.parse(row.evidence_json) as QuantEvidence
        : row.evidence_json,
      createdAt: row.created_at,
    }))
  }

  async getRecentContext(days: number): Promise<string> {
    const records = await this.getRecentReferences(days)
    if (records.length === 0) return ''
    const lines = records.map((record) =>
      `${record.date} ${record.symbol} 市场=${record.marketRegime} 选择=${record.selectedStrategy}`
    )
    return `最近 ${days} 天决策记录:\n${lines.join('\n')}`
  }

  async getRecentReferences(days: number, limit = 10): Promise<KnowledgeReference[]> {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    if (!this.pool) {
      return [...this.memory.values()]
        .filter((r) => r.createdAt >= cutoff)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map(toKnowledgeReference)
    }

    const result = await this.pool.query<{
      id: string; symbol: string; date: string; market_regime: string | null;
      selected_strategy: string | null; created_at: string;
    }>(`
      SELECT id, symbol, date, market_regime, selected_strategy, created_at
      FROM agent_decisions
      WHERE created_at >= $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [cutoff, limit])
    return result.rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      date: row.date,
      marketRegime: row.market_regime ?? 'unknown',
      selectedStrategy: row.selected_strategy ?? '',
      createdAt: row.created_at,
    }))
  }

  async count(): Promise<number> {
    if (!this.pool) return this.memory.size
    const result = await this.pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM agent_decisions')
    return Number(result.rows[0]?.count ?? 0)
  }
}

function toKnowledgeReference(record: DecisionRecord): KnowledgeReference {
  return {
    id: record.id,
    symbol: record.symbol,
    date: record.date,
    marketRegime: record.marketRegime,
    selectedStrategy: record.selectedStrategy,
    createdAt: record.createdAt,
  }
}
