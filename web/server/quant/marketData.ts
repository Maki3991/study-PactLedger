import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { PandaDataConfig } from '../config/panda.js'
import type { MarketDataProvider, MarketDataQuery, MarketDataResult, PriceBar } from './types.js'

interface BridgeResponse {
  bars?: PriceBar[]
  error?: string
}

export class PandaDataProvider implements MarketDataProvider {
  constructor(private readonly config: PandaDataConfig) {}

  async fetchDaily(query: MarketDataQuery): Promise<MarketDataResult> {
    if (!this.config.username || !this.config.password) {
      throw new Error('PandaData credentials are not configured')
    }
    const scriptPath = fileURLToPath(new URL('./panda_bridge.py', import.meta.url))
    const response = await runBridge(this.config, scriptPath, query)
    const bars = response.bars?.filter((bar) => Number.isFinite(bar.close) && bar.close > 0) ?? []
    if (bars.length < 60) throw new Error(`PandaData returned only ${bars.length} valid daily bars; at least 60 are required`)
    return {
      bars,
      provider: 'panda-data',
      configured: true,
      sourceMethod: 'get_stock_daily_pre',
      sdkVersion: '0.0.12',
      adjustment: 'pre-adjusted',
      skill: 'QuantSkills/pandadata-api',
      note: 'PandaData 前复权 A 股日线；调用契约由 QuantSkills pandadata-api 校验',
    }
  }
}

export class ReplayMarketDataProvider implements MarketDataProvider {
  async fetchDaily(query: MarketDataQuery): Promise<MarketDataResult> {
    return {
      bars: createReplayBars(query),
      provider: 'replay',
      configured: false,
      sourceMethod: 'deterministic_replay',
      sdkVersion: '0.0.12',
      adjustment: 'synthetic',
      skill: 'QuantSkills/pandadata-api',
      note: '内置确定性回放数据；配置 PandaAI 账号后自动切换真实日线',
    }
  }
}

export function createMarketDataProvider(config: PandaDataConfig): MarketDataProvider {
  const hasCredentials = Boolean(config.username && config.password)
  if (config.mode === 'panda' || (config.mode === 'auto' && hasCredentials)) return new PandaDataProvider(config)
  return new ReplayMarketDataProvider()
}

async function runBridge(config: PandaDataConfig, scriptPath: string, query: MarketDataQuery): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.pythonExecutable, [scriptPath], {
      env: {
        ...process.env,
        PANDA_DATA_USERNAME: config.username,
        PANDA_DATA_PASSWORD: config.password,
        PANDA_DATA_BASE_URL: config.baseUrl,
        PYTHONIOENCODING: 'utf-8',
      },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`PandaData request timed out after ${config.timeoutMs}ms`))
    }, config.timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(new Error(`Unable to start PandaData Python bridge: ${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
      const lastLine = lines.at(-1)
      let payload: BridgeResponse | undefined
      try {
        payload = lastLine ? JSON.parse(lastLine) as BridgeResponse : undefined
      } catch {
        reject(new Error(`PandaData bridge returned invalid JSON${stderr ? `: ${stderr.trim()}` : ''}`))
        return
      }
      if (code !== 0 || payload?.error) {
        reject(new Error(payload?.error || stderr.trim() || `PandaData bridge exited with code ${code}`))
        return
      }
      resolve(payload ?? {})
    })

    child.stdin.end(JSON.stringify(query))
  })
}

function createReplayBars(query: MarketDataQuery): PriceBar[] {
  const bars: PriceBar[] = []
  const cursor = parseCompactDate(query.startDate)
  const end = parseCompactDate(query.endDate)
  let index = 0
  let price = 10.8
  while (cursor <= end && bars.length < 420) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) {
      const regime = Math.floor(index / 55) % 3
      const drift = regime === 0 ? 0.0015 : regime === 1 ? -0.0003 : 0.0008
      const noise = Math.sin(index * 1.71) * (regime === 1 ? 0.018 : 0.006)
      const cycle = Math.sin(index / 11) * 0.0025
      price = Math.max(2, price * (1 + drift + noise + cycle))
      bars.push({
        date: formatCompactDate(cursor),
        close: Number(price.toFixed(3)),
        volume: Math.round(70_000_000 + Math.abs(Math.sin(index / 5)) * 55_000_000),
      })
      index += 1
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return bars
}

function parseCompactDate(value: string): Date {
  return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))))
}

function formatCompactDate(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll('-', '')
}
