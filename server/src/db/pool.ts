import { Pool } from 'pg'

// Support both DATABASE_URL (priority) and individual POSTGRES_* vars
function makePool() {
  if (process.env.DATABASE_URL) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.POSTGRES_SSL === 'disable' ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  }
  return new Pool({
    host:     process.env.POSTGRES_HOST     ?? process.env.PG_HOST     ?? '127.0.0.1',
    port:     parseInt(process.env.POSTGRES_PORT ?? process.env.PG_PORT ?? '5432', 10),
    database: process.env.POSTGRES_DB       ?? process.env.PG_DATABASE ?? 'postgres',
    user:     process.env.POSTGRES_USER     ?? process.env.PG_USER     ?? 'postgres',
    password: process.env.POSTGRES_PASSWORD ?? process.env.PG_PASSWORD,
    ssl:      process.env.POSTGRES_SSL === 'disable' ? false : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })
}

export const pool = makePool()

pool.on('error', (err) => {
  console.error('[pg] unexpected pool error', err.message)
})
