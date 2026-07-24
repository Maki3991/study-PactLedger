import type { PactLedgerAppId, PactLedgerPolicy } from '../../src/domain/pactledger.js'

const policies: Record<PactLedgerAppId, PactLedgerPolicy> = {
  kaleidox: {
    id: 'POL-KX-DEFAULT',
    appId: 'kaleidox',
    budgetLimit: 1_000,
    maxSinglePayment: 100,
    approvalThreshold: 200,
    allowedPayees: ['research', 'backtest', 'risk', 'execution'],
    allowedPurposes: ['research', 'backtest', 'risk_review', 'execution'],
  },
  poolmate: {
    id: 'POL-PM-DEMO',
    appId: 'poolmate',
    budgetLimit: 500,
    maxSinglePayment: 300,
    approvalThreshold: 300,
    allowedPayees: ['merchant-demo', 'member-refund'],
    allowedPurposes: ['merchant_pay', 'refund'],
  },
}

export function getPactLedgerPolicy(appId: PactLedgerAppId): PactLedgerPolicy {
  return structuredClone(policies[appId])
}
