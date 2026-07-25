import assert from 'node:assert/strict'
import test from 'node:test'
import type { DecisionRecord, QuantEvidence, StrategyProposal } from '../../src/domain/trading.js'
import { AgentMemory } from './agentMemory.js'

function makeRecord(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: 'DEC-TEST001',
    taskId: 'task-test-001',
    symbol: '000001.SZ',
    date: '2026-07-24',
    marketRegime: '震荡',
    proposals: [
      {
        id: 'v1',
        name: '双均线趋势',
        description: '5/20 日均线策略',
        entryRules: '金叉',
        exitRules: '死叉',
        positionLogic: '30%',
        confidence: 0.6,
        rationale: '经典策略',
        marketRegime: '趋势',
      },
    ],
    selectedStrategy: '双均线趋势',
    evidence: {
      provider: 'replay',
      configured: false,
      sourceMethod: 'deterministic_replay',
      sdkVersion: '0.0.12',
      adjustment: 'synthetic',
      skill: 'QuantSkills/pandadata-api',
      symbol: '000001.SZ',
      startDate: '20250101',
      endDate: '20260724',
      barCount: 380,
      fetchedAt: new Date().toISOString(),
      note: 'test',
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

test('AgentMemory saves and retrieves decision records', async () => {
  const memory = new AgentMemory()
  await memory.initialize()

  const record = makeRecord()
  await memory.save(record)

  const count = await memory.count()
  assert.equal(count, 1)

  const found = await memory.findBySymbol('000001.SZ')
  assert.equal(found.length, 1)
  assert.equal(found[0].id, 'DEC-TEST001')
  assert.equal(found[0].marketRegime, '震荡')
  assert.equal(found[0].proposals.length, 1)
  assert.equal(found[0].selectedStrategy, '双均线趋势')
})

test('AgentMemory findBySymbol returns empty for unknown symbol', async () => {
  const memory = new AgentMemory()
  await memory.initialize()
  const found = await memory.findBySymbol('999999.SZ')
  assert.equal(found.length, 0)
})

test('AgentMemory getRecentContext returns formatted text', async () => {
  const memory = new AgentMemory()
  await memory.initialize()

  await memory.save(makeRecord({ id: 'DEC-001', symbol: '000001.SZ', marketRegime: '牛市', selectedStrategy: 'V1' }))
  await memory.save(makeRecord({ id: 'DEC-002', symbol: '600000.SH', marketRegime: '震荡', selectedStrategy: 'V2-A' }))

  const context = await memory.getRecentContext(30)
  assert.ok(context.includes('决策记录'))
  assert.ok(context.includes('牛市'))
  assert.ok(context.includes('V1'))
})

test('AgentMemory count starts at zero', async () => {
  const memory = new AgentMemory()
  await memory.initialize()
  assert.equal(await memory.count(), 0)
})

test('AgentMemory save with same id does not duplicate', async () => {
  const memory = new AgentMemory()
  await memory.initialize()
  await memory.save(makeRecord({ id: 'DEC-DUP' }))
  await memory.save(makeRecord({ id: 'DEC-DUP', marketRegime: '熊市' }))
  const found = await memory.findBySymbol('000001.SZ')
  assert.equal(found.length, 1)
  // First write wins (ON CONFLICT DO NOTHING)
  assert.equal(found[0].marketRegime, '震荡')
})
