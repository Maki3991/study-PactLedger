import { createHash } from 'node:crypto'
import type {
  AgentPaymentIntent,
  SettlementMode,
  SettlementReceipt,
} from '../../src/domain/pactledger.js'

export interface SettlementAdapter {
  readonly mode: SettlementMode
  readonly network: SettlementReceipt['network']
  settle(intent: AgentPaymentIntent): Promise<SettlementReceipt>
}

/** @deprecated Use SettlementAdapter. Kept as a compatibility alias for team integrations. */
export type ExecutionAdapter = SettlementAdapter

export class SettlementAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'SettlementAdapterError'
  }
}

export class MockInjectiveAdapter implements SettlementAdapter {
  readonly mode = 'mock' as const
  readonly network = 'Mock' as const

  async settle(intent: AgentPaymentIntent): Promise<SettlementReceipt> {
    await new Promise((resolve) => setTimeout(resolve, 650))
    const fingerprint = createHash('sha256').update(intent.id).digest('hex')
    return {
      intentId: intent.id,
      mode: 'mock',
      network: 'Mock',
      status: 'confirmed',
      amountAtomic: intent.amountAtomic,
      denom: intent.denom,
      transactionHash: `mock_${fingerprint.slice(0, 24)}`,
      confirmedAt: new Date().toISOString(),
    }
  }
}
