import { readFileSync } from 'fs'
import { join } from 'path'
import { pool } from './pool'

async function migrate() {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')
    console.log('[migrate] schema applied successfully')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[migrate] failed:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()
