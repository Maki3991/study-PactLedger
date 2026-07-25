import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { InjectiveConfigStatus, TaskSnapshot } from '../../src/domain/trading.js'
import type { TreasuryTx } from '../treasury.js'
import { KaleidoxTelegramRuntime, type KaleidoxBotDependencies } from './telegram.js'

type ApiCall = { method: string; body: Record<string, unknown> }

const OPERATOR_TELEGRAM_ID = 123456789
const OPERATOR_USER_ID = 'owner1'
const OPERATORS = `${OPERATOR_TELEGRAM_ID}:${OPERATOR_USER_ID}`

function task(overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    id: 'task-1',
    missionId: 'KX-260725-AB12',
    ownerId: OPERATOR_USER_ID,
    objective: '评估财报后的动量策略',
    phase: 'awaiting_approval',
    agents: [],
    candidates: [],
    firewallRules: [],
    timeline: [],
    paymentTraces: [],
    execution: { state: 'ready', network: 'Mock' },
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    ...overrides,
  }
}

const injectiveStatus = {
  mode: 'mock',
  network: 'testnet',
  chainId: 'injective-888',
  adapter: 'mock',
  executionState: 'mock_ready',
  readyForExecution: true,
  missing: [],
} as unknown as InjectiveConfigStatus

function stubDependencies(
  overrides: Partial<KaleidoxBotDependencies> = {},
): { deps: KaleidoxBotDependencies; approved: string[]; created: unknown[] } {
  const approved: string[] = []
  const created: unknown[] = []
  const deps: KaleidoxBotDependencies = {
    createTask: async (input) => {
      created.push(input)
      return task({ phase: 'created' })
    },
    findTask: async (id) => (id === 'task-1' ? task() : undefined),
    findTasksByUser: async () => [task()],
    approveTask: async (id) => {
      approved.push(id)
      return task({ phase: 'approved' })
    },
    executeTask: async () => task({ phase: 'executed' }),
    getAuditLog: async (): Promise<TreasuryTx[]> => [],
    subscribeTask: () => () => undefined,
    getInjectiveStatus: () => injectiveStatus,
    ...overrides,
  }
  return { deps, approved, created }
}

interface HarnessOptions {
  text: string
  fromId?: number
  chatType?: 'private' | 'group'
}

/**
 * 通过注入的 fetch 投递一条 update：grammy 不读 globalThis.fetch，
 * 只认 BotConfig.client.fetch。首次 getUpdates 返回消息，之后返回空。
 */
function stubTelegramApi(update?: HarnessOptions) {
  const calls: ApiCall[] = []
  let delivered = false

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const method = url.split('/').pop() ?? ''
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    calls.push({ method, body })

    let result: unknown = true
    if (method === 'getMe') {
      result = { id: 1, is_bot: true, first_name: 'KaleidoX', username: 'kaleidox_bot' }
    } else if (method === 'getUpdates') {
      if (update && !delivered) {
        delivered = true
        const fromId = update.fromId ?? OPERATOR_TELEGRAM_ID
        result = [{
          update_id: 1,
          message: {
            message_id: 1,
            date: Math.floor(Date.now() / 1000),
            chat: { id: fromId, type: update.chatType ?? 'private' },
            from: { id: fromId, is_bot: false, first_name: 'Op' },
            text: update.text,
            entities: [{ type: 'bot_command', offset: 0, length: update.text.split(' ')[0].length }],
          },
        }]
      } else {
        await idlePoll(init?.signal)
        result = []
      }
    } else if (method === 'sendMessage') {
      result = { message_id: 2, date: 0, chat: {}, text: '' }
    }

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  return { calls, fetch: fetch as never }
}

/**
 * 模拟 long-polling 的等待。若立即返回空数组，grammy 的轮询循环会变成忙等，
 * 每秒发出海量 getUpdates 直到测试超时。同时响应 abort 让 bot.stop() 尽快返回。
 */
function idlePoll(signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(finish, 40)
    function finish(): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })
  })
}

/** 等待条件成立，避免依赖固定 sleep 时长。 */
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return predicate()
}

function replies(calls: ApiCall[]): string[] {
  return calls
    .filter((call) => call.method === 'sendMessage')
    .map((call) => String(call.body.text ?? ''))
}

test('未配置 operators 时拒绝启动', async () => {
  const { calls, fetch } = stubTelegramApi()
  const { deps } = stubDependencies()
  const runtime = new KaleidoxTelegramRuntime('token', deps, { operators: '', fetch })

  await runtime.start()

  const status = runtime.getStatus()
  assert.equal(status.running, false)
  assert.equal(status.reasonCode, 'NO_OPERATORS')
  assert.equal(calls.length, 0, '未启动时不应发起任何 Telegram 请求')
})

test('未配置 token 时不发起任何请求', async () => {
  const { calls, fetch } = stubTelegramApi()
  const { deps } = stubDependencies()
  const runtime = new KaleidoxTelegramRuntime(undefined, deps, { operators: OPERATORS, fetch })

  await runtime.start()

  assert.equal(calls.length, 0)
  assert.equal(runtime.getStatus().reasonCode, 'BOT_NOT_CONFIGURED')
})

test('启动时注册命令菜单', async () => {
  const { calls, fetch } = stubTelegramApi()
  const { deps } = stubDependencies()
  const runtime = new KaleidoxTelegramRuntime('token', deps, { operators: OPERATORS, fetch })

  await runtime.start()
  await runtime.stop()

  const registration = calls.find((call) => call.method === 'setMyCommands')
  assert.ok(registration, 'setMyCommands 未被调用')
  const names = (registration.body.commands as { command: string }[]).map((entry) => entry.command)
  for (const expected of ['research', 'tasks', 'approve', 'execute', 'history']) {
    assert.ok(names.includes(expected), `命令菜单缺少 ${expected}`)
  }
})

