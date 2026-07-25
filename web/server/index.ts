import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import fastifyStatic from '@fastify/static'
import { buildApp } from './app.js'
import { createDatabasePool, getDatabaseConfigStatus, readDatabaseConfig } from './config/database.js'
import { loadEnvironment } from './config/environment.js'

loadEnvironment()

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const webRoot = join(currentDirectory, '..')
const staticRoot = join(webRoot, 'dist')
const host = process.env.KALEIDOX_API_HOST ?? '127.0.0.1'
const port = Number(process.env.KALEIDOX_API_PORT ?? process.env.PORT ?? 8787)
const databaseConfig = readDatabaseConfig()
const databaseStatus = getDatabaseConfigStatus(databaseConfig)
if (!databaseStatus.configured) {
  throw new Error(`PostgreSQL configuration is incomplete: ${databaseStatus.missing.join(', ')}`)
}
const databasePool = createDatabasePool(databaseConfig)
const app = await buildApp({
  databasePool,
  databaseStatus,
  startTelegramBot: true,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramUserAllowlistEnabled: process.env.TELEGRAM_USER_ALLOWLIST_ENABLED === 'true',
  telegramAllowedUserIds: (process.env.TELEGRAM_ALLOWED_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  telegramApiRoot: process.env.TELEGRAM_API_ROOT,
  kaleidoxTelegramBotToken: process.env.KALEIDOX_TELEGRAM_BOT_TOKEN,
  kaleidoxTelegramOperators: process.env.KALEIDOX_TELEGRAM_OPERATORS,
})

if (process.env.KALEIDOX_SERVE_WEB !== 'false' && existsSync(staticRoot)) {
  await app.register(fastifyStatic, {
    root: staticRoot,
    prefix: '/',
  })
}

const shutdown = async () => {
  await app.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await app.listen({ host, port })
console.log(`Agent Treasury listening on http://${host}:${port}`)
