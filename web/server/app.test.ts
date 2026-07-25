import assert from 'node:assert/strict'
import test from 'node:test'
import type { FastifyInstance } from 'fastify'
import type { TaskSnapshot } from '../src/domain/trading.js'
import { SettlementAdapterError, type ExecutionAdapter } from './adapters/execution.js'
import { buildApp } from './app.js'
import { readInjectiveConfig } from './config/injective.js'

const instantExecution: ExecutionAdapter = {
  mode: 'testnet',
  network: 'Injective Testnet',
  settle: async (intent) => ({
    intentId: intent.id,
    mode: 'testnet',
    transactionHash: '0xtest-receipt',
    network: 'Injective Testnet',
    status: 'confirmed',
    confirmedAt: new Date().toISOString(),
  }),
}

const demoTaskPayload = {
  objective: 'Research a risk-controlled stock strategy for 000001.SZ',
  budgetUsdt: 1_000,
  maxLossPct: 5,
  maxAssetPct: 30,
  asset: '000001.SZ',
}

let userSeq = 0

async function registerAndGetToken(app: FastifyInstance): Promise<string> {
  userSeq += 1
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: `tester_${userSeq}`, password: 'secret-123' },
  })
  assert.equal(response.statusCode, 201)
  return response.json<{ token: string }>().token
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

test('auth flow supports register, login, session restore and logout', async () => {
  const app = await buildApp({ stepDelay: 5, executionAdapter: instantExecution })
  await app.ready()

  const unauthorized = await app.inject({ method: 'POST', url: '/api/tasks', payload: demoTaskPayload })
  assert.equal(unauthorized.statusCode, 401)

  const invalidRegister = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'x', password: 'secret-123' },
  })
  assert.equal(invalidRegister.statusCode, 400)

  const registerResponse = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'alice', password: 'secret-123' },
  })
  assert.equal(registerResponse.statusCode, 201)
  const session = registerResponse.json<{ token: string; user: { username: string } }>()
  assert.equal(session.user.username, 'alice')

  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'Alice', password: 'secret-123' },
  })
  assert.equal(duplicate.statusCode, 409)

  const wrongPassword = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'alice', password: 'wrong-password' },
  })
  assert.equal(wrongPassword.statusCode, 401)

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'alice', password: 'secret-123' },
  })
  assert.equal(loginResponse.statusCode, 200)
  const loginToken = loginResponse.json<{ token: string }>().token

  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(loginToken) })
  assert.equal(me.statusCode, 200)
  assert.equal(me.json<{ user: { username: string } }>().user.username, 'alice')

  const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth(loginToken) })
  assert.equal(logout.statusCode, 204)

  const meAfterLogout = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(loginToken) })
  assert.equal(meAfterLogout.statusCode, 401)
  await app.close()
})

