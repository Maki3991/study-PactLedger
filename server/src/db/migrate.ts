import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { pool } from './pool'

async function migrate() {
  const schemas = [
    join(__dirname, 'schema.sql'),
    join(__dirname, '../treasury/schema.sql'),
  ]

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const file of schemas) {
      const sql = readFileSync(file, 'utf8')
      await client.query(sql)
      console.log(`[migrate] applied: ${file}`)
    }
    await client.query('COMMIT')
    console.log('[migrate] all schemas applied successfully')
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
