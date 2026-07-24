import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import type { Pool } from 'pg'
import type { PactLedgerBaseStatus } from '../src/domain/pactledger.js'
import type { CreateTaskInput, TaskSnapshot, TaskStreamEvent } from '../src/domain/trading.js'
import { buildAgentCard, parseA2AInput, toA2ATask } from './a2a.js'
import { MockInjectiveAdapter, type SettlementAdapter } from './adapters/execution.js'
import { createSettlementAdapter } from './adapters/createExecutionAdapter.js'
import { getInjectiveConfigStatus, readInjectiveConfig, type InjectiveConfig } from './config/injective.js'
import type { DatabaseConfigStatus } from './config/database.js'
import { getPandaConfigStatus, readPandaDataConfig, type PandaDataConfig } from './config/panda.js'
import { getPandaModelStatus, readPandaModelConfig, type PandaModelConfig } from './config/pandaModel.js'
import { InvalidTaskTransitionError, TaskOrchestrator } from './orchestrator.js'
import { createAgentPaymentIntent } from './pactledger/intents.js'
import { PolicyEngine } from './pactledger/policyEngine.js'
import { PactLedgerRepository } from './pactledger/repository.js'
import { PactLedgerService } from './pactledger/service.js'
import { PoolMateRepository } from './poolmate/repository.js'
import { PoolMateService } from './poolmate/service.js'
import { PoolMateTelegramRuntime, type TelegramIdentityProbe } from './poolmate/telegram.js'
import { createMarketDataProvider } from './quant/marketData.js'
import { QuantResearchService } from './quant/service.js'
import { createResearchNarrator } from './quant/researchNarrator.js'
import { DecisionAgent } from './quant/decisionAgent.js'
import { AgentMemory } from './quant/agentMemory.js'
import { TaskRepository } from './repository.js'
import { TaskEvents } from './taskEvents.js'
import { createTaskSnapshot } from './taskDefaults.js'
import { TreasuryService } from './treasury.js'
import { AuthError, UserStore, type AuthUser } from './users.js'

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: AuthUser
  }
}

interface BuildAppOptions {
  a2aApiKey?: string
  databasePool?: Pool
  databaseStatus?: DatabaseConfigStatus
  stepDelay?: number
  executionAdapter?: SettlementAdapter
  injectiveConfig?: InjectiveConfig
  onTaskCreated?: (taskId: string) => void
  pandaConfig?: PandaDataConfig
  pandaModelConfig?: PandaModelConfig
  quantResearch?: QuantResearchService
  startTelegramBot?: boolean
  telegramBotToken?: string
  telegramProbe?: TelegramIdentityProbe
}

interface AuthBody {
  username?: string
  password?: string
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const repository = new TaskRepository(options.databasePool)
  const treasury = new TreasuryService(options.databasePool)
  const pactLedgerRepository = new PactLedgerRepository(options.databasePool)
  const poolMateRepository = new PoolMateRepository(options.databasePool)
  const userStore = new UserStore(options.databasePool)
  await repository.initialize()
  await treasury.initialize()
  await pactLedgerRepository.initialize()
  await poolMateRepository.initialize()
  await userStore.initialize()
  const events = new TaskEvents()
  const injectiveConfig = options.injectiveConfig ?? readInjectiveConfig()
  const injectiveStatus = getInjectiveConfigStatus(injectiveConfig)
  const pandaConfig = options.pandaConfig ?? readPandaDataConfig()
  const pandaStatus = getPandaConfigStatus(pandaConfig)
  const pandaModelConfig = options.pandaModelConfig ?? readPandaModelConfig()
  const pandaModelStatus = getPandaModelStatus(pandaModelConfig)
  const agentMemory = new AgentMemory(options.databasePool)
  await agentMemory.initialize()
  const researchNarrator = createResearchNarrator(pandaModelConfig)
  const decisionAgent = new DecisionAgent(researchNarrator, agentMemory)
  const quantResearch = options.quantResearch ?? new QuantResearchService(
    createMarketDataProvider(pandaConfig),
    researchNarrator,
    decisionAgent,
  )
  const pactLedger = new PactLedgerService(
    pactLedgerRepository,
    new PolicyEngine(),
    options.executionAdapter ?? createSettlementAdapter(injectiveConfig),
  )
  const poolMateDemoLedger = new PactLedgerService(
    pactLedgerRepository,
    new PolicyEngine(),
    new MockInjectiveAdapter(),
  )
  const poolMateService = new PoolMateService(poolMateRepository, poolMateDemoLedger)
  const poolMateBot = new PoolMateTelegramRuntime(
    options.telegramBotToken?.trim() || undefined,
    poolMateService,
    options.telegramProbe,
  )
  const orchestrator = new TaskOrchestrator(
    repository,
    events,
    pactLedger,
    quantResearch,
    treasury,
    options.stepDelay,
  )
  const a2aApiKey = options.a2aApiKey !== undefined
    ? options.a2aApiKey.trim() || undefined
    : process.env.A2A_API_KEY?.trim()

