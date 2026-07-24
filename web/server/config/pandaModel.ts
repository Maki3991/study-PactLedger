import type { PandaModelStatus } from '../../src/domain/trading.js'

export type PandaModelProvider = 'deepseek' | 'ark' | 'template'

export interface PandaModelConfig {
  provider: PandaModelProvider
  apiKey?: string
  baseUrl: string
  endpointId: string
  timeoutMs: number
}

export function readPandaModelConfig(environment: NodeJS.ProcessEnv = process.env): PandaModelConfig {
  const deepSeekApiKey = emptyToUndefined(environment.DEEPSEEK_API_KEY)
  const timeoutMs = Number(environment.PANDA_MODEL_TIMEOUT_MS || environment.DEEPSEEK_TIMEOUT_MS || 45_000)
  if (deepSeekApiKey) {
    return {
      provider: 'deepseek',
      apiKey: deepSeekApiKey,
      baseUrl: environment.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      endpointId: environment.DEEPSEEK_MODEL || 'deepseek-v4-pro',
      timeoutMs,
    }
  }

  const arkApiKey = emptyToUndefined(environment.ARK_API_KEY)
  if (arkApiKey) {
    return {
      provider: 'ark',
      apiKey: arkApiKey,
      baseUrl: environment.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
      endpointId: environment.PANDA_MODEL_ENDPOINT_ID || 'ep-20260708162855-pcf9x',
      timeoutMs,
    }
  }

  return {
    provider: 'template',
    baseUrl: environment.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    endpointId: environment.DEEPSEEK_MODEL || 'deepseek-v4-pro',
    timeoutMs,
  }
}

export function getPandaModelStatus(config: PandaModelConfig): PandaModelStatus {
  const missing = config.apiKey ? [] : ['DEEPSEEK_API_KEY']
  return {
    provider: config.apiKey ? config.provider : 'template',
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
