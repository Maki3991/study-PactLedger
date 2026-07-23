/**
 * TreasuryService – tenant-agnostic financial infrastructure.
 * No trading or poolmate semantics inside this file.
 */
import { v4 as uuidv4 } from 'uuid'
import { pool } from '../db/pool'
import type {
  AllocationPlan,
  SpendingPolicy,
  TransferRequest,
  TransferResult,
  TreasuryAccount,
  TreasuryTx,
} from './types'

// ── account management ────────────────────────────────────────────────────────

export async function allocate(
  tenantId: string,
  plans: AllocationPlan[],
): Promise<TreasuryAccount[]> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const accounts: TreasuryAccount[] = []
    for (const plan of plans) {
      const accountId = `${tenantId}:${plan.agentId}`

      // upsert account
      const res = await client.query(
        `INSERT INTO treasury_accounts
           (id, tenant_id, agent_id, agent_name, balance, allocated, currency)
         VALUES ($1,$2,$3,$4,$5,$5,'USDT')
         ON CONFLICT (tenant_id, agent_id) DO UPDATE
           SET balance   = treasury_accounts.balance + EXCLUDED.balance,
               allocated = treasury_accounts.allocated + EXCLUDED.allocated,
               updated_at = NOW()
         RETURNING *`,
        [accountId, tenantId, plan.agentId, plan.agentName, plan.amount],
      )

      // upsert policy
      await client.query(
        `INSERT INTO spending_policies
           (tenant_id, agent_id, max_single, daily_limit, whitelist, asset_whitelist)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, agent_id) DO UPDATE
           SET max_single=$3, daily_limit=$4, whitelist=$5, asset_whitelist=$6`,
        [
          tenantId,
          plan.agentId,
          plan.policy.maxSingle,
          plan.policy.dailyLimit,
          JSON.stringify(plan.policy.whitelist),
          JSON.stringify(plan.policy.assetWhitelist),
        ],
      )

      // record deposit tx
      await client.query(
        `INSERT INTO treasury_txs
           (id, tenant_id, from_agent, to_agent, amount, purpose, protocol, status)
         VALUES ($1,$2,NULL,$3,$4,'initial allocation','internal','completed')`,
        [uuidv4(), tenantId, plan.agentId, plan.amount],
      )

      accounts.push(rowToAccount(res.rows[0]))
    }

    await client.query('COMMIT')
    return accounts
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── transfer (the policy-enforced core operation) ─────────────────────────────

