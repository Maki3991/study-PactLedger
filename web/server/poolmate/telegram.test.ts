import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PoolMateTelegramRuntime } from './telegram.js'
import type { PoolMateService } from './service.js'

type ApiCall = { method: string; body: unknown }

/**
 * grammy 在 import 时固定内部 fetch 引用，改 globalThis.fetch 无效，
 * 必须通过 BotConfig.client.fetch 注入。
 */
function stubTelegramApi(options: { failing?: string[] } = {}) {
  const calls: ApiCall[] = []
  const failing = new Set(options.failing ?? [])

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const method = url.split('/').pop() ?? ''
    calls.push({
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })

    if (failing.has(method)) {
      return new Response(
        JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests' }),
        { status: 429, headers: { 'content-type': 'application/json' } },
      )
    }

    const result = method === 'getMe'
      ? { id: 1, is_bot: true, first_name: 'PoolMate', username: 'poolmate_bot' }
      : method === 'getUpdates'
        ? []
        : true
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  return { calls, fetch: fetch as never }
}

const service = {} as PoolMateService
const probe = async () => ({ username: 'poolmate_bot', firstName: 'PoolMate' })

test('start 会在 Telegram 注册命令菜单', async () => {
  const { calls, fetch } = stubTelegramApi()
  const runtime = new PoolMateTelegramRuntime('test-token', service, probe, { fetch })

  await runtime.start()
  await runtime.stop()

  const registration = calls.find((call) => call.method === 'setMyCommands')
  assert.ok(registration, 'setMyCommands 未被调用')

  const commands = (registration.body as { commands: { command: string }[] }).commands
  const names = commands.map((entry) => entry.command)
  for (const expected of ['help', 'status', 'pool_new', 'pool_claim', 'pool_leave', 'pool_status']) {
    assert.ok(names.includes(expected), `命令菜单缺少 ${expected}`)
  }
})

test('命令菜单在轮询开始前注册', async () => {
  const { calls, fetch } = stubTelegramApi()
  const runtime = new PoolMateTelegramRuntime('test-token', service, probe, { fetch })

  await runtime.start()
  await runtime.stop()

  const registrationIndex = calls.findIndex((call) => call.method === 'setMyCommands')
  const firstPollIndex = calls.findIndex((call) => call.method === 'getUpdates')
  assert.ok(registrationIndex >= 0, 'setMyCommands 未被调用')
  if (firstPollIndex >= 0) {
    assert.ok(registrationIndex < firstPollIndex, 'setMyCommands 应在 getUpdates 之前')
  }
})

test('命令菜单注册失败不阻断 Bot 启动', async () => {
  const { fetch } = stubTelegramApi({ failing: ['setMyCommands'] })
  const runtime = new PoolMateTelegramRuntime('test-token', service, probe, { fetch })

  await runtime.start()
  const status = runtime.getStatus()
  await runtime.stop()

  assert.equal(status.running, true, 'setMyCommands 失败后 Bot 应仍在运行')
})

test('Telegram 身份探针瞬时失败后会重试并启动 Bot', async () => {
  const { fetch } = stubTelegramApi()
  let attempts = 0
  const flakyProbe = async () => {
    attempts += 1
    if (attempts === 1) throw new Error('temporary network failure')
    return { username: 'poolmate_bot', firstName: 'PoolMate' }
  }
  const runtime = new PoolMateTelegramRuntime('test-token', service, flakyProbe, { fetch })

  await runtime.start()
  const status = runtime.getStatus()
  await runtime.stop()

  assert.equal(attempts, 2)
  assert.equal(status.running, true)
})

test('未配置 token 时不发起任何 Telegram 请求', async () => {
  const { calls, fetch } = stubTelegramApi()
  const runtime = new PoolMateTelegramRuntime(undefined, service, probe, { fetch })

  await runtime.start()

  assert.equal(calls.length, 0)
  assert.equal(runtime.getStatus().reasonCode, 'BOT_NOT_CONFIGURED')
})
