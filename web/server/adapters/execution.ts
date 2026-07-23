import { createHash } from 'node:crypto'
import type { ActionIntent } from '../../src/domain/trading.js'

export interface ExecutionResult {
  transactionHash: string
  network: 'Mock' | 'Injective Testnet'
}

export interface ExecutionAdapter {
  execute(intent: ActionIntent): Promise<ExecutionResult>
}

export class MockInjectiveAdapter implements ExecutionAdapter {
  async execute(intent: ActionIntent): Promise<ExecutionResult> {
    await new Promise((resolve) => setTimeout(resolve, 650))
    const fingerprint = createHash('sha256').update(intent.id).digest('hex')
    return {
      transactionHash: `0x${fingerprint}`,
      network: 'Mock',
    }
  }
}

export class PendingInjectiveTestnetAdapter implements ExecutionAdapter {
  async execute(): Promise<ExecutionResult> {
    throw new Error('Injective testnet signing adapter is not enabled')
  }
}
