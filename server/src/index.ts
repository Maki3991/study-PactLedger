import 'dotenv/config'
import { app } from './app'
import { pool } from './db/pool'
import { startBot } from './poolmate/bot'

const PORT = process.env.PORT ?? 8787

async function start() {
  try {
    await pool.query('SELECT 1')
    console.log('[db] PostgreSQL connected')
  } catch (err) {
    console.error('[db] connection failed:', err)
    process.exit(1)
  }

  app.listen(PORT, () => {
    console.log(`[server] listening on http://127.0.0.1:${PORT}`)
  })

  // start Telegram bot with auto-restart on crash
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const launchBot = () => {
      startBot().catch((err) => {
        console.error('[poolmate-bot] crashed:', err.message)
        console.log('[poolmate-bot] restarting in 5s…')
        setTimeout(launchBot, 5_000)
      })
    }
    launchBot()
  } else {
    console.warn('[poolmate-bot] TELEGRAM_BOT_TOKEN not set, bot disabled')
  }
}

start()
