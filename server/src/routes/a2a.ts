/**
 * A2A task protocol endpoints
 * Implements core A2A spec: tasks/send + tasks/sendSubscribe + tasks/{id}
 */
import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { pool } from '../db/pool'
import { insertTask, getTaskSnapshot } from '../db/queries'
import { addSubscriber, removeSubscriber, runSimulation } from '../simulation'
import type { CreateTaskInput } from '../types'

export const a2aRouter = Router()

type A2ATaskState = 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled'

function phaseToA2AState(phase: string): A2ATaskState {
  if (phase === 'executed') return 'completed'
  if (phase === 'failed') return 'failed'
  if (phase === 'awaiting_approval') return 'input-required'
  if (phase === 'created') return 'submitted'
  return 'working'
}

function makeA2ATask(snapshot: Awaited<ReturnType<typeof getTaskSnapshot>>) {
  if (!snapshot) return null
  return {
    id: snapshot.id,
    sessionId: snapshot.missionId,
    status: {
      state: phaseToA2AState(snapshot.phase),
      message: snapshot.timeline.at(-1)
        ? { role: 'agent', parts: [{ type: 'text', text: snapshot.timeline.at(-1)!.title }] }
        : undefined,
      timestamp: snapshot.updatedAt,
    },
    artifacts: snapshot.phase === 'executed' ? [
      {
        name: 'execution-result',
        parts: [{
          type: 'text',
          text: JSON.stringify({
            strategy: 'V2-B',
            positionPct: 25,
            network: 'Injective Testnet',
            transactionHash: snapshot.execution.transactionHash,
            candidates: snapshot.candidates,
            firewallRules: snapshot.firewallRules,
          }, null, 2),
        }],
      },
    ] : [],
    history: snapshot.timeline.map((e) => ({
      role: 'agent',
      parts: [{ type: 'text', text: `[${e.time}] ${e.title}: ${e.detail}` }],
    })),
    metadata: {
      phase: snapshot.phase,
      missionId: snapshot.missionId,
      agents: snapshot.agents,
    },
  }
}

function parseUserMessage(text: string): CreateTaskInput {
  // Try to extract numbers from natural language
  const budgetMatch = text.match(/(\d[\d,]*)\s*(USDT|usdt|美元)?/)
  const lossMatch = text.match(/(\d+(?:\.\d+)?)\s*%.*?(亏损|loss|drawdown)/i) ||
                    text.match(/(亏损|loss).*?(\d+(?:\.\d+)?)\s*%/i)
  const posMatch = text.match(/(\d+(?:\.\d+)?)\s*%.*?(仓位|position)/i) ||
                   text.match(/(仓位|position).*?(\d+(?:\.\d+)?)\s*%/i)

  return {
    objective: text,
    budgetUsdt: budgetMatch ? parseFloat(budgetMatch[1].replace(',', '')) : 1000,
    maxLossPct: lossMatch ? parseFloat(lossMatch[1] || lossMatch[2]) : 5,
    maxAssetPct: posMatch ? parseFloat(posMatch[1] || posMatch[2]) : 30,
    asset: 'ETH',
  }
}

// POST /a2a/tasks/send  (fire-and-forget, returns when task reaches terminal state)
a2aRouter.post('/tasks/send', async (req, res) => {
  const body = req.body as { id?: string; message?: { parts?: Array<{ text?: string }> } }
  const userText = body.message?.parts?.find((p) => p.text)?.text ?? ''
  const input = parseUserMessage(userText)

  const taskId = body.id ?? uuidv4()
  const missionId = `KX-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-A2A`
  const client = await pool.connect()
  try {
    await insertTask(client, taskId, missionId, input.objective, input.budgetUsdt, input.maxLossPct, input.maxAssetPct, input.asset)
  } finally { client.release() }

  void runSimulation(taskId)

  // Poll until terminal state (max 20 min per PandaAI spec)
  const deadline = Date.now() + 20 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    const snap = await getTaskSnapshot(taskId)
    if (!snap) break
    const state = phaseToA2AState(snap.phase)
    if (state === 'completed' || state === 'failed' || state === 'input-required') {
      res.json(makeA2ATask(snap))
      return
    }
  }
  const snap = await getTaskSnapshot(taskId)
  res.json(makeA2ATask(snap))
})

// POST /a2a/tasks/sendSubscribe  (SSE streaming)
a2aRouter.post('/tasks/sendSubscribe', async (req, res) => {
  const body = req.body as { id?: string; message?: { parts?: Array<{ text?: string }> } }
  const userText = body.message?.parts?.find((p) => p.text)?.text ?? ''
  const input = parseUserMessage(userText)

  const taskId = body.id ?? uuidv4()
  const missionId = `KX-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-A2A`
  const client = await pool.connect()
  try {
    await insertTask(client, taskId, missionId, input.objective, input.budgetUsdt, input.maxLossPct, input.maxAssetPct, input.asset)
  } finally { client.release() }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const sendEvent = async () => {
    const snap = await getTaskSnapshot(taskId)
    if (!snap) return
    const a2aTask = makeA2ATask(snap)
    res.write(`event: task\ndata: ${JSON.stringify(a2aTask)}\n\n`)
    return snap.phase
  }

  // Forward task.snapshot events as A2A events
  const wrappedRes = {
    write: async (chunk: string) => {
      // parse SSE line and re-emit as A2A task event
      if (chunk.startsWith('event: task.snapshot')) {
        await sendEvent()
      }
    },
  } as unknown as import('express').Response

  addSubscriber(taskId, wrappedRes)
  req.on('close', () => removeSubscriber(taskId, wrappedRes))

  void runSimulation(taskId)

  // send initial state
  await sendEvent()
})

// GET /a2a/tasks/:id
a2aRouter.get('/tasks/:id', async (req, res) => {
  const snap = await getTaskSnapshot(req.params.id)
  if (!snap) { res.status(404).json({ error: { code: -32001, message: 'Task not found' } }); return }
  res.json(makeA2ATask(snap))
})

// POST /a2a/tasks/:id/cancel
a2aRouter.post('/tasks/:id/cancel', async (req, res) => {
  const snap = await getTaskSnapshot(req.params.id)
  if (!snap) { res.status(404).json({ error: { code: -32001, message: 'Task not found' } }); return }
  res.json({ id: req.params.id, status: { state: 'canceled' } })
})
