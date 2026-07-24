import assert from 'node:assert/strict'
import test from 'node:test'
import type { MarketDataProvider } from './types.js'
import { FallbackMarketDataProvider } from './marketData.js'

const query = { symbol: '000001.SZ', startDate: '20250101', endDate: '20260101' }

test('auto provider falls back to Replay and labels the evidence when PandaData rejects credentials', async () => {
  const primary: MarketDataProvider = {
    fetchDaily: async () => {
      throw new Error('[错误码 200006 : 用户未注册]')
    },
  }
  const fallback: MarketDataProvider = {
    fetchDaily: async () => ({
      bars: [{ date: '20250102', close: 10, volume: 1 }],
      provider: 'replay',
      configured: false,
      sourceMethod: 'deterministic_replay',
      sdkVersion: '0.0.12',
      adjustment: 'synthetic',
      skill: 'QuantSkills/pandadata-api',
      note: 'fallback',
    }),
  }

  const result = await new FallbackMarketDataProvider(primary, fallback).fetchDaily(query)

  assert.equal(result.provider, 'replay')
  assert.equal(result.configured, true)
  assert.match(result.note, /PandaData 调用失败/)
  assert.match(result.note, /用户未注册/)
  assert.match(result.note, /不宣称真实行情/)
})

test('fallback evidence redacts credential-like values from provider errors', async () => {
  const primary: MarketDataProvider = {
    fetchDaily: async () => {
      throw new Error('password=do-not-leak token:abc123 postgresql://user:pass@example.test/db')
    },
  }
  const fallback: MarketDataProvider = {
    fetchDaily: async () => ({
      bars: [],
      provider: 'replay',
      configured: false,
      sourceMethod: 'deterministic_replay',
      sdkVersion: '0.0.12',
      adjustment: 'synthetic',
      skill: 'QuantSkills/pandadata-api',
      note: 'fallback',
    }),
  }

  const result = await new FallbackMarketDataProvider(primary, fallback).fetchDaily(query)

  assert.ok(!result.note.includes('do-not-leak'))
  assert.ok(!result.note.includes('abc123'))
  assert.ok(!result.note.includes('user:pass'))
  assert.match(result.note, /\[redacted\]/)
})
