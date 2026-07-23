/**
 * In-memory treasury for the Fastify dev server.
 * Mirrors the contract used by the frontend useTreasury hook:
 *   GET /api/treasury/:tenantId/accounts
 *   GET /api/treasury/:tenantId/audit-log
 */

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

const accounts = new Map<string, TreasuryAccount[]>()
const logs = new Map<string, TreasuryTx[]>()

const AGENT_PLANS: Array<{ agentId: string; agentName: string; amount: number }> = [
  { agentId: 'orchestrator', agentName: 'Orchestrator', amount: 500 },
  { agentId: 'research',     agentName: 'Research',     amount: 50 },
  { agentId: 'strategy',     agentName: 'Strategy',     amount: 70 },
  { agentId: 'backtest',     agentName: 'Backtest',     amount: 40 },
  { agentId: 'risk',         agentName: 'Risk',         amount: 30 },
  { agentId: 'evolution',    agentName: 'Evolution',    amount: 20 },
  { agentId: 'execution',    agentName: 'Execution',    amount: 250 },
]

function now(): string {
  return new Date().toISOString()
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
    id: `${tenantId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fromAgent,
    toAgent,
    amount,
    currency: 'USDT',
    purpose,
    protocol,
    status,
    rejectReason,
    createdAt: now(),
  }
}

export function allocateTreasury(tenantId: string): void {
  if (accounts.has(tenantId)) return

  const tenantAccounts = AGENT_PLANS.map((plan) => ({
    id: `${tenantId}:${plan.agentId}`,
    agentId: plan.agentId,
    agentName: plan.agentName,
    balance: plan.amount,
    allocated: plan.amount,
    spent: 0,
    earned: 0,
    currency: 'USDT',
  }))

  accounts.set(tenantId, tenantAccounts)
  logs.set(tenantId, [
    makeTx(tenantId, null, 'orchestrator', 500, 'initial allocation', 'internal'),
    makeTx(tenantId, null, 'research',     50,  'initial allocation', 'internal'),
    makeTx(tenantId, null, 'strategy',     70,  'initial allocation', 'internal'),
    makeTx(tenantId, null, 'backtest',     40,  'initial allocation', 'internal'),
    makeTx(tenantId, null, 'risk',         30,  'initial allocation', 'internal'),
    makeTx(tenantId, null, 'evolution',    20,  'initial allocation', 'internal'),
    makeTx(tenantId, null, 'execution',    250, 'initial allocation', 'internal'),
  ])
}

export function recordResearchPayment(tenantId: string): void {
  const accs = accounts.get(tenantId)
  if (!accs) return
  transfer(tenantId, 'strategy', 'research', 20, '购买市场研究报告', 'x402')
}

export function recordBacktestPayment(tenantId: string): void {
  transfer(tenantId, 'strategy', 'backtest', 25, 'Champion-Challenger 回测服务', 'x402')
}

export function recordRiskFee(tenantId: string): void {
  transfer(tenantId, 'strategy', 'risk', 15, '独立风控审核', 'internal')
}

export function recordExecutionCost(tenantId: string): void {
  transfer(tenantId, 'orchestrator', 'execution', 50, '链上执行预算拨付', 'internal')
}

export function transfer(
  tenantId: string,
  fromAgent: string,
  toAgent: string,
  amount: number,
  purpose: string,
  protocol: TreasuryTx['protocol'],
): boolean {
  const accs = accounts.get(tenantId)
  if (!accs) return false

  const from = accs.find((a) => a.agentId === fromAgent)
  const to = accs.find((a) => a.agentId === toAgent)
  if (!from || !to || from.balance < amount) {
    const log = logs.get(tenantId) ?? []
    log.push(makeTx(tenantId, fromAgent, toAgent, amount, purpose, protocol, 'rejected', '余额不足'))
    logs.set(tenantId, log)
    return false
  }

  from.balance -= amount
  from.spent += amount
  to.balance += amount
  to.earned += amount

  const log = logs.get(tenantId) ?? []
  log.push(makeTx(tenantId, fromAgent, toAgent, amount, purpose, protocol))
  logs.set(tenantId, log)
  return true
}

export function getAccounts(tenantId: string): TreasuryAccount[] {
  return accounts.get(tenantId) ?? []
}

export function getAuditLog(tenantId: string): TreasuryTx[] {
  return logs.get(tenantId) ?? []
}
