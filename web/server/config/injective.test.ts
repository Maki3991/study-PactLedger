import assert from 'node:assert/strict'
import test from 'node:test'
import { getInjectiveConfigStatus, readInjectiveConfig } from './injective.js'

test('Injective config uses safe testnet defaults and reports missing signer values', () => {
  const config = readInjectiveConfig({ INJECTIVE_EXECUTION_MODE: 'mock' })
  const status = getInjectiveConfigStatus(config)

  assert.equal(status.chainId, 'injective-888')
  assert.equal(status.executionState, 'mock_ready')
  assert.equal(status.readyForExecution, true)
  assert.equal(status.credentialsConfigured, false)
  assert.deepEqual(status.missing, [
    'INJECTIVE_WALLET_ADDRESS',
    'INJECTIVE_PRIVATE_KEY',
    'INJECTIVE_PAYMENT_DENOM',
    'INJECTIVE_PAYMENT_DECIMALS',
    'INJECTIVE_RISK_PAYEE_ADDRESS',
    'INJECTIVE_EXECUTION_PAYEE_ADDRESS',
    'INJECTIVE_POOLMATE_MERCHANT_ADDRESS',
  ])
})

test('public Injective status masks the wallet and never exposes the private key', () => {
  const secret = 'never-return-this-private-key'
  const config = readInjectiveConfig({
    INJECTIVE_EXECUTION_MODE: 'testnet',
    INJECTIVE_WALLET_ADDRESS: 'inj1abcdefghijklmnopqrstuvwxyz123456',
    INJECTIVE_PRIVATE_KEY: secret,
    INJECTIVE_PAYMENT_DENOM: 'inj',
    INJECTIVE_PAYMENT_DECIMALS: '18',
    INJECTIVE_RISK_PAYEE_ADDRESS: 'inj1riskabcdefghijklmnopqrstuvwxyz12',
    INJECTIVE_EXECUTION_PAYEE_ADDRESS: 'inj1executionabcdefghijklmnopqrstu',
    INJECTIVE_POOLMATE_MERCHANT_ADDRESS: 'inj1merchantabcdefghijklmnopqrstuv',
  })
  const status = getInjectiveConfigStatus(config)
  const serialized = JSON.stringify(status)

  assert.equal(status.credentialsConfigured, true)
  assert.equal(status.walletAddress, 'inj1abcdef...123456')
  assert.equal(status.paymentAssetConfigured, true)
  assert.equal(status.payeesConfigured, true)
  assert.equal(status.readyForExecution, true)
  assert.equal(status.executionState, 'testnet_ready')
  assert.equal(status.adapter, 'injective-testnet')
  assert.ok(!serialized.includes(secret))
  assert.ok(!serialized.includes('privateKey'))
})

test('invalid payment decimals keep Testnet execution safely blocked', () => {
  const status = getInjectiveConfigStatus(readInjectiveConfig({
    INJECTIVE_EXECUTION_MODE: 'testnet',
    INJECTIVE_WALLET_ADDRESS: 'inj1abcdefghijklmnopqrstuvwxyz123456',
    INJECTIVE_PRIVATE_KEY: '1'.repeat(64),
    INJECTIVE_PAYMENT_DENOM: 'inj',
    INJECTIVE_PAYMENT_DECIMALS: '18.5',
    INJECTIVE_RISK_PAYEE_ADDRESS: 'inj1riskabcdefghijklmnopqrstuvwxyz12',
    INJECTIVE_EXECUTION_PAYEE_ADDRESS: 'inj1executionabcdefghijklmnopqrstu',
    INJECTIVE_POOLMATE_MERCHANT_ADDRESS: 'inj1merchantabcdefghijklmnopqrstuv',
  }))

  assert.equal(status.paymentAssetConfigured, false)
  assert.equal(status.executionState, 'testnet_configuration_required')
  assert.ok(status.missing.includes('INJECTIVE_PAYMENT_DECIMALS'))
})
