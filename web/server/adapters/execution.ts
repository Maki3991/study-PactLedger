export interface ExecutionResult {
  transactionHash: string
  network: 'Injective Testnet'
}

export interface ExecutionAdapter {
  execute(taskId: string): Promise<ExecutionResult>
}

export class MockInjectiveAdapter implements ExecutionAdapter {
  async execute(taskId: string): Promise<ExecutionResult> {
    await new Promise((resolve) => setTimeout(resolve, 650))
    const fingerprint = taskId.replaceAll('-', '').slice(0, 12).padEnd(12, '0')
    return {
      transactionHash: `0x8f7c${fingerprint}42d1`,
      network: 'Injective Testnet',
    }
  }
}

export class PendingInjectiveTestnetAdapter implements ExecutionAdapter {
  async execute(): Promise<ExecutionResult> {
    throw new Error('Injective testnet signing adapter is not enabled')
  }
}
