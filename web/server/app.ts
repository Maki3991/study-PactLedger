import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import type { Pool } from 'pg'
import type { CreateTaskInput, TaskSnapshot, TaskStreamEvent } from '../src/domain/trading.js'
import type { ExecutionAdapter } from './adapters/execution.js'
import { createExecutionAdapter } from './adapters/createExecutionAdapter.js'
import { getInjectiveConfigStatus, readInjectiveConfig, type InjectiveConfig } from './config/injective.js'
import type { DatabaseConfigStatus } from './config/database.js'
import { getPandaConfigStatus, readPandaDataConfig, type PandaDataConfig } from './config/panda.js'
import { getPandaModelStatus, readPandaModelConfig, type PandaModelConfig } from './config/pandaModel.js'
import { InvalidTaskTransitionError, TaskOrchestrator } from './orchestrator.js'
import { createMarketDataProvider } from './quant/marketData.js'
import { QuantResearchService } from './quant/service.js'
import { createResearchNarrator } from './quant/researchNarrator.js'
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
  databasePool?: Pool
  databaseStatus?: DatabaseConfigStatus
  stepDelay?: number
  executionAdapter?: ExecutionAdapter
  injectiveConfig?: InjectiveConfig
  onTaskCreated?: (taskId: string) => void
  pandaConfig?: PandaDataConfig
  pandaModelConfig?: PandaModelConfig
  quantResearch?: QuantResearchService
}

interface AuthBody {
  username?: string
  password?: string
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const repository = new TaskRepository(options.databasePool)
  const treasury = new TreasuryService(options.databasePool)
  const userStore = new UserStore(options.databasePool)
  await repository.initialize()
  await treasury.initialize()
  await userStore.initialize()
  const events = new TaskEvents()
  const injectiveConfig = options.injectiveConfig ?? readInjectiveConfig()
  const injectiveStatus = getInjectiveConfigStatus(injectiveConfig)
  const pandaConfig = options.pandaConfig ?? readPandaDataConfig()
  const pandaStatus = getPandaConfigStatus(pandaConfig)
  const pandaModelConfig = options.pandaModelConfig ?? readPandaModelConfig()
  const pandaModelStatus = getPandaModelStatus(pandaModelConfig)
  const quantResearch = options.quantResearch ?? new QuantResearchService(
    createMarketDataProvider(pandaConfig),
    createResearchNarrator(pandaModelConfig),
  )
  const orchestrator = new TaskOrchestrator(
    repository,
    events,
    options.executionAdapter ?? createExecutionAdapter(injectiveConfig),
    quantResearch,
    treasury,
    options.stepDelay,
  )

  await app.register(cors, { origin: true })

  const extractToken = (request: FastifyRequest): string | undefined => {
    const header = request.headers.authorization
    if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim()
    const query = request.query as { token?: string } | undefined
    return query?.token
  }

  app.addHook('onRequest', async (request, reply) => {
    const { url } = request
    if (!url.startsWith('/api/') || url.startsWith('/api/auth') || url.startsWith('/api/health')) return
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

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'kaleidox-api',
    dependencies: {
      panda: pandaStatus.provider === 'panda-data' ? 'live' : 'replay',
      pandaModel: pandaModelStatus.provider === 'ark' ? 'live' : 'template',
      injective: injectiveStatus.readyForExecution ? 'ready' : 'configuration_required',
      database: options.databaseStatus?.provider ?? (options.databasePool ? 'postgresql' : 'memory-test'),
    },
  }))

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
    const id = randomUUID()
    const date = new Date().toISOString().slice(2, 10).replaceAll('-', '')
    const missionId = `KX-${date}-${id.slice(0, 4).toUpperCase()}`
    const snapshot = await repository.save(createTaskSnapshot(id, missionId, request.body, user.id))
    await treasury.allocate(id)
    options.onTaskCreated?.(id)
    reply.code(201)
    void orchestrator.start(id, request.body)
    return snapshot
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