  await app.register(cors, { origin: true })

  if (options.startTelegramBot) {
    app.addHook('onReady', async () => {
      await poolMateBot.start()
    })
  }

  const extractToken = (request: FastifyRequest): string | undefined => {
    const header = request.headers.authorization
    if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim()
    const query = request.query as { token?: string } | undefined
    return query?.token
  }

  app.addHook('onRequest', async (request, reply) => {
    const { url } = request
    if (
      !url.startsWith('/api/')
      || url.startsWith('/api/auth')
      || url.startsWith('/api/health')
      || url.startsWith('/api/public/')
      || url.startsWith('/api/demo/')
    ) return
    const token = extractToken(request)
    const user = token ? await userStore.findByToken(token) : undefined
    if (!user) {
      await reply.code(401).send({ error: '未登录或会话已过期' })
      return
    }
    request.currentUser = user
  })

  const requireUser = (request: FastifyRequest): AuthUser => {
    const user = request.currentUser
    if (!user) throw new AuthError(401, '未登录或会话已过期')
    return user
  }

  const findAccessibleTask = async (id: string, user: AuthUser): Promise<TaskSnapshot | undefined> => {
    const task = await repository.findById(id)
    if (!task) return undefined
    if (task.ownerId && task.ownerId !== user.id) return undefined
    return task
  }

  const authorizeA2A = async (request: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (!a2aApiKey && injectiveConfig.mode === 'mock') return true
    if (!a2aApiKey) {
      await reply.code(503).send({
        error: { code: 'A2A_AUTH_REQUIRED', message: 'Testnet 模式必须配置 A2A_API_KEY 才能接收外部任务。' },
      })
      return false
    }
    if (extractToken(request) !== a2aApiKey) {
      await reply.code(401).send({
        error: { code: 'A2A_UNAUTHORIZED', message: 'A2A API Key 缺失或无效。' },
      })
      return false
    }
    return true
  }

