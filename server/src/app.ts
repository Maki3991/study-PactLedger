import express from 'express'
import cors from 'cors'
import { tasksRouter } from './routes/tasks'
import { configRouter } from './routes/config'

export const app = express()

app.use(cors())
app.use(express.json())

app.use('/api/tasks', tasksRouter)
app.use('/api/config', configRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})
