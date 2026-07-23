import { Pool } from 'pg'

export const pool = new Pool({
  host:     process.env.PG_HOST     ?? '127.0.0.1',
  port:     parseInt(process.env.PG_PORT ?? '5432', 10),
  database: process.env.PG_DATABASE ?? 'postgres',
  user:     process.env.PG_USER     ?? 'postgres',
  password: process.env.PG_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: false,
})

pool.on('error', (err) => {
  console.error('[pg] unexpected pool error', err.message)
})
