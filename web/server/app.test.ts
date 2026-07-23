import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutionAdapter } from './adapters/execution.js'
import { buildApp } from './app.js'
import type { TaskSnapshot } from '../src/domain/trading.js'
import { readInjectiveConfig } from './config/injective.js'

const instantExecution: ExecutionAdapter = {
  execute: async () => ({ transactionHash: '0xtest-receipt', network: 'Injective Testnet' }),
}

test('task progresses through risk review and executes only after approval', async () => {
  const app = await buildApp({ stepDelay: 5, executionAdapter: instantExecution })
  await app.ready()

  const createdResponse = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      objective: '使用 PandaAI 数据研究 000001.SZ 股票策略并控制风险',
      budgetUsdt: 1_000,
      maxLossPct: 5,
      maxAssetPct: 30,
      asset: '000001.SZ',
    },
  })
  assert.equal(createdResponse.statusCode, 201)
  const created = createdResponse.json<TaskSnapshot>()

  const prematureExecution = await app.inject({ method: 'POST', url: `/api/tasks/${created.id}/execute` })
  assert.equal(prematureExecution.statusCode, 409)

  let current = created
  for (let attempt = 0; attempt < 30 && current.phase !== 'awaiting_approval'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    const response = await app.inject({ method: 'GET', url: `/api/tasks/${created.id}` })
    current = response.json<TaskSnapshot>()
  }

  assert.equal(current.phase, 'awaiting_approval')
  assert.equal(current.agents.find((agent) => agent.id === 'risk')?.status, 'complete')
  assert.equal(current.firewallRules[1].current, '25%')
  assert.ok(current.timeline.some((event) => event.title.includes('退回')))
  assert.ok(current.quantEvidence)
  assert.equal(current.quantEvidence?.provider, 'replay')
  assert.equal(current.actionIntent?.status, 'awaiting_approval')

  const approvedResponse = await app.inject({ method: 'POST', url: `/api/tasks/${created.id}/approve` })
  assert.equal(approvedResponse.statusCode, 200)
  assert.equal(approvedResponse.json<TaskSnapshot>().phase, 'approved')

  const executedResponse = await app.inject({ method: 'POST', url: `/api/tasks/${created.id}/execute` })
  assert.equal(executedResponse.statusCode, 200)
  const executed = executedResponse.json<TaskSnapshot>()
  assert.equal(executed.phase, 'executed')
  assert.equal(executed.execution.transactionHash, '0xtest-receipt')
  assert.equal(executed.agents.find((agent) => agent.id === 'execution')?.status, 'complete')

  await app.close()
})

test('task event endpoint emits an initial SSE snapshot', async () => {
  const app = await buildApp({ stepDelay: 1_000, executionAdapter: instantExecution })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')

  const createdResponse = await fetch(`http://127.0.0.1:${address.port}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      objective: '验证股票量化 SSE 是否会推送完整任务快照',
      budgetUsdt: 1_000,
      maxLossPct: 5,
      maxAssetPct: 30,
      asset: '000001.SZ',
    }),
  })
  const created = await createdResponse.json() as TaskSnapshot
  const controller = new AbortController()
  const streamResponse = await fetch(`http://127.0.0.1:${address.port}/api/tasks/${created.id}/events`, { signal: controller.signal })
  const reader = streamResponse.body?.getReader()
  assert.ok(reader)
  const chunk = await reader.read()
  const text = new TextDecoder().decode(chunk.value)
  assert.match(text, /event: task\.snapshot/)
  assert.match(text, new RegExp(created.id))
  controller.abort()

  await app.close()
})

test('testnet mode exposes only masked config and blocks execution until the adapter is ready', async () => {
  const secret = 'server-only-secret'
  const injectiveConfig = readInjectiveConfig({
    INJECTIVE_EXECUTION_MODE: 'testnet',
    INJECTIVE_WALLET_ADDRESS: 'inj1abcdefghijklmnopqrstuvwxyz123456',
    INJECTIVE_PRIVATE_KEY: secret,
    INJECTIVE_MARKET_ID: '0xmarket',
    INJECTIVE_SUBACCOUNT_ID: '0xsubaccount',
  })
  const app = await buildApp({ stepDelay: 1_000, injectiveConfig })
  await app.ready()

  const configResponse = await app.inject({ method: 'GET', url: '/api/config/injective' })
  assert.equal(configResponse.statusCode, 200)
  assert.equal(configResponse.json().walletAddress, 'inj1abcdef...123456')
  assert.ok(!configResponse.body.includes(secret))

  const createdResponse = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      objective: '验证股票意图在测试网配置未就绪时禁止直接执行',
      budgetUsdt: 1_000,
      maxLossPct: 5,
      maxAssetPct: 30,
      asset: '000001.SZ',
    },
  })
  const task = createdResponse.json<TaskSnapshot>()
  const executionResponse = await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/execute` })
  assert.equal(executionResponse.statusCode, 503)

  await app.close()
})