test('名单外用户不会收到任何回复', async () => {
  const { calls, fetch } = stubTelegramApi({ text: '/tasks', fromId: 999999 })
  const { deps } = stubDependencies()
  const runtime = new KaleidoxTelegramRuntime('token', deps, { operators: OPERATORS, fetch })

  await runtime.start()
  await waitFor(() => calls.some((call) => call.method === 'getUpdates'))
  await new Promise((resolve) => setTimeout(resolve, 150))
  await runtime.stop()

  assert.deepEqual(replies(calls), [], '未授权用户应被静默丢弃')
})

test('授权用户可以查询任务列表', async () => {
  const { calls, fetch } = stubTelegramApi({ text: '/tasks' })
  const { deps } = stubDependencies()
  const runtime = new KaleidoxTelegramRuntime('token', deps, { operators: OPERATORS, fetch })

  await runtime.start()
  const answered = await waitFor(() => replies(calls).length > 0)
  await runtime.stop()

  assert.ok(answered, '授权用户未收到回复')
  assert.match(replies(calls)[0], /KX-260725-AB12/)
})

test('群聊中拒绝批准支付', async () => {
  const { calls, fetch } = stubTelegramApi({ text: '/approve task-1', chatType: 'group' })
  const { deps, approved } = stubDependencies()
  const runtime = new KaleidoxTelegramRuntime('token', deps, { operators: OPERATORS, fetch })

  await runtime.start()
  const answered = await waitFor(() => replies(calls).length > 0)
  await runtime.stop()

  assert.ok(answered)
  assert.match(replies(calls)[0], /只能在与 Bot 的私聊中使用/)
  assert.deepEqual(approved, [], '群聊不应触发批准')
})

test('私聊可以批准处于 awaiting_approval 的任务', async () => {
  const { calls, fetch } = stubTelegramApi({ text: '/approve task-1' })
  const { deps, approved } = stubDependencies()
  const runtime = new KaleidoxTelegramRuntime('token', deps, { operators: OPERATORS, fetch })

  await runtime.start()
  await waitFor(() => approved.length > 0)
  await runtime.stop()

  assert.deepEqual(approved, ['task-1'])
})

test('不批准非 awaiting_approval 阶段的任务', async () => {
  const { calls, fetch } = stubTelegramApi({ text: '/approve task-1' })
  const { deps, approved } = stubDependencies({
    findTask: async () => task({ phase: 'executing' }),
  })
  const runtime = new KaleidoxTelegramRuntime('token', deps, { operators: OPERATORS, fetch })

  await runtime.start()
  const answered = await waitFor(() => replies(calls).length > 0)
  await runtime.stop()

  assert.ok(answered)
  assert.match(replies(calls)[0], /无法批准/)
  assert.deepEqual(approved, [])
})

test('拒绝操作他人的任务', async () => {
  const { calls, fetch } = stubTelegramApi({ text: '/approve task-1' })
  const { deps, approved } = stubDependencies({
    findTask: async () => task({ ownerId: 'someone-else' }),
    findTasksByUser: async () => [],
  })
  const runtime = new KaleidoxTelegramRuntime('token', deps, { operators: OPERATORS, fetch })

  await runtime.start()
  const answered = await waitFor(() => replies(calls).length > 0)
  await runtime.stop()

  assert.ok(answered)
  assert.match(replies(calls)[0], /未找到该任务/)
  assert.deepEqual(approved, [], '不应批准他人任务')
})

test('执行未就绪时拒绝 execute', async () => {
  const { calls, fetch } = stubTelegramApi({ text: '/execute task-1' })
  const { deps } = stubDependencies({
    getInjectiveStatus: () => ({
      ...injectiveStatus,
      readyForExecution: false,
      missing: ['INJECTIVE_PRIVATE_KEY'],
    }),
    executeTask: async () => {
      throw new Error('executeTask 不应被调用')
    },
  })
  const runtime = new KaleidoxTelegramRuntime('token', deps, { operators: OPERATORS, fetch })

  await runtime.start()
  const answered = await waitFor(() => replies(calls).length > 0)
  await runtime.stop()

  assert.ok(answered)
  assert.match(replies(calls)[0], /INJECTIVE_PRIVATE_KEY/)
})

test('research 参数非法时回用法且不建任务', async () => {
  const { calls, fetch } = stubTelegramApi({ text: '/research 短' })
  const { deps, created } = stubDependencies()
  const runtime = new KaleidoxTelegramRuntime('token', deps, { operators: OPERATORS, fetch })

  await runtime.start()
  const answered = await waitFor(() => replies(calls).length > 0)
  await runtime.stop()

  assert.ok(answered)
  assert.match(replies(calls)[0], /用法/)
  assert.deepEqual(created, [])
})

test('research 合法时以操作员身份建任务', async () => {
  const { fetch } = stubTelegramApi({ text: '/research NVDA.US 5000 15 30 评估财报后的动量策略' })
  const owners: (string | undefined)[] = []
  const { deps } = stubDependencies({
    createTask: async (input, ownerId) => {
      owners.push(ownerId)
      return task({ phase: 'created', objective: input.objective })
    },
  })
  const runtime = new KaleidoxTelegramRuntime('token', deps, { operators: OPERATORS, fetch })

  await runtime.start()
  await waitFor(() => owners.length > 0)
  await runtime.stop()

  assert.deepEqual(owners, [OPERATOR_USER_ID], '任务必须归属于映射到的 KaleidoX 账号')
})
