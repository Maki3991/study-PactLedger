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
  assert.deepEqual(parsePoolRequest('@PoolMate 我们要拼单，期望3瓶可乐，每瓶89元'), {
    product: '可乐',
    priceEach: 89,
    slotsTotal: 3,
  })
  assert.equal(parsePoolRequest('随便聊聊'), undefined)
})

test('owner lock persists one canonical AP2-tagged Mock Receipt and is idempotent across service restart', async () => {
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
  assert.equal((await service.joinSession(session.id, 13, '丙')).session?.status, 'collecting')

  const [first, concurrentRetry] = await Promise.all([
    service.lockAndCheckoutSession(session.id, 7),
    service.lockAndCheckoutSession(session.id, 7),
  ])
  assert.equal(first.ok, true)
  assert.equal(concurrentRetry.ok, true)
  assert.equal(settlementCalls, 1)
  assert.equal(first.trace?.intent.id, `PM-${session.id}-MERCHANT`)
  assert.equal(first.trace?.intent.protocol, 'ap2')
  assert.equal(first.trace?.decision.code, 'POLICY_APPROVED')
  assert.equal(first.trace?.receipt?.mode, 'mock')
  assert.equal(first.trace?.receipt?.explorerUrl, undefined)
  assert.equal(first.session?.status, 'completed')
  assert.match(first.session?.merchantOrderId ?? '', /^DEMO-ORDER-/)
  assert.ok((await service.getMembers(session.id)).every((member) => member.status === 'paid'))

  const ownerRetry = await service.lockAndCheckoutSession(session.id, 7)
  assert.equal(ownerRetry.ok, true)
  assert.equal(ownerRetry.trace?.receipt?.transactionHash, first.trace?.receipt?.transactionHash)
  assert.equal(ownerRetry.trace?.receipt?.status, first.trace?.receipt?.status)
  assert.equal(settlementCalls, 1)

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

  const failed = await service.lockAndCheckoutSession(session.id, 8)
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

test('owner can lock below or above the expected quantity while other members cannot lock', async () => {
  const adapter: SettlementAdapter = {
    mode: 'mock',
    network: 'Mock',
    settle: async (intent) => mockReceipt(intent),
  }
  const repository = new PoolMateRepository()
  const ledgerRepository = new PactLedgerRepository()
  const service = createService(repository, ledgerRepository, adapter)

  const belowTarget = await service.createSession(1003, 31, '发起人', {
    product: '可乐',
    priceEach: 20,
    slotsTotal: 3,
  })
  await service.joinSession(belowTarget.id, 32, '成员', 2)
  const denied = await service.lockAndCheckoutSession(belowTarget.id, 32)
  assert.equal(denied.ok, false)
  assert.equal(denied.reason, '只有发起人可以锁单并确认结算')
  const lockedBelow = await service.lockAndCheckoutSession(belowTarget.id, 31)
  assert.equal(lockedBelow.ok, true)
  assert.equal(lockedBelow.trace?.intent.amount, 40)

  const aboveTarget = await service.createSession(1004, 41, '另一位发起人', {
    product: '咖啡',
    priceEach: 50,
    slotsTotal: 3,
  })
  const claimed = await service.joinSession(aboveTarget.id, 42, '成员', 4)
  assert.equal(claimed.ok, true)
  assert.equal(claimed.session?.slotsFilled, 4)
  assert.equal(claimed.session?.status, 'collecting')
  const lockedAbove = await service.lockAndCheckoutSession(aboveTarget.id, 41)
  assert.equal(lockedAbove.ok, true)
  assert.equal(lockedAbove.trace?.intent.amount, 200)
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
