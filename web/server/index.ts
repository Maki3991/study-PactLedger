import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildApp } from './app.js'
import { loadEnvironment } from './config/environment.js'

loadEnvironment()

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const databasePath = process.env.KALEIDOX_DB_PATH ?? join(currentDirectory, 'data', 'kaleidox.db')
const port = Number(process.env.KALEIDOX_API_PORT ?? 8787)
const app = await buildApp({ databasePath })

const shutdown = async () => {
  await app.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await app.listen({ host: '127.0.0.1', port })
console.log(`KaleidoX API listening on http://127.0.0.1:${port}`)