test('tasks and treasury records are isolated per user', async () => {
  const app = await buildApp({ stepDelay: 5, executionAdapter: instantExecution })
  await app.ready()
  const aliceToken = await registerAndGetToken(app)
  const bobToken = await registerAndGetToken(app)

  const created = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: auth(aliceToken),
    payload: demoTaskPayload,
  })
  assert.equal(created.statusCode, 201)
  const task = created.json<TaskSnapshot>()
  assert.ok(task.ownerId)

  assert.equal((await app.inject({ method: 'GET', url: `/api/tasks/${task.id}`, headers: auth(aliceToken) })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: `/api/tasks/${task.id}`, headers: auth(bobToken) })).statusCode, 404)
  assert.equal((await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/approve`, headers: auth(bobToken) })).statusCode, 404)
  assert.equal((await app.inject({ method: 'GET', url: `/api/treasury/${task.id}/accounts`, headers: auth(bobToken) })).statusCode, 404)
  await app.close()
})

test('stock task reaches approval and executes only after explicit approval', async () => {
  const app = await buildApp({ stepDelay: 5, executionAdapter: instantExecution })
  await app.ready()
  const token = await registerAndGetToken(app)
  const createdResponse = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: auth(token),
    payload: demoTaskPayload,
  })
  assert.equal(createdResponse.statusCode, 201)
  const created = createdResponse.json<TaskSnapshot>()

  const prematureExecution = await app.inject({ method: 'POST', url: `/api/tasks/${created.id}/execute`, headers: auth(token) })
  assert.equal(prematureExecution.statusCode, 409)

  let current = created
  for (let attempt = 0; attempt < 40 && current.phase !== 'awaiting_approval'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    const response = await app.inject({ method: 'GET', url: `/api/tasks/${created.id}`, headers: auth(token) })
    current = response.json<TaskSnapshot>()
  }

  assert.equal(current.phase, 'awaiting_approval')
  assert.equal(current.firewallRules[1].current, '25%')
  assert.ok(current.timeline.some((event) => event.tone === 'warning'))
  assert.equal(current.quantEvidence?.provider, 'replay')
  assert.equal(current.actionIntent?.status, 'awaiting_approval')

  const approvedResponse = await app.inject({ method: 'POST', url: `/api/tasks/${created.id}/approve`, headers: auth(token) })
  assert.equal(approvedResponse.statusCode, 200)
  assert.equal(approvedResponse.json<TaskSnapshot>().phase, 'approved')

  const executedResponse = await app.inject({ method: 'POST', url: `/api/tasks/${created.id}/execute`, headers: auth(token) })
  assert.equal(executedResponse.statusCode, 200)
  const executed = executedResponse.json<TaskSnapshot>()
  assert.equal(executed.phase, 'executed')
  assert.equal(executed.execution.transactionHash, '0xtest-receipt')
  await app.close()
})

test('task event endpoint emits an authenticated initial SSE snapshot', async () => {
  const app = await buildApp({ stepDelay: 1_000, executionAdapter: instantExecution })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')

  const registerResponse = await fetch(`http://127.0.0.1:${address.port}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'sse_user', password: 'secret-123' }),
  })
  const session = await registerResponse.json() as { token: string }
  const createdResponse = await fetch(`http://127.0.0.1:${address.port}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(session.token) },
    body: JSON.stringify(demoTaskPayload),
  })
  const created = await createdResponse.json() as TaskSnapshot
  const controller = new AbortController()
  const streamResponse = await fetch(
    `http://127.0.0.1:${address.port}/api/tasks/${created.id}/events?token=${encodeURIComponent(session.token)}`,
    { signal: controller.signal },
  )
  const reader = streamResponse.body?.getReader()
  assert.ok(reader)
  const chunk = await reader.read()
  const text = new TextDecoder().decode(chunk.value)
  assert.match(text, /event: task\.snapshot/)
  assert.match(text, new RegExp(created.id))
  controller.abort()
  await app.close()
})

