import { createHash, randomUUID } from 'node:crypto'
import type {
  AgentPaymentIntent,
  AgentPaymentProtocol,
  AgentPaymentPurpose,
  PactLedgerAppId,
} from '../../src/domain/pactledger.js'

interface CreatePaymentIntentInput {
  tenantId: string
  appId: PactLedgerAppId
  payerAgentId: string
  payeeId: string
  payeeAddress?: string
  amount: number
  currency: string
  amountAtomic?: string
  denom?: string
  purpose: AgentPaymentPurpose
  protocol: AgentPaymentProtocol
  metadata?: Record<string, unknown>
  intentId?: string
  ttlMs?: number
}

export function createAgentPaymentIntent(input: CreatePaymentIntentInput): AgentPaymentIntent {
  const now = new Date()
  const metadata = JSON.stringify(input.metadata ?? {})
  return {
    id: input.intentId ?? `PAY-${randomUUID().slice(0, 8).toUpperCase()}`,
    tenantId: input.tenantId,
    appId: input.appId,
    payerAgentId: input.payerAgentId,
    payeeId: input.payeeId,
    payeeAddress: input.payeeAddress,
    amount: input.amount,
    currency: input.currency,
    amountAtomic: input.amountAtomic,
    denom: input.denom,
    purpose: input.purpose,
    protocol: input.protocol,
    status: 'submitted',
    expiresAt: new Date(now.getTime() + (input.ttlMs ?? 10 * 60 * 1000)).toISOString(),
    metadataHash: `sha256:${createHash('sha256').update(metadata).digest('hex')}`,
    createdAt: now.toISOString(),
  }
}
