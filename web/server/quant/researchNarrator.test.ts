import assert from 'node:assert/strict'
import test from 'node:test'
import type { CreateTaskInput, QuantEvidence, StrategyCandidate } from '../../src/domain/trading.js'
import { PandaModelResearchNarrator } from './researchNarrator.js'

test('DeepSeek narrator calls chat completions with the required V4 Pro model', async () => {
  const originalFetch = globalThis.fetch
  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.deepseek.com/chat/completions')
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-key')
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({
      model: 'deepseek-v4-pro',
      choices: [{ message: { content: '证据充分。' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const narrator = new PandaModelResearchNarrator({
      provider: 'deepseek',
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com',
      endpointId: 'deepseek-v4-pro',
      timeoutMs: 1_000,
    })
    const summary = await narrator.summarize(taskInput, evidence, candidates)
    assert.equal(summary, '证据充分。本结果不构成投资建议。')
    assert.equal(requestBody?.model, 'deepseek-v4-pro')
    assert.equal(requestBody?.stream, false)
    assert.ok(Array.isArray(requestBody?.messages))
  } finally {
    globalThis.fetch = originalFetch
  }
})

const taskInput: CreateTaskInput = {
  objective: '研究 000001.SZ',
  budgetUsdt: 1_000,
  maxLossPct: 5,
  maxAssetPct: 30,
  asset: '000001.SZ',
}

const evidence: QuantEvidence = {
  provider: 'panda-data',
  configured: true,
  sourceMethod: 'get_stock_daily_pre',
  sdkVersion: '0.0.12',
  adjustment: 'pre-adjusted',
  skill: 'QuantSkills/pandadata-api',
  symbol: '000001.SZ',
  startDate: '20250101',
  endDate: '20250723',
  barCount: 134,
  fetchedAt: '2026-07-24T00:00:00.000Z',
  note: 'PandaData Live',
}

const candidates: StrategyCandidate[] = [{
  id: 'candidate-1',
  name: '趋势策略',
  status: 'approved',
  note: '确定性证据',
  returnPct: 1,
  drawdownPct: 1,
  sharpe: 1,
  winRate: 50,
  volatility: 2,
  oosReturn: 0.5,
  trades: 5,
  signal: 'MA crossover',
}]
