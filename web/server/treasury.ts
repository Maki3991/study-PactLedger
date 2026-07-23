import type { Pool, PoolClient } from 'pg'

export interface TreasuryAccount {
  id: string
  agentId: string
  agentName: string
  balance: number
  allocated: number
  spent: number
  earned: number
  currency: string
}

export interface TreasuryTx {
  id: string
  fromAgent: string | null
  toAgent: string | null
  amount: number
  currency: string
  purpose: string
  protocol: 'internal' | 'x402' | 'acp' | 'ap2'
  status: 'completed' | 'rejected'
  rejectReason?: string
  createdAt: string
}

const AGENT_PLANS: Array<{ agentId: string; agentName: string; amount: number }> = [
  { agentId: 'orchestrator', agentName: 'Orchestrator', amount: 540 },
  { agentId: 'research', agentName: 'Research', amount: 50 },
  { agentId: 'strategy', agentName: 'Strategy', amount: 70 },
  { agentId: 'backtest', agentName: 'Backtest', amount: 40 },
  { agentId: 'risk', agentName: 'Risk', amount: 30 },
  { agentId: 'evolution', agentName: 'Evolution', amount: 20 },
  { agentId: 'execution', agentName: 'Execution', amount: 250 },
]

export class TreasuryService {
  private readonly accounts = new Map<string, TreasuryAccount[]>()
  private readonly logs = new Map<string, TreasuryTx[]>()

  constructor(private readonly pool?: Pool) {}

