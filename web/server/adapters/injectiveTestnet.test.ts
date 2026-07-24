import assert from 'node:assert/strict'
import test from 'node:test'
import { PrivateKey } from '@injectivelabs/sdk-ts'
import type { AgentPaymentIntent } from '../../src/domain/pactledger.js'
import { readInjectiveConfig, type InjectiveConfig } from '../config/injective.js'
import { SettlementAdapterError } from './execution.js'
import {
  decimalToAtomicAmount,
  InjectiveTestnetSettlementAdapter,
} from './injectiveTestnet.js'

const payerPrivateKey = '1'.repeat(64)
const payeePrivateKey = '2'.repeat(64)
const payerAddress = PrivateKey.fromHex(payerPrivateKey).toBech32()
const payeeAddress = PrivateKey.fromHex(payeePrivateKey).toBech32()

function fullConfig(overrides: Partial<InjectiveConfig> = {}): InjectiveConfig {
  const base = readInjectiveConfig({
    INJECTIVE_EXECUTION_MODE: 'testnet',
    INJECTIVE_WALLET_ADDRESS: payerAddress,
    INJECTIVE_PRIVATE_KEY: payerPrivateKey,
    INJECTIVE_PAYMENT_DENOM: 'inj',
    INJECTIVE_PAYMENT_DECIMALS: '18',
    INJECTIVE_RISK_PAYEE_ADDRESS: payeeAddress,
    INJECTIVE_EXECUTION_PAYEE_ADDRESS: payeeAddress,
    INJECTIVE_POOLMATE_MERCHANT_ADDRESS: payeeAddress,
  })
  return {
    ...base,
    ...overrides,
    payeeAddresses: {
      ...base.payeeAddresses,
      ...overrides.payeeAddresses,
    },
  }
}

function intent(overrides: Partial<AgentPaymentIntent> = {}): AgentPaymentIntent {
  return {
    id: 'PAY-TESTNET-001',
    tenantId: 'tenant-test',
    appId: 'kaleidox',
    payerAgentId: 'strategy',
    payeeId: 'risk',
    amount: 1.25,
    currency: 'USDT',
    purpose: 'risk_review',
    protocol: 'internal',
    status: 'settling',
    expiresAt: '2027-01-01T00:00:00.000Z',
    metadataHash: 'sha256:test',
    createdAt: '2026-07-24T00:00:00.000Z',
    ...overrides,
  }
}

test('decimalToAtomicAmount maps readable amounts without floating-point multiplication', () => {
  assert.equal(decimalToAtomicAmount(1.25, 18), '1250000000000000000')
  assert.equal(decimalToAtomicAmount(0.000001, 6), '1')
  assert.throws(
    () => decimalToAtomicAmount(1.0000001, 6),
    (error: unknown) => error instanceof SettlementAdapterError
      && error.code === 'PAYMENT_AMOUNT_PRECISION_INVALID',
  )
})

test('confirmed Testnet result becomes a verifiable Receipt with atomic amount and Explorer evidence', async () => {
  let captured: {
    payerAddress: string
    payeeAddress: string
    amountAtomic: string
    denom: string
    memo: string
  } | undefined
  const adapter = new InjectiveTestnetSettlementAdapter(fullConfig(), {
    now: () => new Date('2026-07-24T12:00:00.000Z'),
    broadcast: async (request) => {
      captured = {
        payerAddress: request.payerAddress,
        payeeAddress: request.payeeAddress,
        amountAtomic: request.amountAtomic,
        denom: request.denom,
        memo: request.memo,
      }
      return {
        txHash: 'ABC123',
        height: 987654,
        code: 0,
        gasUsed: 123456,
        timestamp: '2026-07-24T12:00:01.000Z',
      }
    },
  })

  const receipt = await adapter.settle(intent())

  assert.deepEqual(captured, {
    payerAddress,
    payeeAddress,
    amountAtomic: '1250000000000000000',
    denom: 'inj',
    memo: 'PactLedger:PAY-TESTNET-001',
  })
  assert.equal(receipt.status, 'confirmed')
  assert.equal(receipt.mode, 'testnet')
  assert.equal(receipt.transactionHash, 'ABC123')
  assert.equal(receipt.blockHeight, '987654')
  assert.equal(receipt.gasUsed, 123456)
  assert.equal(receipt.explorerUrl, 'https://testnet.explorer.injective.network/transaction/ABC123')
})

test('invalid Injective addresses are rejected before broadcast', async () => {
  let broadcasts = 0
  const adapter = new InjectiveTestnetSettlementAdapter(fullConfig({ walletAddress: 'not-an-injective-address' }), {
    now: () => new Date('2026-07-24T12:00:00.000Z'),
    broadcast: async () => {
      broadcasts += 1
      return { txHash: 'unused', height: 1, code: 0 }
    },
  })

  await expectCode(adapter.settle(intent()), 'INJECTIVE_ADDRESS_INVALID')
  assert.equal(broadcasts, 0)
})

test('denom mismatch and malformed configured denom are rejected before broadcast', async () => {
  const mismatch = new InjectiveTestnetSettlementAdapter(fullConfig(), {
    now: () => new Date('2026-07-24T12:00:00.000Z'),
  })
  await expectCode(mismatch.settle(intent({ denom: 'factory/inj1demo/usdt' })), 'INJECTIVE_DENOM_MISMATCH')

  const malformed = new InjectiveTestnetSettlementAdapter(fullConfig({ paymentDenom: 'bad denom' }), {
    now: () => new Date('2026-07-24T12:00:00.000Z'),
  })
  await expectCode(malformed.settle(intent()), 'INJECTIVE_DENOM_INVALID')
})

test('expired Payment Intent never reaches the Injective broadcaster', async () => {
  let broadcasts = 0
  const adapter = new InjectiveTestnetSettlementAdapter(fullConfig(), {
    now: () => new Date('2026-07-24T12:00:00.000Z'),
    broadcast: async () => {
      broadcasts += 1
      return { txHash: 'unused', height: 1, code: 0 }
    },
  })

  await expectCode(
    adapter.settle(intent({ expiresAt: '2026-07-24T11:59:59.000Z' })),
    'PAYMENT_INTENT_EXPIRED',
  )
  assert.equal(broadcasts, 0)
})

test('atomic amount supplied by an Intent must match the server-side asset mapping', async () => {
  const adapter = new InjectiveTestnetSettlementAdapter(fullConfig(), {
    now: () => new Date('2026-07-24T12:00:00.000Z'),
  })

  await expectCode(
    adapter.settle(intent({ amountAtomic: '1250000000000000001' })),
    'INJECTIVE_ATOMIC_AMOUNT_MISMATCH',
  )
})

test('SDK and RPC failures map to a stable error without leaking the private key', async () => {
  const adapter = new InjectiveTestnetSettlementAdapter(fullConfig(), {
    now: () => new Date('2026-07-24T12:00:00.000Z'),
    broadcast: async () => {
      throw new Error(`sensitive rpc payload ${payerPrivateKey}`)
    },
  })

  const error = await expectCode(adapter.settle(intent()), 'INJECTIVE_BROADCAST_FAILED')
  assert.ok(!error.message.includes(payerPrivateKey))
  assert.ok(!JSON.stringify(error).includes(payerPrivateKey))
})

async function expectCode(promise: Promise<unknown>, code: string): Promise<SettlementAdapterError> {
  let captured: SettlementAdapterError | undefined
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof SettlementAdapterError)
    assert.equal(error.code, code)
    captured = error
    return true
  })
  assert.ok(captured)
  return captured
}
