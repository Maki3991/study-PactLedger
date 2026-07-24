import type { Pool } from 'pg'
import type {
  AgentPaymentIntent,
  PactLedgerTrace,
  PolicyDecision,
  SettlementReceipt,
} from '../../src/domain/pactledger.js'

export class PactLedgerRepository {
  private readonly intents = new Map<string, AgentPaymentIntent>()
  private readonly decisions = new Map<string, PolicyDecision>()
  private readonly receipts = new Map<string, SettlementReceipt>()

  constructor(private readonly pool?: Pool) {}

  get hasPersistentStorage(): boolean {
    return Boolean(this.pool)
  }

  async initialize(): Promise<void> {
    if (!this.pool) return
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS pactledger_payment_intents (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pactledger_intents_tenant_created_idx
        ON pactledger_payment_intents (tenant_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS pactledger_policy_decisions (
        id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL UNIQUE,
        outcome TEXT NOT NULL,
        payload_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settlement_receipts (
        intent_id TEXT PRIMARY KEY,
        network TEXT NOT NULL,
        status TEXT NOT NULL,
        tx_hash TEXT UNIQUE,
        explorer_url TEXT,
        payload_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
    `)
  }

  async saveIntent(intent: AgentPaymentIntent): Promise<void> {
    if (!this.pool) {
      this.intents.set(intent.id, structuredClone(intent))
      return
    }
    const now = new Date().toISOString()
    await this.pool.query(`
      INSERT INTO pactledger_payment_intents
        (id, tenant_id, app_id, status, payload_json, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6)
      ON CONFLICT(id) DO UPDATE SET
        status = EXCLUDED.status,
        payload_json = EXCLUDED.payload_json,
        updated_at = EXCLUDED.updated_at
    `, [intent.id, intent.tenantId, intent.appId, intent.status, JSON.stringify(intent), now])
  }

  async saveDecision(decision: PolicyDecision): Promise<void> {
    if (!this.pool) {
      this.decisions.set(decision.intentId, structuredClone(decision))
      return
    }
    await this.pool.query(`
      INSERT INTO pactledger_policy_decisions
        (id, intent_id, outcome, payload_json, created_at)
      VALUES ($1, $2, $3, $4::jsonb, $5)
      ON CONFLICT(intent_id) DO UPDATE SET
        id = EXCLUDED.id,
        outcome = EXCLUDED.outcome,
        payload_json = EXCLUDED.payload_json,
        created_at = EXCLUDED.created_at
    `, [decision.id, decision.intentId, decision.outcome, JSON.stringify(decision), decision.evaluatedAt])
  }

  async saveReceipt(receipt: SettlementReceipt): Promise<void> {
    if (!this.pool) {
      this.receipts.set(receipt.intentId, structuredClone(receipt))
      return
    }
    await this.pool.query(`
      INSERT INTO settlement_receipts
        (intent_id, network, status, tx_hash, explorer_url, payload_json, created_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      ON CONFLICT(intent_id) DO UPDATE SET
        network = EXCLUDED.network,
        status = EXCLUDED.status,
        tx_hash = EXCLUDED.tx_hash,
        explorer_url = EXCLUDED.explorer_url,
        payload_json = EXCLUDED.payload_json,
        created_at = EXCLUDED.created_at
    `, [
      receipt.intentId,
      receipt.network,
      receipt.status,
      receipt.transactionHash ?? null,
      receipt.explorerUrl ?? null,
      JSON.stringify(receipt),
      receipt.confirmedAt,
    ])
  }

  async findTrace(intentId: string): Promise<PactLedgerTrace | undefined> {
    if (!this.pool) {
      const intent = this.intents.get(intentId)
      const decision = this.decisions.get(intentId)
      if (!intent || !decision) return undefined
      const receipt = this.receipts.get(intentId)
      return structuredClone({ intent, decision, receipt })
    }

    const [intentResult, decisionResult, receiptResult] = await Promise.all([
      this.pool.query<{ payload_json: AgentPaymentIntent | string }>(
        'SELECT payload_json FROM pactledger_payment_intents WHERE id = $1',
        [intentId],
      ),
      this.pool.query<{ payload_json: PolicyDecision | string }>(
        'SELECT payload_json FROM pactledger_policy_decisions WHERE intent_id = $1',
        [intentId],
      ),
      this.pool.query<{ payload_json: SettlementReceipt | string }>(
        'SELECT payload_json FROM settlement_receipts WHERE intent_id = $1',
        [intentId],
      ),
    ])
    const intent = parseJson<AgentPaymentIntent>(intentResult.rows[0]?.payload_json)
    const decision = parseJson<PolicyDecision>(decisionResult.rows[0]?.payload_json)
    if (!intent || !decision) return undefined
    return {
      intent,
      decision,
      receipt: parseJson<SettlementReceipt>(receiptResult.rows[0]?.payload_json),
    }
  }

  async findLatestConfirmedTestnetReceipt(): Promise<SettlementReceipt | undefined> {
    if (!this.pool) {
      const receipts = [...this.receipts.values()]
        .filter((receipt) => receipt.mode === 'testnet' && receipt.status === 'confirmed')
        .sort((a, b) => Date.parse(b.confirmedAt) - Date.parse(a.confirmedAt))
      return receipts[0] ? structuredClone(receipts[0]) : undefined
    }
    const result = await this.pool.query<{ payload_json: SettlementReceipt | string }>(`
      SELECT payload_json
      FROM settlement_receipts
      WHERE status = 'confirmed' AND payload_json->>'mode' = 'testnet'
      ORDER BY created_at DESC
      LIMIT 1
    `)
    return parseJson<SettlementReceipt>(result.rows[0]?.payload_json)
  }
}

function parseJson<T>(value: T | string | undefined): T | undefined {
  if (!value) return undefined
  return typeof value === 'string' ? JSON.parse(value) as T : value
}
