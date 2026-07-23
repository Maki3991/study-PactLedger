import { Router } from 'express'
import * as treasury from './service'

export const treasuryRouter = Router()

// GET /api/treasury/:tenantId/accounts
treasuryRouter.get('/:tenantId/accounts', async (req, res) => {
  const accounts = await treasury.getAccounts(req.params.tenantId)
  res.json(accounts)
})

// GET /api/treasury/:tenantId/accounts/:agentId/balance
treasuryRouter.get('/:tenantId/accounts/:agentId/balance', async (req, res) => {
  const balance = await treasury.getBalance(req.params.tenantId, req.params.agentId)
  res.json({ balance, currency: 'USDT' })
})

// GET /api/treasury/:tenantId/audit-log
treasuryRouter.get('/:tenantId/audit-log', async (req, res) => {
  const log = await treasury.getAuditLog(req.params.tenantId)
  res.json(log)
})

// GET /api/treasury/:tenantId/policies
treasuryRouter.get('/:tenantId/policies', async (req, res) => {
  const policies = await treasury.getPolicies(req.params.tenantId)
  res.json(policies)
})

// POST /api/treasury/transfer  – policy-checked payment between agents
treasuryRouter.post('/transfer', async (req, res) => {
  const { tenantId, fromAgent, toAgent, amount, purpose, protocol } = req.body as {
    tenantId: string; fromAgent: string; toAgent: string
    amount: number; purpose: string; protocol?: string
  }
  if (!tenantId || !fromAgent || !toAgent || !amount || !purpose) {
    res.status(400).json({ message: 'tenantId, fromAgent, toAgent, amount, purpose are required' })
    return
  }
  const result = await treasury.transfer({
    tenantId, fromAgent, toAgent, amount, purpose,
    protocol: (protocol ?? 'internal') as 'internal' | 'x402' | 'acp' | 'ap2',
  })
  res.status(result.ok ? 200 : 402).json(result)
})
