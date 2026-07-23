import { app } from './app'
import { pool } from './db/pool'

const PORT = process.env.PORT ?? 8787

async function start() {
  // verify DB connection
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
}

start()
