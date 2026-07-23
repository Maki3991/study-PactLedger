import assert from 'node:assert/strict'
import test from 'node:test'
import { getDatabaseConfigStatus, readDatabaseConfig } from './database.js'

test('PostgreSQL config accepts the existing PG_* environment names', () => {
  const config = readDatabaseConfig({
    PG_HOST: 'postgres',
    PG_PORT: '5432',
    PG_DATABASE: 'agent_treasury',
    PG_USER: 'agent_treasury',
    PG_PASSWORD: 'server-only-secret',
  })
  const status = getDatabaseConfigStatus(config)
  assert.equal(status.provider, 'postgresql')
  assert.equal(status.configured, true)
  assert.equal(status.host, 'postgres')
  assert.deepEqual(status.missing, [])
  assert.ok(!JSON.stringify(status).includes('server-only-secret'))
})

test('PostgreSQL config reports missing fields without inventing credentials', () => {
  const status = getDatabaseConfigStatus(readDatabaseConfig({}))
  assert.equal(status.provider, 'memory')
  assert.equal(status.configured, false)
  assert.deepEqual(status.missing, ['POSTGRES_HOST', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD'])
})
