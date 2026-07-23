import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import type { CreateTaskInput, TaskSnapshot, TaskStreamEvent } from '../src/domain/trading.js'
import type { ExecutionAdapter } from './adapters/execution.js'
import { createExecutionAdapter } from './adapters/createExecutionAdapter.js'
import { getInjectiveConfigStatus, readInjectiveConfig, type InjectiveConfig } from './config/injective.js'
import { InvalidTaskTransitionError, MockTaskOrchestrator } from './orchestrator.js'
import { TaskRepository } from './repository.js'
import { TaskEvents } from './taskEvents.js'
import { createTaskSnapshot } from './taskDefaults.js'
import { getAccounts, getAuditLog } from './treasury.js'

interface BuildAppOptions {
  databasePath: string
  stepDelay?: number
  executionAdapter?: ExecutionAdapter
  injectiveConfig?: InjectiveConfig
  onTaskCreated?: (taskId: string) => void
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const repository = new TaskRepository(options.databasePath)
  const events = new TaskEvents()
  const injectiveConfig = options.injectiveConfig ?? readInjectiveConfig()
  const injectiveStatus = getInjectiveConfigStatus(injectiveConfig)
  const orchestrator = new MockTaskOrchestrator(
    repository,
    events,
    options.executionAdapter ?? createExecutionAdapter(injectiveConfig),
    options.stepDelay,
  )

  await app.register(cors, { origin: true })

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'kaleidox-api',
    dependencies: { injective: injectiveStatus.readyForExecution ? 'ready' : 'configuration_required' },
  }))

  app.get('/api/config/injective', async () => injectiveStatus)

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
          asset: { type: 'string', enum: ['ETH'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const id = randomUUID()
    const date = new Date().toISOString().slice(2, 10).replaceAll('-', '')
    const missionId = `KX-${date}-${id.slice(0, 4).toUpperCase()}`
    const snapshot = repository.save(createTaskSnapshot(id, missionId, request.body.objective))
    options.onTaskCreated?.(id)
    reply.code(201)
    orchestrator.start(id)
    return snapshot
  })

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const task = repository.findById(request.params.id)
    if (!task) return reply.code(404).send({ message: 'Task not found' })
    return task
  })

  app.get<{ Params: { id: string } }>('/api/tasks/:id/events', async (request, reply) => {
    const task = repository.findById(request.params.id)
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
    return getAccounts(request.params.tenantId)
  })

  app.get<{ Params: { tenantId: string } }>('/api/treasury/:tenantId/audit-log', async (request) => {
    return getAuditLog(request.params.tenantId)
  })

  app.addHook('onClose', async () => {
    orchestrator.close()
    repository.close()
  })

  return app
}

function handleTransitionError(error: unknown, reply: { code: (statusCode: number) => { send: (payload: object) => unknown } }): unknown {
  if (error instanceof InvalidTaskTransitionError) return reply.code(409).send({ message: error.message })
  if (error instanceof Error && error.message.endsWith('not found')) return reply.code(404).send({ message: error.message })
  throw error
}
