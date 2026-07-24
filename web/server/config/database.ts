import { Pool, type PoolConfig } from 'pg'

export interface DatabaseConfigStatus {
  provider: 'postgresql' | 'memory'
  configured: boolean
  host?: string
  port?: number
  database?: string
  ssl: boolean
  missing: string[]
}

export interface DatabaseConfig {
  connectionString?: string
  host?: string
  port: number
  database?: string
  user?: string
  password?: string
  ssl: boolean
}

export function readDatabaseConfig(environment: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  return {
    connectionString: emptyToUndefined(environment.DATABASE_URL),
    host: emptyToUndefined(environment.POSTGRES_HOST ?? environment.PGHOST ?? environment.PG_HOST),
    port: Number(environment.POSTGRES_PORT ?? environment.PGPORT ?? environment.PG_PORT ?? 5432),
    database: emptyToUndefined(environment.POSTGRES_DB ?? environment.PGDATABASE ?? environment.PG_DATABASE),
    user: emptyToUndefined(environment.POSTGRES_USER ?? environment.PGUSER ?? environment.PG_USER),
    password: emptyToUndefined(environment.POSTGRES_PASSWORD ?? environment.PGPASSWORD ?? environment.PG_PASSWORD),
    ssl: environment.POSTGRES_SSL === 'require' || environment.PGSSLMODE === 'require',
  }
}

export function getDatabaseConfigStatus(config: DatabaseConfig): DatabaseConfigStatus {
  if (config.connectionString) {
    return { provider: 'postgresql', configured: true, ssl: config.ssl, missing: [] }
  }
  const missing: string[] = []
  if (!config.host) missing.push('POSTGRES_HOST')
  if (!config.database) missing.push('POSTGRES_DB')
  if (!config.user) missing.push('POSTGRES_USER')
  if (!config.password) missing.push('POSTGRES_PASSWORD')
  return {
    provider: missing.length === 0 ? 'postgresql' : 'memory',
    configured: missing.length === 0,
    host: config.host,
    port: config.port,
    database: config.database,
    ssl: config.ssl,
    missing,
  }
}

export function createDatabasePool(config: DatabaseConfig): Pool | undefined {
  const status = getDatabaseConfigStatus(config)
  if (!status.configured) return undefined
  const poolConfig: PoolConfig = config.connectionString
    ? { connectionString: config.connectionString }
    : {
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
      }
  if (config.ssl) poolConfig.ssl = { rejectUnauthorized: false }
  return new Pool({ ...poolConfig, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 })
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}
