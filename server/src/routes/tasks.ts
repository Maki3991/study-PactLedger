import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { pool } from '../db/pool'
import { insertTask, getTaskSnapshot, updateTaskPhase } from '../db/queries'
import { addSubscriber, removeSubscriber, runSimulation, runExecution } from '../simulation'
import type { CreateTaskInput } from '../types'

export const tasksRouter = Router()

// POST /api/tasks – create a task and kick off the simulation
tasksRouter.post('/', async (req, res) => {
  const body = req.body as CreateTaskInput
  if (!body.objective || !body.budgetUsdt) {
    res.status(400).json({ message: 'objective and budgetUsdt are required' })
    return
  }

  const taskId = uuidv4()
  const missionId = `KX-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-DEMO`

  const client = await pool.connect()
  try {
    await insertTask(
      client,
      taskId,
      missionId,
      body.objective,
      body.budgetUsdt,
      body.maxLossPct ?? 5,
      body.maxAssetPct ?? 30,
      body.asset ?? 'ETH',
    )
  } finally {
    client.release()
  }

  // kick off async simulation (do not await)
  void runSimulation(taskId)

  const snapshot = await getTaskSnapshot(taskId)
  res.status(201).json(snapshot)
})

// POST /api/tasks/:id/approve
tasksRouter.post('/:id/approve', async (req, res) => {
  const { id } = req.params
  const snapshot = await getTaskSnapshot(id)
  if (!snapshot) { res.status(404).json({ message: 'task not found' }); return }
  if (snapshot.phase !== 'awaiting_approval') {
    res.status(409).json({ message: `cannot approve task in phase: ${snapshot.phase}` })
    return
  }
  await updateTaskPhase(id, 'approved')
  res.json(await getTaskSnapshot(id))
})

// POST /api/tasks/:id/execute
tasksRouter.post('/:id/execute', async (req, res) => {
  const { id } = req.params
  const snapshot = await getTaskSnapshot(id)
  if (!snapshot) { res.status(404).json({ message: 'task not found' }); return }
  if (snapshot.phase !== 'approved') {
    res.status(409).json({ message: `cannot execute task in phase: ${snapshot.phase}` })
    return
  }
  // kick off async execution
  void runExecution(id)
  res.json(await getTaskSnapshot(id))
})

// GET /api/tasks/:id/events – SSE stream
tasksRouter.get('/:id/events', async (req, res) => {
  const { id } = req.params

  // verify the task exists
  const snapshot = await getTaskSnapshot(id)
  if (!snapshot) { res.status(404).json({ message: 'task not found' }); return }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // send current state immediately
  res.write(`event: task.snapshot\ndata: ${JSON.stringify({ type: 'task.snapshot', snapshot })}\n\n`)

  addSubscriber(id, res)

  req.on('close', () => {
    removeSubscriber(id, res)
  })
})
