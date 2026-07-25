import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResearchNarrator } from './researchNarrator.js'
import { ReplayMarketDataProvider } from './marketData.js'
import { QuantResearchService } from './service.js'

test('model failure fallback always includes the required investment risk disclaimer', async () => {
  const failingNarrator: ResearchNarrator = {
    summarize: async () => { throw new Error('provider unavailable') },
    proposeStrategies: async () => [],
    evaluateCandidates: async () => ({ ranking: [], recommendation: '' }),
  }
  const service = new QuantResearchService(new ReplayMarketDataProvider(), failingNarrator)
  const result = await service.analyze({
    objective: '研究 000001.SZ',
    budgetUsdt: 1_000,
    maxLossPct: 5,
    maxAssetPct: 30,
    asset: '000001.SZ',
    startDate: '20250101',
    endDate: '20250723',
  })

  assert.match(result.researchSummary, /不构成投资建议/)
})
