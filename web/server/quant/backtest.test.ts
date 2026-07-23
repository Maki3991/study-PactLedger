import assert from 'node:assert/strict'
import test from 'node:test'
import { ReplayMarketDataProvider } from './marketData.js'
import { runCandidateBacktests } from './backtest.js'

test('stock backtest produces reproducible metrics and one approved candidate', async () => {
  const provider = new ReplayMarketDataProvider()
  const result = await provider.fetchDaily({ symbol: '000001.SZ', startDate: '20240101', endDate: '20250701' })
  const candidates = runCandidateBacktests(result.bars, 5)

  assert.equal(candidates.length, 3)
  assert.equal(result.sourceMethod, 'deterministic_replay')
  assert.equal(result.sdkVersion, '0.0.12')
  assert.equal(result.skill, 'QuantSkills/pandadata-api')
  assert.equal(candidates.filter((candidate) => candidate.status === 'approved').length, 1)
  assert.ok(candidates.every((candidate) => Number.isFinite(candidate.returnPct)))
  assert.ok(candidates.every((candidate) => candidate.trades >= 0))
})
