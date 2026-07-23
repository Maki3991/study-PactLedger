import type { PandaModelStatus } from '../../src/domain/trading.js'

export interface PandaModelConfig {
  apiKey?: string
  baseUrl: string
  endpointId: string
  timeoutMs: number
}

export function readPandaModelConfig(environment: NodeJS.ProcessEnv = process.env): PandaModelConfig {
  return {
    apiKey: emptyToUndefined(environment.ARK_API_KEY),
    baseUrl: environment.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    endpointId: environment.PANDA_MODEL_ENDPOINT_ID || 'ep-20260708162855-pcf9x',
    timeoutMs: Number(environment.PANDA_MODEL_TIMEOUT_MS || 45_000),
  }
}

export function getPandaModelStatus(config: PandaModelConfig): PandaModelStatus {
  const missing = config.apiKey ? [] : ['ARK_API_KEY']
  return {
    provider: config.apiKey ? 'ark' : 'template',
    configured: Boolean(config.apiKey),
    endpointId: config.endpointId,
    baseUrl: config.baseUrl,
    missing,
  }
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}
