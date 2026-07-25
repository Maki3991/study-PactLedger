import assert from 'node:assert/strict'
import test from 'node:test'
import type { QuantEvidence, StrategyCandidate } from '../../src/domain/trading.js'
import { AgentMemory } from './agentMemory.js'
import { DecisionAgent } from './decisionAgent.js'
import type { ResearchNarrator } from './researchNarrator.js'
import type { PriceBar } from './types.js'

function createMockNarrator(overrides: Partial<ResearchNarrator> = {}): ResearchNarrator {
  return {
    summarize: async () => 'Mock summary',
    proposeStrategies: async () => [
      {
        id: 'v1', name: 'AI双均线', description: 'AI generated MA crossover',
        entryRules: 'MA5 > MA20', exitRules: 'MA5 < MA20',
        positionLogic: '30%', confidence: 0.7, rationale: '趋势跟随', marketRegime: '震荡偏牛',
      },
      {
        id: 'v2a', name: 'AI波动率过滤', description: 'AI vol filter',
        entryRules: 'MA5 > MA20 & vol < 2.2%', exitRules: 'MA5 < MA20',
        positionLogic: '25%', confidence: 0.8, rationale: '降低假突破', marketRegime: '震荡偏牛',
      },
    ],
    evaluateCandidates: async () => ({
      ranking: ['v2a', 'v1', 'v2b'],
      recommendation: 'AI 波动率过滤策略在当前震荡偏牛市场中表现最优',
    }),
    ...overrides,
  }
}

function createMockBars(count = 200): PriceBar[] {
  const bars: PriceBar[] = []
  let price = 10
  for (let i = 0; i < count; i++) {
    price *= 1 + (Math.random() - 0.48) * 0.04
    bars.push({ date: `20260${String(Math.floor(i / 30) + 1).padStart(2, '0')}${String(i % 30 + 1).padStart(2, '0')}`, close: Number(price.toFixed(2)), volume: 10_000_000 + Math.random() * 5_000_000 })
  }
  return bars
}

test('DecisionAgent generates strategies from price bars', async () => {
  const memory = new AgentMemory()
  await memory.initialize()
  const narrator = createMockNarrator()
  const agent = new DecisionAgent(narrator, memory)

  const bars = createMockBars()
  const result = await agent.generateStrategies(
    bars,
    { maxLossPct: 10, maxAssetPct: 30, budget: 1000 },
    '000001.SZ',
    { start: '20260101', end: '20260724' },
  )

  assert.equal(result.proposals.length, 2)
  assert.equal(result.proposals[0].id, 'v1')
  assert.equal(result.proposals[0].name, 'AI双均线')
  assert.ok(result.marketRegime.length > 0)
})

test('DecisionAgent backtests proposals using deterministic engine', async () => {
  const memory = new AgentMemory()
  await memory.initialize()
  const agent = new DecisionAgent(createMockNarrator(), memory)

  const bars = createMockBars(100)
  const candidates = await agent.backtestProposals([], bars, 15)

  assert.ok(candidates.length >= 1)
  assert.ok(candidates.every((c) => typeof c.sharpe === 'number'))
  assert.ok(candidates.every((c) => typeof c.drawdownPct === 'number'))
  assert.ok(candidates.some((c) => c.status === 'approved'))
})

test('DecisionAgent evaluates and ranks candidates', async () => {
  const memory = new AgentMemory()
  await memory.initialize()
  const narrator = createMockNarrator()
  const agent = new DecisionAgent(narrator, memory)

  const candidates: StrategyCandidate[] = [
    { id: 'v1', name: 'V1', status: 'testing', note: '', returnPct: 5, drawdownPct: 8, sharpe: 0.8, winRate: 55, volatility: 18, oosReturn: 3, trades: 20, signal: '双均线' },
    { id: 'v2a', name: 'V2-A', status: 'approved', note: '', returnPct: 8, drawdownPct: 6, sharpe: 1.2, winRate: 60, volatility: 15, oosReturn: 6, trades: 15, signal: '均线+波动率' },
  ]

  const result = await agent.evaluateAndRank(candidates, {
    bars: createMockBars(),
    marketRegime: '震荡偏牛',
    symbol: '000001.SZ',
  })

  assert.ok(result.ranking.length >= 2)
  assert.ok(result.ranking.includes('v1'))
  assert.ok(result.recommendation.length > 0)
})

test('DecisionAgent records decision to memory', async () => {
  const memory = new AgentMemory()
  await memory.initialize()
  const agent = new DecisionAgent(createMockNarrator(), memory)

  const evidence: QuantEvidence = {
    provider: 'replay', configured: false, sourceMethod: 'deterministic_replay',
    sdkVersion: '0.0.12', adjustment: 'synthetic', skill: 'QuantSkills/pandadata-api',
    symbol: '000001.SZ', startDate: '20260101', endDate: '20260724',
    barCount: 200, fetchedAt: new Date().toISOString(), note: 'test',
  }

  const record = await agent.recordDecision({
    taskId: 'task-test',
    symbol: '000001.SZ',
    marketRegime: '震荡',
    proposals: [],
    selectedStrategy: 'V2-A',
    evidence,
  })

  assert.ok(record.id.startsWith('DEC-'))
  assert.equal(record.taskId, 'task-test')

  const found = await memory.findBySymbol('000001.SZ')
  assert.equal(found.length, 1)
  assert.equal(found[0].selectedStrategy, 'V2-A')
})

test('DecisionAgent falls back when narrator proposeStrategies fails', async () => {
  const memory = new AgentMemory()
  await memory.initialize()
  const narrator = createMockNarrator({
    proposeStrategies: async () => { throw new Error('DeepSeek unavailable') },
  })
  const agent = new DecisionAgent(narrator, memory)

  // Should still fail through — caller handles it
  try {
    await agent.generateStrategies(
      createMockBars(),
      { maxLossPct: 10, maxAssetPct: 30, budget: 1000 },
      '000001.SZ',
      { start: '20260101', end: '20260724' },
    )
    assert.fail('Expected error was not thrown')
  } catch (error) {
    assert.ok(error instanceof Error)
    assert.ok(error.message.includes('DeepSeek'))
  }
})
