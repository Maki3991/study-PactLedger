import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentPaymentIntent, SettlementReceipt } from '../../src/domain/pactledger.js'
import {
  SettlementAdapterError,
  type SettlementAdapter,
} from '../adapters/execution.js'
import { createAgentPaymentIntent } from './intents.js'
import { getPactLedgerPolicy } from './policies.js'
import { PolicyEngine } from './policyEngine.js'
import { PactLedgerRepository } from './repository.js'
import { PactLedgerService } from './service.js'

function paymentIntent(intentId = 'PAY-IDEMPOTENT-001'): AgentPaymentIntent {
  return createAgentPaymentIntent({
    tenantId: 'tenant-kaleidox',
    appId: 'kaleidox',
    payerAgentId: 'strategy',
    payeeId: 'risk',
    amount: 15,
    currency: 'USDT',
    purpose: 'risk_review',
    protocol: 'internal',
    intentId,
  })
}

test('concurrent calls for the same Payment Intent broadcast exactly once', async () => {
  let broadcasts = 0
  const adapter: SettlementAdapter = {
    mode: 'testnet',
    network: 'Injective Testnet',
    settle: async (intent) => {
      broadcasts += 1
      await new Promise((resolve) => setTimeout(resolve, 15))
      return confirmedReceipt(intent.id, 'TX-CONCURRENT')
    },
  }
  const repository = new PactLedgerRepository()
  const service = new PactLedgerService(repository, new PolicyEngine(), adapter)
  const submitted = paymentIntent()

  const traces = await Promise.all([
    service.process(structuredClone(submitted)),
    service.process(structuredClone(submitted)),
    service.process(structuredClone(submitted)),
  ])

  assert.equal(broadcasts, 1)
  assert.deepEqual(traces.map((trace) => trace.receipt?.transactionHash), [
    'TX-CONCURRENT',
    'TX-CONCURRENT',
    'TX-CONCURRENT',
  ])
})

test('a confirmed Receipt is recovered from the repository after a service restart', async () => {
  let broadcasts = 0
  const adapter: SettlementAdapter = {
    mode: 'testnet',
    network: 'Injective Testnet',
    settle: async (intent) => {
      broadcasts += 1
      return confirmedReceipt(intent.id, 'TX-PERSISTED')
    },
  }
  const repository = new PactLedgerRepository()
  const firstService = new PactLedgerService(repository, new PolicyEngine(), adapter)
  const submitted = paymentIntent('PAY-PERSISTED-001')
  const first = await firstService.process(structuredClone(submitted))

  const restartedService = new PactLedgerService(repository, new PolicyEngine(), adapter)
  const recovered = await restartedService.process(structuredClone(submitted))

  assert.equal(broadcasts, 1)
  assert.equal(first.receipt?.transactionHash, 'TX-PERSISTED')
  assert.equal(recovered.receipt?.transactionHash, 'TX-PERSISTED')
  assert.equal(recovered.intent.status, 'confirmed')
})

test('a failed Receipt is returned on retry without a second broadcast', async () => {
  let broadcasts = 0
  const adapter: SettlementAdapter = {
    mode: 'testnet',
    network: 'Injective Testnet',
    settle: async () => {
      broadcasts += 1
      throw new SettlementAdapterError(
        'INJECTIVE_BROADCAST_FAILED',
        'Injective Testnet 广播或确认失败。',
        true,
      )
    },
  }
  const repository = new PactLedgerRepository()
  const service = new PactLedgerService(repository, new PolicyEngine(), adapter)
  const submitted = paymentIntent('PAY-FAILED-001')

  const first = await service.process(structuredClone(submitted))
  const retried = await service.process(structuredClone(submitted))

  assert.equal(broadcasts, 1)
  assert.equal(first.receipt?.status, 'failed')
  assert.equal(retried.receipt?.errorCode, 'INJECTIVE_BROADCAST_FAILED')
  assert.equal(retried.receipt?.retryable, true)
})

test('an interrupted settling state is quarantined instead of replayed', async () => {
  let broadcasts = 0
  const adapter: SettlementAdapter = {
    mode: 'testnet',
    network: 'Injective Testnet',
    settle: async (intent) => {
      broadcasts += 1
      return confirmedReceipt(intent.id, 'UNEXPECTED')
    },
  }
  const repository = new PactLedgerRepository()
  const engine = new PolicyEngine()
  const interrupted = paymentIntent('PAY-RECOVERY-001')
  const decision = engine.evaluate(interrupted, getPactLedgerPolicy('kaleidox'))
  interrupted.status = 'settling'
  await repository.saveIntent(interrupted)
  await repository.saveDecision(decision)

  const service = new PactLedgerService(repository, engine, adapter)
  const trace = await service.process(structuredClone(interrupted))

  assert.equal(broadcasts, 0)
  assert.equal(trace.intent.status, 'failed')
  assert.equal(trace.receipt?.errorCode, 'SETTLEMENT_RECOVERY_REQUIRED')
  assert.equal(trace.receipt?.retryable, false)
})

function confirmedReceipt(intentId: string, transactionHash: string): SettlementReceipt {
  return {
    intentId,
    mode: 'testnet',
    network: 'Injective Testnet',
    status: 'confirmed',
    transactionHash,
    explorerUrl: `https://testnet.explorer.injective.network/transaction/${transactionHash}`,
    blockHeight: '123',
    confirmedAt: new Date().toISOString(),
  }
}
