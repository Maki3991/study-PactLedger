import express from 'express'
import cors from 'cors'
import { tasksRouter } from './routes/tasks'
import { configRouter } from './routes/config'
import { agentCardRouter } from './routes/agentCard'
import { a2aRouter } from './routes/a2a'
import { treasuryRouter } from './treasury/routes'

export const app = express()

app.use(cors())
app.use(express.json())

// Core API routes (used by frontend)
app.use('/api/tasks', tasksRouter)
app.use('/api/config', configRouter)
app.use('/api/treasury', treasuryRouter)

// A2A protocol routes (used by PandaAI platform)
app.use('/.well-known/agent-card.json', agentCardRouter)
app.use('/a2a', a2aRouter)

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    ai: process.env.DEEPSEEK_API_KEY ? 'deepseek-connected' : 'demo-mode',
  })
})
