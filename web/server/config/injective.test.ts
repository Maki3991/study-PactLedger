import assert from 'node:assert/strict'
import test from 'node:test'
import { getInjectiveConfigStatus, readInjectiveConfig } from './injective.js'

test('Injective config uses safe testnet defaults and reports missing signer values', () => {
  const config = readInjectiveConfig({ INJECTIVE_EXECUTION_MODE: 'mock' })
  const status = getInjectiveConfigStatus(config)

  assert.equal(status.chainId, 'injective-888')
  assert.equal(status.readyForExecution, true)
  assert.equal(status.credentialsConfigured, false)
  assert.deepEqual(status.missing, [
    'INJECTIVE_WALLET_ADDRESS',
    'INJECTIVE_PRIVATE_KEY',
    'INJECTIVE_MARKET_ID',
    'INJECTIVE_SUBACCOUNT_ID',
  ])
})

test('public Injective status masks the wallet and never exposes the private key', () => {
  const secret = 'never-return-this-private-key'
  const config = readInjectiveConfig({
    INJECTIVE_EXECUTION_MODE: 'testnet',
    INJECTIVE_WALLET_ADDRESS: 'inj1abcdefghijklmnopqrstuvwxyz123456',
    INJECTIVE_PRIVATE_KEY: secret,
    INJECTIVE_MARKET_ID: '0xmarket',
    INJECTIVE_SUBACCOUNT_ID: '0xsubaccount',
  })
  const status = getInjectiveConfigStatus(config)
  const serialized = JSON.stringify(status)

  assert.equal(status.credentialsConfigured, true)
  assert.equal(status.walletAddress, 'inj1abcdef...123456')
  assert.equal(status.readyForExecution, false)
  assert.equal(status.adapter, 'testnet-pending')
  assert.ok(!serialized.includes(secret))
  assert.ok(!serialized.includes('privateKey'))
})
