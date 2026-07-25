import assert from 'node:assert/strict'
import test from 'node:test'
import type { QuantEvidence } from '../../src/domain/trading.js'
import { AgentMemory } from './agentMemory.js'
import { DecisionAgent } from './decisionAgent.js'
import type { MarketDataProvider } from './types.js'
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
  assert.equal(result.artifacts.marketData.length, result.evidence.barCount)
  assert.equal(result.artifacts.knowledgeBase.status, 'skipped')
  assert.equal(result.artifacts.analysis.mode, 'deterministic')
  assert.equal(result.artifacts.evolution.outcome, 'baseline_created')
  assert.equal(result.artifacts.evolution.archive.status, 'task_snapshot_only')
  assert.equal(result.artifacts.evolution.champion.name, result.winner.name)
  assert.deepEqual(Object.keys(result.artifacts.marketData[0]).sort(), ['close', 'date', 'volume'])
})

test('a later research round exposes the previous Champion and archives the evolved Agent', async () => {
  const replay = new ReplayMarketDataProvider()
  const liveProvider: MarketDataProvider = {
    fetchDaily: async (query) => {
      const replayResult = await replay.fetchDaily(query)
      return {
        ...replayResult,
        enrichment: {
          stockProfile: {
            symbol: query.symbol,
            name: '平安银行',
            status: 1,
            boardType: '主板',
            listedDate: '19910403',
            minOrderAmount: 100,
          },
          industry: { code: '801780', name: '银行', level: 'L1' },
          benchmark: {
            symbol: '000300.SH',
            bars: replayResult.bars.map((bar, index) => ({
              ...bar,
              close: Number((100 + index * 0.05).toFixed(4)),
            })),
          },
          sources: [
            { method: 'get_stock_daily_pre', status: 'used', recordCount: replayResult.bars.length },
            { method: 'get_stock_detail', status: 'used', recordCount: 1 },
            { method: 'get_stock_industry', status: 'used', recordCount: 1 },
            { method: 'get_index_daily', status: 'used', recordCount: replayResult.bars.length },
          ],
        },
        provider: 'panda-data',
        configured: true,
        sourceMethod: 'get_stock_daily_pre',
        adjustment: 'pre-adjusted',
        note: 'test live data',
      }
    },
  }
  const memory = new AgentMemory()
  const now = new Date().toISOString()
  const evidence: QuantEvidence = {
    provider: 'panda-data', configured: true, sourceMethod: 'get_stock_daily_pre',
    sdkVersion: '0.0.12', adjustment: 'pre-adjusted', skill: 'QuantSkills/pandadata-api',
    symbol: '000001.SZ', startDate: '20250101', endDate: '20250723',
    barCount: 120, fetchedAt: now, note: 'previous round',
  }
  await memory.save({
    id: 'DEC-PREVIOUS', taskId: 'TASK-PREVIOUS', symbol: '000001.SZ',
    date: now.slice(0, 10), marketRegime: '震荡', proposals: [],
    selectedStrategy: 'Legacy-V0', evidence, createdAt: now,
  })
  const narrator: ResearchNarrator = {
    summarize: async () => '本轮研究完成，不构成投资建议。',
    proposeStrategies: async () => [{
      id: 'ai-1', name: '状态过滤提案', description: '识别市场状态后选择信号',
      entryRules: '趋势确认', exitRules: '趋势失效', positionLogic: '25%',
      confidence: 0.8, rationale: '降低假突破', marketRegime: '震荡',
    }],
    evaluateCandidates: async (candidates) => ({
      ranking: candidates.map((candidate) => candidate.id),
      recommendation: '按 Sharpe 与回撤选择本轮 Champion。',
    }),
  }
  const decisionAgent = new DecisionAgent(narrator, memory)
  const service = new QuantResearchService(liveProvider, narrator, decisionAgent)
  const result = await service.analyze({
    objective: '第二轮研究 000001.SZ', budgetUsdt: 1_000,
    maxLossPct: 5, maxAssetPct: 30, asset: '000001.SZ',
    startDate: '20250101', endDate: '20250723',
  }, 'TASK-ROUND-2')

  assert.equal(result.artifacts.evolution.outcome, 'champion_promoted')
  assert.equal(result.artifacts.evolution.previousChampion?.decisionId, 'DEC-PREVIOUS')
  assert.equal(result.artifacts.evolution.previousChampion?.strategy, 'Legacy-V0')
  assert.equal(result.artifacts.evolution.archive.status, 'knowledge_base')
  assert.equal(result.artifacts.marketContext?.stockProfile?.name, '平安银行')
  assert.equal(result.artifacts.marketContext?.industry?.name, '银行')
  assert.equal(result.artifacts.marketContext?.benchmark?.symbol, '000300.SH')
  assert.equal(result.artifacts.marketContext?.benchmark?.alignedBarCount, result.evidence.barCount)
  assert.ok(Number.isFinite(result.artifacts.marketContext?.benchmark?.excessReturnPct))
  assert.equal(result.artifacts.marketContext?.sources.filter((source) => source.status === 'used').length, 4)
  assert.ok(result.artifacts.evolution.archive.decisionId?.startsWith('DEC-'))
  assert.deepEqual(result.artifacts.evolution.referencedDecisionIds, ['DEC-PREVIOUS'])
  assert.equal((await memory.findBySymbol('000001.SZ')).length, 2)
})