  async initialize(): Promise<void> {
    if (!this.pool) return
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS treasury_accounts (
        tenant_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        balance NUMERIC(20, 6) NOT NULL,
        allocated NUMERIC(20, 6) NOT NULL,
        spent NUMERIC(20, 6) NOT NULL DEFAULT 0,
        earned NUMERIC(20, 6) NOT NULL DEFAULT 0,
        currency TEXT NOT NULL,
        PRIMARY KEY (tenant_id, agent_id)
      );
      CREATE TABLE IF NOT EXISTS treasury_transactions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        from_agent TEXT,
        to_agent TEXT,
        amount NUMERIC(20, 6) NOT NULL,
        currency TEXT NOT NULL,
        purpose TEXT NOT NULL,
        protocol TEXT NOT NULL,
        status TEXT NOT NULL,
        reject_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS treasury_transactions_tenant_created_idx
        ON treasury_transactions (tenant_id, created_at);
    `)
  }

  async allocate(tenantId: string): Promise<void> {
    if (!this.pool) {
      if (this.accounts.has(tenantId)) return
      this.accounts.set(tenantId, AGENT_PLANS.map((plan) => ({
        id: `${tenantId}:${plan.agentId}`,
        agentId: plan.agentId,
        agentName: plan.agentName,
        balance: plan.amount,
        allocated: plan.amount,
        spent: 0,
        earned: 0,
        currency: 'USDT',
      })))
      this.logs.set(tenantId, AGENT_PLANS.map((plan) => makeTx(tenantId, null, plan.agentId, plan.amount, 'initial allocation', 'internal')))
      return
    }

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const existing = await client.query('SELECT 1 FROM treasury_accounts WHERE tenant_id = $1 LIMIT 1', [tenantId])
      if (existing.rowCount) {
        await client.query('COMMIT')
        return
      }
      for (const plan of AGENT_PLANS) {
        await client.query(`
          INSERT INTO treasury_accounts
            (tenant_id, agent_id, agent_name, balance, allocated, spent, earned, currency)
          VALUES ($1, $2, $3, $4, $4, 0, 0, 'USDT')
        `, [tenantId, plan.agentId, plan.agentName, plan.amount])
        await insertTransaction(client, tenantId, makeTx(tenantId, null, plan.agentId, plan.amount, 'initial allocation', 'internal'))
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  recordResearchPayment(tenantId: string): Promise<boolean> {
    return this.transfer(tenantId, 'strategy', 'research', 20, '购买市场研究报告', 'x402')
  }

  recordBacktestPayment(tenantId: string): Promise<boolean> {
    return this.transfer(tenantId, 'strategy', 'backtest', 25, 'Champion-Challenger 回测服务', 'x402')
  }

  recordRiskFee(tenantId: string): Promise<boolean> {
    return this.transfer(tenantId, 'strategy', 'risk', 15, '独立风控审核', 'internal')
  }

  recordExecutionCost(tenantId: string): Promise<boolean> {
    return this.transfer(tenantId, 'orchestrator', 'execution', 50, '链上执行预算拨付', 'internal')
  }

  async transfer(
    tenantId: string,
    fromAgent: string,
    toAgent: string,
    amount: number,
    purpose: string,
    protocol: TreasuryTx['protocol'],
  ): Promise<boolean> {
    if (!this.pool) return this.transferMemory(tenantId, fromAgent, toAgent, amount, purpose, protocol)

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<AccountRow>(`
        SELECT * FROM treasury_accounts
        WHERE tenant_id = $1 AND agent_id = ANY($2::text[])
        FOR UPDATE
      `, [tenantId, [fromAgent, toAgent]])
      const from = result.rows.find((row) => row.agent_id === fromAgent)
      const to = result.rows.find((row) => row.agent_id === toAgent)
      const rejected = !from || !to || Number(from.balance) < amount
      const tx = makeTx(
        tenantId,
        fromAgent,
        toAgent,
        amount,
        purpose,
        protocol,
        rejected ? 'rejected' : 'completed',
        rejected ? '余额不足或账户不存在' : undefined,
      )

      if (!rejected) {
        await client.query(`
          UPDATE treasury_accounts
          SET balance = balance - $3, spent = spent + $3
          WHERE tenant_id = $1 AND agent_id = $2
        `, [tenantId, fromAgent, amount])
        await client.query(`
          UPDATE treasury_accounts
          SET balance = balance + $3, earned = earned + $3
          WHERE tenant_id = $1 AND agent_id = $2
        `, [tenantId, toAgent, amount])
      }
      await insertTransaction(client, tenantId, tx)
      await client.query('COMMIT')
      return !rejected
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async getAccounts(tenantId: string): Promise<TreasuryAccount[]> {
    if (!this.pool) return structuredClone(this.accounts.get(tenantId) ?? [])
    const result = await this.pool.query<AccountRow>(`
      SELECT * FROM treasury_accounts WHERE tenant_id = $1 ORDER BY allocated DESC, agent_id
    `, [tenantId])
    return result.rows.map((row) => ({
      id: `${row.tenant_id}:${row.agent_id}`,
      agentId: row.agent_id,
      agentName: row.agent_name,
      balance: Number(row.balance),
      allocated: Number(row.allocated),
      spent: Number(row.spent),
      earned: Number(row.earned),
      currency: row.currency,
    }))
  }

  async getAuditLog(tenantId: string): Promise<TreasuryTx[]> {
    if (!this.pool) return structuredClone(this.logs.get(tenantId) ?? [])
    const result = await this.pool.query<TransactionRow>(`
      SELECT * FROM treasury_transactions WHERE tenant_id = $1 ORDER BY created_at ASC
    `, [tenantId])
    return result.rows.map((row) => ({
      id: row.id,
      fromAgent: row.from_agent,
      toAgent: row.to_agent,
      amount: Number(row.amount),
      currency: row.currency,
      purpose: row.purpose,
      protocol: row.protocol as TreasuryTx['protocol'],
      status: row.status as TreasuryTx['status'],
      rejectReason: row.reject_reason ?? undefined,
      createdAt: new Date(row.created_at).toISOString(),
    }))
  }

  private transferMemory(
    tenantId: string,
    fromAgent: string,
    toAgent: string,
    amount: number,
    purpose: string,
    protocol: TreasuryTx['protocol'],
  ): boolean {
    const tenantAccounts = this.accounts.get(tenantId)
    const from = tenantAccounts?.find((account) => account.agentId === fromAgent)
    const to = tenantAccounts?.find((account) => account.agentId === toAgent)
    const rejected = !from || !to || from.balance < amount
    const tx = makeTx(
      tenantId,
      fromAgent,
      toAgent,
      amount,
      purpose,
      protocol,
      rejected ? 'rejected' : 'completed',
      rejected ? '余额不足或账户不存在' : undefined,
    )
    const tenantLog = this.logs.get(tenantId) ?? []
    tenantLog.push(tx)
    this.logs.set(tenantId, tenantLog)
    if (rejected || !from || !to) return false
    from.balance -= amount
    from.spent += amount
    to.balance += amount
    to.earned += amount
    return true
  }
}

function makeTx(
  tenantId: string,
  fromAgent: string | null,
  toAgent: string | null,
  amount: number,
  purpose: string,
  protocol: TreasuryTx['protocol'],
  status: TreasuryTx['status'] = 'completed',
  rejectReason?: string,
): TreasuryTx {
  return {
    id: `${tenantId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    fromAgent,
    toAgent,
    amount,
    currency: 'USDT',
    purpose,
    protocol,
    status,
    rejectReason,
    createdAt: new Date().toISOString(),
  }
}

async function insertTransaction(client: PoolClient, tenantId: string, tx: TreasuryTx): Promise<void> {
  await client.query(`
    INSERT INTO treasury_transactions
      (id, tenant_id, from_agent, to_agent, amount, currency, purpose, protocol, status, reject_reason, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `, [tx.id, tenantId, tx.fromAgent, tx.toAgent, tx.amount, tx.currency, tx.purpose, tx.protocol, tx.status, tx.rejectReason ?? null, tx.createdAt])
}

interface AccountRow {
  tenant_id: string
  agent_id: string
  agent_name: string
  balance: string
  allocated: string
  spent: string
  earned: string
  currency: string
}

interface TransactionRow {
  id: string
  tenant_id: string
  from_agent: string | null
  to_agent: string | null
  amount: string
  currency: string
  purpose: string
  protocol: string
  status: string
  reject_reason: string | null
  created_at: string | Date
}