export async function transfer(req: TransferRequest): Promise<TransferResult> {
  const txId = uuidv4()

  // 1. read sender balance
  const senderRes = await pool.query(
    `SELECT balance FROM treasury_accounts WHERE tenant_id=$1 AND agent_id=$2`,
    [req.tenantId, req.fromAgent],
  )
  if (senderRes.rowCount === 0) {
    return reject(txId, req, `sender account not found: ${req.fromAgent}`)
  }
  const balance = parseFloat(senderRes.rows[0].balance)

  // 2. check policy
  const policyRes = await pool.query(
    `SELECT * FROM spending_policies WHERE tenant_id=$1 AND agent_id=$2`,
    [req.tenantId, req.fromAgent],
  )
  if (policyRes.rowCount! > 0) {
    const p = policyRes.rows[0] as {
      max_single: string; daily_limit: string; whitelist: string[]
    }

    // a) single-tx limit
    if (req.amount > parseFloat(p.max_single)) {
      return reject(txId, req,
        `单笔超限：请求 ${req.amount} USDT > 单笔上限 ${p.max_single} USDT`)
    }

    // b) whitelist check (empty array = any recipient allowed)
    const wl: string[] = Array.isArray(p.whitelist) ? p.whitelist : JSON.parse(p.whitelist as unknown as string)
    if (wl.length > 0 && !wl.includes(req.toAgent)) {
      return reject(txId, req,
        `收款方不在白名单：${req.toAgent} 未被授权`)
    }

    // c) daily limit
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
    const dailyRes = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS total
       FROM treasury_txs
       WHERE tenant_id=$1 AND from_agent=$2 AND status='completed' AND created_at >= $3`,
      [req.tenantId, req.fromAgent, dayStart.toISOString()],
    )
    const dailySpent = parseFloat(dailyRes.rows[0].total)
    if (dailySpent + req.amount > parseFloat(p.daily_limit)) {
      return reject(txId, req,
        `日限额超限：今日已花 ${dailySpent.toFixed(2)} + ${req.amount} > 日限额 ${p.daily_limit} USDT`)
    }
  }

  // 3. balance check
  if (balance < req.amount) {
    return reject(txId, req,
      `余额不足：账户余额 ${balance.toFixed(2)} USDT < 请求 ${req.amount} USDT`)
  }

  // 4. execute transfer
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE treasury_accounts
       SET balance=balance-$3, spent=spent+$3, updated_at=NOW()
       WHERE tenant_id=$1 AND agent_id=$2`,
      [req.tenantId, req.fromAgent, req.amount],
    )
    await client.query(
      `UPDATE treasury_accounts
       SET balance=balance+$3, earned=earned+$3, updated_at=NOW()
       WHERE tenant_id=$1 AND agent_id=$2`,
      [req.tenantId, req.toAgent, req.amount],
    )
    await client.query(
      `INSERT INTO treasury_txs
         (id, tenant_id, from_agent, to_agent, amount, purpose, protocol, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'completed')`,
      [txId, req.tenantId, req.fromAgent, req.toAgent, req.amount, req.purpose, req.protocol ?? 'internal'],
    )

    await client.query('COMMIT')

    const [fromBal, toBal] = await Promise.all([
      getBalance(req.tenantId, req.fromAgent),
      getBalance(req.tenantId, req.toAgent),
    ])
    return { ok: true, txId, fromBalance: fromBal, toBalance: toBal }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function reject(txId: string, req: TransferRequest, reason: string): Promise<TransferResult> {
  await pool.query(
    `INSERT INTO treasury_txs
       (id, tenant_id, from_agent, to_agent, amount, purpose, protocol, status, reject_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'rejected',$8)`,
    [txId, req.tenantId, req.fromAgent, req.toAgent, req.amount, req.purpose, req.protocol ?? 'internal', reason],
  )
  return { ok: false, txId, rejectReason: reason }
}

// ── queries ───────────────────────────────────────────────────────────────────

export async function getBalance(tenantId: string, agentId: string): Promise<number> {
  const res = await pool.query(
    `SELECT balance FROM treasury_accounts WHERE tenant_id=$1 AND agent_id=$2`,
    [tenantId, agentId],
  )
  return res.rowCount! > 0 ? parseFloat(res.rows[0].balance) : 0
}

export async function getAccounts(tenantId: string): Promise<TreasuryAccount[]> {
  const res = await pool.query(
    `SELECT * FROM treasury_accounts WHERE tenant_id=$1 ORDER BY agent_id`,
    [tenantId],
  )
  return res.rows.map(rowToAccount)
}

export async function getAuditLog(tenantId: string): Promise<TreasuryTx[]> {
  const res = await pool.query(
    `SELECT * FROM treasury_txs WHERE tenant_id=$1 ORDER BY created_at`,
    [tenantId],
  )
  return res.rows.map(rowToTx)
}

export async function getPolicies(tenantId: string): Promise<SpendingPolicy[]> {
  const res = await pool.query(
    `SELECT * FROM spending_policies WHERE tenant_id=$1 ORDER BY agent_id`,
    [tenantId],
  )
  return res.rows.map((r) => ({
    tenantId: r.tenant_id,
    agentId: r.agent_id,
    maxSingle: parseFloat(r.max_single),
    dailyLimit: parseFloat(r.daily_limit),
    whitelist: Array.isArray(r.whitelist) ? r.whitelist : JSON.parse(r.whitelist),
    assetWhitelist: Array.isArray(r.asset_whitelist) ? r.asset_whitelist : JSON.parse(r.asset_whitelist),
  }))
}

// ── row mappers ───────────────────────────────────────────────────────────────

function rowToAccount(r: Record<string, unknown>): TreasuryAccount {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    agentId: r.agent_id as string,
    agentName: r.agent_name as string,
    balance: parseFloat(r.balance as string),
    allocated: parseFloat(r.allocated as string),
    spent: parseFloat(r.spent as string),
    earned: parseFloat(r.earned as string),
    currency: r.currency as string,
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.updated_at as Date).toISOString(),
  }
}

function rowToTx(r: Record<string, unknown>): TreasuryTx {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    fromAgent: r.from_agent as string | null,
    toAgent: r.to_agent as string | null,
    amount: parseFloat(r.amount as string),
    currency: r.currency as string,
    purpose: r.purpose as string,
    protocol: r.protocol as TreasuryTx['protocol'],
    status: r.status as TreasuryTx['status'],
    rejectReason: r.reject_reason as string | undefined,
    injTxHash: r.inj_tx_hash as string | undefined,
    createdAt: (r.created_at as Date).toISOString(),
  }
}
