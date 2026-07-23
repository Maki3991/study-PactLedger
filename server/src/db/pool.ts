import { Pool } from 'pg'

export const pool = new Pool({
  host: '129.226.91.246',
  port: 35432,
  database: 'postgres',
  user: 'postgres',
  password: 'ar8iX5WJSiFxBcHX',
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: false,
})

pool.on('error', (err) => {
  console.error('[pg] unexpected pool error', err.message)
})