  const createAndStartTask = async (input: CreateTaskInput, ownerId?: string): Promise<TaskSnapshot> => {
    const id = randomUUID()
    const date = new Date().toISOString().slice(2, 10).replaceAll('-', '')
    const missionId = `KX-${date}-${id.slice(0, 4).toUpperCase()}`
    const snapshot = await repository.save(createTaskSnapshot(id, missionId, input, ownerId))
    await treasury.allocate(id)
    options.onTaskCreated?.(id)
    void orchestrator.start(id, input)
    return snapshot
  }

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'pactledger-api',
    dependencies: {
      panda: pandaStatus.provider === 'panda-data' ? 'configured' : 'replay',
      pandaModel: pandaModelStatus.provider === 'template' ? 'template' : pandaModelStatus.endpointId,
      injective: injectiveStatus.executionState,
      database: options.databaseStatus?.provider ?? (options.databasePool ? 'postgresql' : 'memory-test'),
      poolmateBot: poolMateBot.getStatus().running ? 'running' : poolMateBot.getStatus().configured ? 'configured' : 'disabled',
    },
  }))

  app.get('/api/public/poolmate/bot-status', async () => poolMateBot.refreshStatus())

  app.get('/api/public/base-status', async (): Promise<PactLedgerBaseStatus> => {
    const latestReceipt = await pactLedgerRepository.findLatestConfirmedTestnetReceipt()
    const persistedReceipt = pactLedgerRepository.hasPersistentStorage ? latestReceipt : undefined
    const state = injectiveConfig.mode === 'mock'
      ? 'mock_ready'
      : persistedReceipt
        ? 'testnet_confirmed'
        : injectiveStatus.readyForExecution ? 'testnet_ready' : 'testnet_configuration_required'
    return {
      product: 'PactLedger',
      category: 'Agent Treasury / Agent Spend Control',
      flow: ['Agent Intent', 'PactLedger Policy', 'Injective Settlement', 'Verifiable Receipt'],
      execution: {
        mode: injectiveConfig.mode,
        state,
        network: injectiveConfig.mode === 'mock' ? 'Mock' : 'Injective Testnet',
        chainId: injectiveConfig.chainId,
        adapter: injectiveStatus.adapter,
        walletConfigured: injectiveStatus.credentialsConfigured,
        paymentAssetConfigured: injectiveStatus.paymentAssetConfigured,
        payeesConfigured: injectiveStatus.payeesConfigured,
        receiptPersistence: pactLedgerRepository.hasPersistentStorage ? 'postgresql' : 'memory',
        latestConfirmedReceipt: persistedReceipt ? {
          intentId: persistedReceipt.intentId,
          transactionHash: persistedReceipt.transactionHash,
          explorerUrl: persistedReceipt.explorerUrl,
          blockHeight: persistedReceipt.blockHeight,
          confirmedAt: persistedReceipt.confirmedAt,
        } : undefined,
      },
      proofCases: [
        { appId: 'kaleidox', role: 'risk-pressure-test', endpoint: '/kaleidox.html' },
        { appId: 'poolmate', role: 'cross-domain-reuse', endpoint: '/api/demo/poolmate/checkout' },
      ],
    }
  })

  app.get('/.well-known/agent-card.json', async (request) => {
    const configuredBase = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '')
    const host = request.headers.host ?? '127.0.0.1:8787'
    return buildAgentCard(
      configuredBase ?? `${request.protocol}://${host}`,
      Boolean(a2aApiKey) || injectiveConfig.mode === 'testnet',
    )
  })

  app.post<{ Body: { id?: string; message?: { parts?: Array<{ text?: string }> } } }>('/a2a/tasks/send', async (request, reply) => {
    if (!await authorizeA2A(request, reply)) return
    const text = request.body?.message?.parts?.find((part) => part.text)?.text ?? ''
    const snapshot = await createAndStartTask(parseA2AInput(text))
    return reply.code(202).send(toA2ATask(snapshot))
  })

  app.get<{ Params: { id: string } }>('/a2a/tasks/:id', async (request, reply) => {
    if (!await authorizeA2A(request, reply)) return
    const snapshot = await repository.findById(request.params.id)
    if (!snapshot) return reply.code(404).send({ error: { code: -32001, message: 'Task not found' } })
    return toA2ATask(snapshot)
  })

  app.post<{ Body: { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> } }>('/a2a', async (request, reply) => {
    if (!await authorizeA2A(request, reply)) return
    const rpcId = request.body?.id ?? null
    const method = request.body?.method
    const params = request.body?.params ?? {}
    if (method === 'message/send') {
      const message = params.message as { parts?: Array<{ text?: string }> } | undefined
      const text = message?.parts?.find((part) => part.text)?.text ?? ''
      const snapshot = await createAndStartTask(parseA2AInput(text))
      return { jsonrpc: '2.0', id: rpcId, result: toA2ATask(snapshot) }
    }
    if (method === 'tasks/get') {
      const taskId = String(params.id ?? '')
      const snapshot = await repository.findById(taskId)
      if (!snapshot) {
        return reply.code(404).send({ jsonrpc: '2.0', id: rpcId, error: { code: -32001, message: 'Task not found' } })
      }
      return { jsonrpc: '2.0', id: rpcId, result: toA2ATask(snapshot) }
    }
    return reply.code(400).send({ jsonrpc: '2.0', id: rpcId, error: { code: -32601, message: 'Method not found' } })
  })

  app.post<{ Body: AuthBody }>('/api/auth/register', async (request, reply) => {
    try {
      const session = await userStore.register(String(request.body?.username ?? ''), String(request.body?.password ?? ''))
      return await reply.code(201).send(session)
    } catch (error) {
      return sendAuthError(reply, error)
    }
  })

  app.post<{ Body: AuthBody }>('/api/auth/login', async (request, reply) => {
    try {
      return await reply.send(await userStore.login(String(request.body?.username ?? ''), String(request.body?.password ?? '')))
    } catch (error) {
      return sendAuthError(reply, error)
    }
  })

  app.get('/api/auth/me', async (request, reply) => {
    const token = extractToken(request)
    const user = token ? await userStore.findByToken(token) : undefined
    if (!user) return reply.code(401).send({ error: '未登录或会话已过期' })
    return { user }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    const token = extractToken(request)
    if (token) await userStore.logout(token)
    return await reply.code(204).send()
  })

  app.get('/api/config/injective', async () => injectiveStatus)
  app.get('/api/config/panda', async () => pandaStatus)
  app.get('/api/config/panda/model', async () => pandaModelStatus)

  // ── Agent Knowledge Base ──
  app.get<{ Querystring: { symbol?: string; limit?: string } }>('/api/public/knowledge-base', async (request) => {
    const symbol = request.query.symbol
    const limit = Math.min(Number(request.query.limit || 20), 50)
    if (symbol) {
      const records = await agentMemory.findBySymbol(symbol)
      return { records: records.slice(0, limit), total: records.length }
    }
    // 无 symbol 时返回统计摘要
    const count = await agentMemory.count()
    const recentContext = await agentMemory.getRecentContext(90)
    return { totalRecords: count, recentContext, hint: '使用 ?symbol=000001.SZ 查询特定股票的决策记录' }
  })

  app.post<{ Body: { scenario?: 'approved' | 'blocked'; intentId?: string } }>('/api/demo/poolmate/checkout', async (request, reply) => {
    const scenario = request.body?.scenario
    if (scenario !== 'approved' && scenario !== 'blocked') {
      return reply.code(400).send({
        error: { code: 'INVALID_DEMO_SCENARIO', message: 'scenario 必须是 approved 或 blocked。' },
      })
    }
    const intentId = request.body?.intentId?.trim()
    if (intentId && !/^PM-[A-Z0-9-]{4,48}$/.test(intentId)) {
      return reply.code(400).send({
        error: { code: 'INVALID_INTENT_ID', message: 'intentId 必须使用 PM- 前缀与大写字母、数字或连字符。' },
      })
    }
    const blocked = scenario === 'blocked'
    return poolMateDemoLedger.process(createAgentPaymentIntent({
      tenantId: `poolmate-demo-${new Date().toISOString().slice(0, 10)}`,
      appId: 'poolmate',
      payerAgentId: 'poolmate-treasury',
      payeeId: blocked ? 'random-group-member' : 'merchant-demo',
      amount: blocked ? 89 : 267,
      currency: 'CNY-DEMO',
      purpose: 'merchant_pay',
      protocol: 'ap2',
      intentId,
      metadata: {
        groupId: 'dongkui-yangmei-demo',
        shares: blocked ? 1 : 3,
        demoOnly: true,
        settlementMode: 'mock',
      },
    }))
  })

  app.post<{ Body: CreateTaskInput }>('/api/tasks', {
    schema: {
      body: {
        type: 'object',
        required: ['objective', 'budgetUsdt', 'maxLossPct', 'maxAssetPct', 'asset'],
        properties: {
          objective: { type: 'string', minLength: 8 },
          budgetUsdt: { type: 'number', minimum: 1 },
          maxLossPct: { type: 'number', minimum: 0.1, maximum: 100 },
          maxAssetPct: { type: 'number', minimum: 1, maximum: 100 },
          asset: { type: 'string', minLength: 6, maxLength: 16 },
          startDate: { type: 'string', pattern: '^\\d{8}$' },
          endDate: { type: 'string', pattern: '^\\d{8}$' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const user = requireUser(request)
    reply.code(201)
    return createAndStartTask(request.body, user.id)
  })

  app.post<{ Body: CreateTaskInput }>('/api/quant/analyze', async (request, reply) => {
    try {
      return await quantResearch.analyze(request.body)
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'Quant analysis failed' })
    }
  })

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const task = await findAccessibleTask(request.params.id, requireUser(request))
    if (!task) return reply.code(404).send({ message: 'Task not found' })
    return task
  })

  app.get<{ Params: { id: string } }>('/api/tasks/:id/events', async (request, reply) => {
    const task = await findAccessibleTask(request.params.id, requireUser(request))
    if (!task) return reply.code(404).send({ message: 'Task not found' })

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const send = (snapshot: TaskSnapshot) => {
      const event: TaskStreamEvent = { type: 'task.snapshot', snapshot }
      reply.raw.write(`event: task.snapshot\ndata: ${JSON.stringify(event)}\n\n`)
    }

    send(task)
    const unsubscribe = events.subscribe(task.id, send)
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000)
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })

  app.post<{ Params: { id: string } }>('/api/tasks/:id/approve', async (request, reply) => {
    if (!await findAccessibleTask(request.params.id, requireUser(request))) {
      return reply.code(404).send({ message: 'Task not found' })
    }
    try {
      return await orchestrator.approve(request.params.id)
    } catch (error) {
      return handleTransitionError(error, reply)
    }
  })

  app.post<{ Params: { id: string } }>('/api/tasks/:id/execute', async (request, reply) => {
    if (!await findAccessibleTask(request.params.id, requireUser(request))) {
      return reply.code(404).send({ message: 'Task not found' })
    }
    if (!injectiveStatus.readyForExecution) {
      return reply.code(503).send({
        message: 'Injective execution is not ready. Complete server-side testnet configuration or use mock mode.',
        missing: injectiveStatus.missing,
      })
    }
    try {
      return await orchestrator.execute(request.params.id)
    } catch (error) {
      return handleTransitionError(error, reply)
    }
  })

  app.get<{ Params: { tenantId: string } }>('/api/treasury/:tenantId/accounts', async (request, reply) => {
    if (!await findAccessibleTask(request.params.tenantId, requireUser(request))) {
      return reply.code(404).send({ message: 'Task not found' })
    }
    return treasury.getAccounts(request.params.tenantId)
  })

  app.get<{ Params: { tenantId: string } }>('/api/treasury/:tenantId/audit-log', async (request, reply) => {
    if (!await findAccessibleTask(request.params.tenantId, requireUser(request))) {
      return reply.code(404).send({ message: 'Task not found' })
    }
    return treasury.getAuditLog(request.params.tenantId)
  })

  app.addHook('onClose', async () => {
    await poolMateBot.stop()
    orchestrator.close()
    await options.databasePool?.end()
  })

  return app
}

function sendAuthError(reply: FastifyReply, error: unknown): unknown {
  if (error instanceof AuthError) return reply.code(error.statusCode).send({ error: error.message })
  throw error
}

function handleTransitionError(error: unknown, reply: { code: (statusCode: number) => { send: (payload: object) => unknown } }): unknown {
  if (error instanceof InvalidTaskTransitionError) return reply.code(409).send({ message: error.message })
  if (error instanceof Error && error.message.endsWith('not found')) return reply.code(404).send({ message: error.message })
  throw error
}
