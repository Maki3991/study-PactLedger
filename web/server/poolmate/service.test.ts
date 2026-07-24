import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentPaymentIntent, SettlementReceipt } from '../../src/domain/pactledger.js'
import { SettlementAdapterError, type SettlementAdapter } from '../adapters/execution.js'
import { PolicyEngine } from '../pactledger/policyEngine.js'
import { PactLedgerRepository } from '../pactledger/repository.js'
import { PactLedgerService } from '../pactledger/service.js'
import { PoolMateRepository } from './repository.js'
import { PoolMateService, parsePoolRequest } from './service.js'

test('PoolMate parses the Telegram group-purchase command without treating the product count as price', () => {
  assert.deepEqual(parsePoolRequest('拼杨梅，一箱89元，需要3人'), {
    product: '杨梅',
    priceEach: 89,
    slotsTotal: 3,
  })
  assert.deepEqual(parsePoolRequest('拼 咖啡 每份 19.90 共 4 人'), {
    product: '咖啡',
    priceEach: 19.9,
    slotsTotal: 4,
  })
  assert.equal(parsePoolRequest('随便聊聊'), undefined)
})

test('funded Telegram checkout persists one canonical Mock Receipt and is idempotent across service restart', async () => {
  let settlementCalls = 0
  const adapter: SettlementAdapter = {
    mode: 'mock',
    network: 'Mock',
    settle: async (intent): Promise<SettlementReceipt> => {
      settlementCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return mockReceipt(intent)
    },
  }
  const repository = new PoolMateRepository()
  const ledgerRepository = new PactLedgerRepository()
  await repository.initialize()
  await ledgerRepository.initialize()
  const service = createService(repository, ledgerRepository, adapter)

  const session = await service.createSession(1001, 7, '发起人', {
    product: '杨梅',
    priceEach: 89,
    slotsTotal: 3,
  })
  assert.equal((await service.joinSession(session.id, 11, '甲')).session?.status, 'collecting')
  assert.equal((await service.joinSession(session.id, 12, '乙')).session?.status, 'collecting')
  assert.equal((await service.joinSession(session.id, 13, '丙')).session?.status, 'funded')

  const [first, concurrentRetry] = await Promise.all([
    service.checkoutSession(session.id),
    service.checkoutSession(session.id),
  ])
  assert.equal(first.ok, true)
  assert.equal(concurrentRetry.ok, true)
  assert.equal(settlementCalls, 1)
  assert.equal(first.trace?.intent.id, `PM-${session.id}-MERCHANT`)
  assert.equal(first.trace?.decision.code, 'POLICY_APPROVED')
  assert.equal(first.trace?.receipt?.mode, 'mock')
  assert.equal(first.trace?.receipt?.explorerUrl, undefined)
  assert.equal(first.session?.status, 'completed')
  assert.match(first.session?.merchantOrderId ?? '', /^DEMO-ORDER-/)
  assert.ok((await service.getMembers(session.id)).every((member) => member.status === 'paid'))

  const restarted = createService(repository, ledgerRepository, adapter)
  const replay = await restarted.checkoutSession(session.id)
  assert.equal(replay.ok, true)
  assert.equal(replay.trace?.receipt?.transactionHash, first.trace?.receipt?.transactionHash)
  assert.equal(settlementCalls, 1)
})

test('unknown Telegram payee produces a persisted Policy rejection and never reaches settlement', async () => {
  let settlementCalls = 0
  const adapter: SettlementAdapter = {
    mode: 'mock',
    network: 'Mock',
    settle: async (intent) => {
      settlementCalls += 1
      return mockReceipt(intent)
    },
  }
  const repository = new PoolMateRepository()
  const ledgerRepository = new PactLedgerRepository()
  const service = createService(repository, ledgerRepository, adapter)

  const rejected = await service.evaluateUnknownPayee(-100123, 42)
  const replay = await service.evaluateUnknownPayee(-100123, 42)
  assert.equal(rejected.decision.outcome, 'rejected')
  assert.equal(rejected.decision.code, 'PAYEE_NOT_ALLOWED')
  assert.equal(rejected.intent.status, 'policy_rejected')
  assert.equal(rejected.receipt, undefined)
  assert.equal(replay.decision.id, rejected.decision.id)
  assert.equal(settlementCalls, 0)
})

test('failed Telegram settlement is retained and retry does not call the adapter again', async () => {
  let settlementCalls = 0
  const adapter: SettlementAdapter = {
    mode: 'mock',
    network: 'Mock',
    settle: async () => {
      settlementCalls += 1
      throw new SettlementAdapterError('MOCK_SETTLEMENT_FAILED', 'Mock settlement failed.', false)
    },
  }
  const repository = new PoolMateRepository()
  const ledgerRepository = new PactLedgerRepository()
  const service = createService(repository, ledgerRepository, adapter)
  const session = await service.createSession(1002, 8, '发起人', {
    product: '水果礼盒',
    priceEach: 50,
    slotsTotal: 2,
  })
  await service.joinSession(session.id, 21, '甲')
  await service.joinSession(session.id, 22, '乙')

  const failed = await service.checkoutSession(session.id)
  assert.equal(failed.ok, false)
  assert.equal(failed.session?.status, 'failed')
  assert.equal(failed.session?.failureCode, 'MOCK_SETTLEMENT_FAILED')
  assert.equal(failed.trace?.receipt?.status, 'failed')

  const restarted = createService(repository, ledgerRepository, adapter)
  const replay = await restarted.checkoutSession(session.id)
  assert.equal(replay.ok, false)
  assert.equal(replay.trace?.receipt?.errorCode, 'MOCK_SETTLEMENT_FAILED')
  assert.equal(settlementCalls, 1)
})

function createService(
  repository: PoolMateRepository,
  ledgerRepository: PactLedgerRepository,
  adapter: SettlementAdapter,
): PoolMateService {
  return new PoolMateService(
    repository,
    new PactLedgerService(ledgerRepository, new PolicyEngine(), adapter),
  )
}

function mockReceipt(intent: AgentPaymentIntent): SettlementReceipt {
  return {
    intentId: intent.id,
    mode: 'mock',
    network: 'Mock',
    status: 'confirmed',
    transactionHash: `mock_${intent.id.toLowerCase()}`,
    confirmedAt: new Date().toISOString(),
  }
}
