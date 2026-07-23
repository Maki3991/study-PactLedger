import type { PandaConfigStatus } from '../../src/domain/trading.js'

export type PandaDataMode = 'auto' | 'panda' | 'replay'

export interface PandaDataConfig {
  mode: PandaDataMode
  username?: string
  password?: string
  baseUrl: string
  pythonExecutable: string
  defaultSymbol: string
  timeoutMs: number
}

export function readPandaDataConfig(environment: NodeJS.ProcessEnv = process.env): PandaDataConfig {
  const requestedMode = environment.PANDA_DATA_MODE
  const mode: PandaDataMode = requestedMode === 'panda' || requestedMode === 'replay' ? requestedMode : 'auto'
  return {
    mode,
    username: emptyToUndefined(environment.PANDA_DATA_USERNAME),
    password: emptyToUndefined(environment.PANDA_DATA_PASSWORD),
    baseUrl: environment.PANDA_DATA_BASE_URL || 'http://pandadata.pandaaiquant.com',
    pythonExecutable: environment.PANDA_PYTHON_BIN || (process.platform === 'win32' ? '.venv/Scripts/python.exe' : 'python'),
    defaultSymbol: environment.PANDA_DATA_DEFAULT_SYMBOL || '000001.SZ',
    timeoutMs: Number(environment.PANDA_DATA_TIMEOUT_MS || 45_000),
  }
}

export function getPandaConfigStatus(config: PandaDataConfig): PandaConfigStatus {
  const missing: string[] = []
  if (!config.username) missing.push('PANDA_DATA_USERNAME')
  if (!config.password) missing.push('PANDA_DATA_PASSWORD')
  const credentialsConfigured = missing.length === 0
  const provider = config.mode === 'replay' || (config.mode === 'auto' && !credentialsConfigured)
    ? 'replay'
    : 'panda-data'

  return {
    mode: config.mode,
    provider,
    ready: provider === 'replay' || credentialsConfigured,
    credentialsConfigured,
    pythonExecutable: config.pythonExecutable,
    defaultSymbol: config.defaultSymbol,
    sourceMethod: 'get_stock_daily_pre',
    sdkVersion: '0.0.12',
    skill: 'QuantSkills/pandadata-api',
    missing,
  }
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}
