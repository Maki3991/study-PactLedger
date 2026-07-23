import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
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

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const repository = new TaskRepository(options.databasePool)
  const treasury = new TreasuryService(options.databasePool)
  await repository.initialize()
  await treasury.initialize()
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
    const id = randomUUID()
    const date = new Date().toISOString().slice(2, 10).replaceAll('-', '')
    const missionId = `KX-${date}-${id.slice(0, 4).toUpperCase()}`
    const snapshot = await repository.save(createTaskSnapshot(id, missionId, request.body))
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
    const task = await repository.findById(request.params.id)
    if (!task) return reply.code(404).send({ message: 'Task not found' })
    return task
  })

  app.get<{ Params: { id: string } }>('/api/tasks/:id/events', async (request, reply) => {
    const task = await repository.findById(request.params.id)
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
    try {
      return orchestrator.approve(request.params.id)
    } catch (error) {
      return handleTransitionError(error, reply)
    }
  })

  app.post<{ Params: { id: string } }>('/api/tasks/:id/execute', async (request, reply) => {
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

  app.get<{ Params: { tenantId: string } }>('/api/treasury/:tenantId/accounts', async (request) => {
    return treasury.getAccounts(request.params.tenantId)
  })

  app.get<{ Params: { tenantId: string } }>('/api/treasury/:tenantId/audit-log', async (request) => {
    return treasury.getAuditLog(request.params.tenantId)
  })

  app.addHook('onClose', async () => {
    orchestrator.close()
    await options.databasePool?.end()
  })

  return app
}

function handleTransitionError(error: unknown, reply: { code: (statusCode: number) => { send: (payload: object) => unknown } }): unknown {
  if (error instanceof InvalidTaskTransitionError) return reply.code(409).send({ message: error.message })
  if (error instanceof Error && error.message.endsWith('not found')) return reply.code(404).send({ message: error.message })
  throw error
}