test('testnet mode masks credentials and blocks execution until the adapter is ready', async () => {
  const secret = 'server-only-secret'
  const injectiveConfig = readInjectiveConfig({
    INJECTIVE_EXECUTION_MODE: 'testnet',
    INJECTIVE_WALLET_ADDRESS: 'inj1abcdefghijklmnopqrstuvwxyz123456',
    INJECTIVE_PRIVATE_KEY: secret,
  })
  const app = await buildApp({ stepDelay: 1_000, injectiveConfig })
  await app.ready()
  const token = await registerAndGetToken(app)

  const configResponse = await app.inject({ method: 'GET', url: '/api/config/injective', headers: auth(token) })
  assert.equal(configResponse.statusCode, 200)
  assert.equal(configResponse.json().walletAddress, 'inj1abcdef...123456')
  assert.ok(!configResponse.body.includes(secret))

  const createdResponse = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: auth(token),
    payload: demoTaskPayload,
  })
  const task = createdResponse.json<TaskSnapshot>()
  const executionResponse = await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/execute`, headers: auth(token) })
  assert.equal(executionResponse.statusCode, 503)
  await app.close()
})

test('public base status is truthful, unauthenticated and never exposes signer secrets', async () => {
  const secret = '1'.repeat(64)
  const injectiveConfig = readInjectiveConfig({
    INJECTIVE_EXECUTION_MODE: 'testnet',
    INJECTIVE_WALLET_ADDRESS: 'inj1abcdefghijklmnopqrstuvwxyz123456',
    INJECTIVE_PRIVATE_KEY: secret,
    INJECTIVE_PAYMENT_DENOM: 'inj',
    INJECTIVE_PAYMENT_DECIMALS: '18',
    INJECTIVE_RISK_PAYEE_ADDRESS: 'inj1riskabcdefghijklmnopqrstuvwxyz12',
    INJECTIVE_EXECUTION_PAYEE_ADDRESS: 'inj1executionabcdefghijklmnopqrstu',
    INJECTIVE_POOLMATE_MERCHANT_ADDRESS: 'inj1merchantabcdefghijklmnopqrstuv',
  })
  const app = await buildApp({ stepDelay: 1_000, injectiveConfig })
  await app.ready()

  const response = await app.inject({ method: 'GET', url: '/api/public/base-status' })
  assert.equal(response.statusCode, 200)
  const payload = response.json()
  assert.equal(payload.product, 'PactLedger')
  assert.equal(payload.execution.state, 'testnet_ready')
  assert.equal(payload.execution.receiptPersistence, 'memory')
  assert.deepEqual(payload.flow, [
    'Agent Intent',
    'PactLedger Policy',
    'Injective Settlement',
    'Verifiable Receipt',
  ])
  assert.ok(!response.body.includes(secret))
  assert.ok(!response.body.includes('privateKey'))
  await app.close()
})

test('public PoolMate Bot status verifies Telegram without exposing the server token', async () => {
  const token = 'telegram-server-only-token'
  const app = await buildApp({
    stepDelay: 1_000,
    telegramBotToken: token,
    telegramProbe: async () => ({ username: 'pactledger_poolmate_bot', firstName: 'PoolMate' }),
  })
  await app.ready()

  const response = await app.inject({ method: 'GET', url: '/api/public/poolmate/bot-status' })
  assert.equal(response.statusCode, 200)
  const status = response.json()
  assert.equal(status.ok, true)
  assert.equal(status.configured, true)
  assert.equal(status.running, false)
  assert.equal(status.settlementMode, 'mock')
  assert.equal(status.username, 'pactledger_poolmate_bot')
  assert.equal(status.reasonCode, 'BOT_NOT_STARTED')
  assert.ok(!response.body.includes(token))
  await app.close()
})

test('PoolMate proves approved merchant payment and blocks an unknown payee through the same API', async () => {
  const app = await buildApp({ stepDelay: 1_000 })
  await app.ready()

  const approvedResponse = await app.inject({
    method: 'POST',
    url: '/api/demo/poolmate/checkout',
    payload: { scenario: 'approved', intentId: 'PM-APPROVED-001' },
  })
  assert.equal(approvedResponse.statusCode, 200)
  const approved = approvedResponse.json()
  assert.equal(approved.intent.appId, 'poolmate')
  assert.equal(approved.decision.code, 'POLICY_APPROVED')
  assert.equal(approved.receipt.mode, 'mock')
  assert.match(approved.receipt.transactionHash, /^mock_[0-9a-f]{24}$/)

  const blockedResponse = await app.inject({
    method: 'POST',
    url: '/api/demo/poolmate/checkout',
    payload: { scenario: 'blocked', intentId: 'PM-BLOCKED-001' },
  })
  assert.equal(blockedResponse.statusCode, 200)
  const blocked = blockedResponse.json()
  assert.equal(blocked.decision.outcome, 'rejected')
  assert.equal(blocked.decision.code, 'PAYEE_NOT_ALLOWED')
  assert.equal(blocked.intent.status, 'policy_rejected')
  assert.equal(blocked.receipt, undefined)
  await app.close()
})

test('Agent Card and A2A task routes are accessible in safe Mock mode', async () => {
  const app = await buildApp({ stepDelay: 1_000, a2aApiKey: '' })
  await app.ready()

  const cardResponse = await app.inject({ method: 'GET', url: '/.well-known/agent-card.json' })
  assert.equal(cardResponse.statusCode, 200)
  const card = cardResponse.json()
  assert.equal(card.name, 'KaleidoX on PactLedger')
  assert.match(card.url, /\/a2a$/)
  assert.equal(card.security, undefined)

  const sendResponse = await app.inject({
    method: 'POST',
    url: '/a2a/tasks/send',
    payload: {
      id: 'message-1',
      message: { parts: [{ text: '研究 000001.SZ，仓位 30%，最大回撤 5%' }] },
    },
  })
  assert.equal(sendResponse.statusCode, 202)
  const submitted = sendResponse.json<{ kind: string; id: string; status: { state: string } }>()
  assert.equal(submitted.kind, 'task')
  assert.ok(submitted.id)
  assert.equal(submitted.status.state, 'submitted')

  const getResponse = await app.inject({ method: 'GET', url: `/a2a/tasks/${submitted.id}` })
  assert.equal(getResponse.statusCode, 200)
  const fetched = getResponse.json<{ kind: string; id: string }>()
  assert.equal(fetched.kind, 'task')
  assert.equal(fetched.id, submitted.id)

  const rpcResponse = await app.inject({
    method: 'POST',
    url: '/a2a',
    payload: { jsonrpc: '2.0', id: 7, method: 'tasks/get', params: { id: submitted.id } },
  })
  assert.equal(rpcResponse.statusCode, 200)
  assert.equal(rpcResponse.json().result.kind, 'task')
  assert.equal(rpcResponse.json().result.id, submitted.id)
  await app.close()
})

test('Testnet A2A execution is blocked when A2A_API_KEY is not configured', async () => {
  const injectiveConfig = readInjectiveConfig({
    INJECTIVE_EXECUTION_MODE: 'testnet',
    INJECTIVE_WALLET_ADDRESS: 'inj1abcdefghijklmnopqrstuvwxyz123456',
    INJECTIVE_PRIVATE_KEY: '1'.repeat(64),
    INJECTIVE_PAYMENT_DENOM: 'inj',
    INJECTIVE_PAYMENT_DECIMALS: '18',
    INJECTIVE_RISK_PAYEE_ADDRESS: 'inj1riskabcdefghijklmnopqrstuvwxyz12',
    INJECTIVE_EXECUTION_PAYEE_ADDRESS: 'inj1executionabcdefghijklmnopqrstu',
    INJECTIVE_POOLMATE_MERCHANT_ADDRESS: 'inj1merchantabcdefghijklmnopqrstuv',
  })
  const app = await buildApp({ stepDelay: 1_000, injectiveConfig, a2aApiKey: '' })
  await app.ready()

  const card = (await app.inject({ method: 'GET', url: '/.well-known/agent-card.json' })).json()
  assert.deepEqual(card.security, [{ bearerAuth: [] }])

  const response = await app.inject({
    method: 'POST',
    url: '/a2a/tasks/send',
    payload: { message: { parts: [{ text: '研究 000001.SZ' }] } },
  })
  assert.equal(response.statusCode, 503)
  assert.equal(response.json().error.code, 'A2A_AUTH_REQUIRED')
  await app.close()
})

test('failed execution keeps the Settlement Receipt in the task Trace', async () => {
  const failingAdapter: ExecutionAdapter = {
    mode: 'testnet',
    network: 'Injective Testnet',
    settle: async () => {
      throw new SettlementAdapterError('INJECTIVE_BROADCAST_FAILED', '测试网广播失败。', true)
    },
  }
  const app = await buildApp({ stepDelay: 5, executionAdapter: failingAdapter })
  await app.ready()
  const token = await registerAndGetToken(app)
  const createdResponse = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: auth(token),
    payload: demoTaskPayload,
  })
  let current = createdResponse.json<TaskSnapshot>()
  for (let attempt = 0; attempt < 40 && current.phase !== 'awaiting_approval'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    current = (await app.inject({
      method: 'GET',
      url: `/api/tasks/${current.id}`,
      headers: auth(token),
    })).json<TaskSnapshot>()
  }
  assert.equal(current.phase, 'awaiting_approval')
  await app.inject({ method: 'POST', url: `/api/tasks/${current.id}/approve`, headers: auth(token) })
  const failed = (await app.inject({
    method: 'POST',
    url: `/api/tasks/${current.id}/execute`,
    headers: auth(token),
  })).json<TaskSnapshot>()

  assert.equal(failed.phase, 'failed')
  const executionTrace = failed.paymentTraces.find((trace) => trace.intent.purpose === 'execution')
  assert.equal(executionTrace?.receipt?.status, 'failed')
  assert.equal(executionTrace?.receipt?.errorCode, 'INJECTIVE_BROADCAST_FAILED')
  await app.close()
})
