import type { InjectiveConfig } from '../config/injective.js'
import { MockInjectiveAdapter, type SettlementAdapter } from './execution.js'
import { InjectiveTestnetSettlementAdapter } from './injectiveTestnet.js'

export function createSettlementAdapter(config: InjectiveConfig): SettlementAdapter {
  return config.mode === 'mock' ? new MockInjectiveAdapter() : new InjectiveTestnetSettlementAdapter(config)
}

/** @deprecated Use createSettlementAdapter. */
export const createExecutionAdapter = createSettlementAdapter
