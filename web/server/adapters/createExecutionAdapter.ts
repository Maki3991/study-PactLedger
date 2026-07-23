import type { InjectiveConfig } from '../config/injective.js'
import { MockInjectiveAdapter, PendingInjectiveTestnetAdapter, type ExecutionAdapter } from './execution.js'

export function createExecutionAdapter(config: InjectiveConfig): ExecutionAdapter {
  return config.mode === 'mock' ? new MockInjectiveAdapter() : new PendingInjectiveTestnetAdapter()
}
