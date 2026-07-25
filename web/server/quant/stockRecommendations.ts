import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { StockRecommendation, StockRecommendationResult } from '../../src/domain/trading.js'
import type { PandaDataConfig } from '../config/panda.js'
import type { ResearchNarrator } from './researchNarrator.js'

type RecommendationSource = StockRecommendationResult['sources'][number]

interface RawCandidate {
  symbol: string
  name?: string
  indexWeight?: number
  close?: number
  closeDate?: string
  relativeReturn13w?: number
  relativeReturn26w?: number
  beta?: number
  averageDailyValue3m?: number
  analystPositiveRatio?: number
  analystCount?: number
}

interface BridgeResponse {
  universeSize?: number
  candidates?: RawCandidate[]
  sources?: RecommendationSource[]
  error?: string
}

export interface StockRecommendationProvider {
  recommend(limit?: number): Promise<StockRecommendationResult>
}

export class StockRecommendationService implements StockRecommendationProvider {
  constructor(
    private readonly config: PandaDataConfig,
    private readonly narrator: ResearchNarrator,
  ) {}

  async recommend(limit = 3): Promise<StockRecommendationResult> {
    if (!this.config.username || !this.config.password || this.config.mode === 'replay') {
      throw new StockRecommendationError('PANDA_DATA_NOT_CONFIGURED', 'PandaData 未配置，不能用 Replay 数据生成股票推荐。')
    }
    const scriptPath = fileURLToPath(new URL('./panda_recommend_bridge.py', import.meta.url))
    const endDate = compactDate(new Date())
    const startDate = compactDate(daysBefore(endDate, 220))
    let response: BridgeResponse
    try {
      response = await runBridge(this.config, scriptPath, {
        benchmarkSymbol: '000300.SH',
        startDate,
        endDate,
        candidateLimit: 40,
      })
    } catch (error) {
      throw new StockRecommendationError(
        'PANDA_RECOMMENDATION_UNAVAILABLE',
        `PandaData 候选数据获取失败：${safeProviderError(error)}`,
      )
    }

    const ranked = (response.candidates ?? [])
      .map(toRecommendation)
      .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))
      .slice(0, Math.min(Math.max(limit, 1), 5))
    if (!ranked.length) {
      throw new StockRecommendationError('PANDA_RECOMMENDATION_EMPTY', 'PandaData 没有返回可评分的沪深 300 候选数据。')
    }

    let modelSummary = deterministicSummary(ranked)
    let analysisMode: StockRecommendationResult['analysisMode'] = 'evidence-ranking'
    try {
      if (this.narrator.explainStockRecommendations) {
        modelSummary = await this.narrator.explainStockRecommendations(ranked, '000300.SH')
        analysisMode = 'evidence-ranking+deepseek'
      }
    } catch {
      // Deterministic evidence remains usable when the model is unavailable.
    }

    return {
      provider: 'panda-data',
      benchmarkSymbol: '000300.SH',
      universeSize: response.universeSize ?? response.candidates?.length ?? 0,
      generatedAt: new Date().toISOString(),
      analysisMode,
      modelSummary,
      recommendations: ranked,
      sources: response.sources ?? [],
      disclaimer: '候选排序基于历史行情、价量与分析师一致预期，仅用于研究，不构成投资建议。',
    }
  }
}

export class StockRecommendationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

function toRecommendation(candidate: RawCandidate): StockRecommendation {
  const rel13 = finite(candidate.relativeReturn13w)
  const rel26 = finite(candidate.relativeReturn26w)
  const beta = finite(candidate.beta)
  const liquidity = finite(candidate.averageDailyValue3m)
  const positiveRatio = finite(candidate.analystPositiveRatio)
  const score = clamp(
    50
      + clamp(rel13 ?? 0, -30, 30) * 0.55
      + clamp(rel26 ?? 0, -40, 40) * 0.3
      + (liquidity && liquidity > 0 ? clamp(Math.log10(liquidity) - 7, 0, 3) * 3 : 0)
      + (positiveRatio === undefined ? 0 : (positiveRatio - 0.5) * 18)
      - (beta === undefined ? 0 : Math.max(0, beta - 1.2) * 6),
    0,
    100,
  )
  const evidence = [
    rel13 === undefined ? undefined : `13 周相对收益 ${formatSigned(rel13)}%`,
    rel26 === undefined ? undefined : `26 周相对收益 ${formatSigned(rel26)}%`,
    positiveRatio === undefined ? undefined : `分析师正向占比 ${(positiveRatio * 100).toFixed(0)}%`,
    beta === undefined ? undefined : `区间 Beta ${beta.toFixed(2)}`,
  ].filter(Boolean)
  return {
    symbol: candidate.symbol,
    name: candidate.name || candidate.symbol,
    score: Number(score.toFixed(1)),
    ...(finite(candidate.indexWeight) === undefined ? {} : { indexWeight: finite(candidate.indexWeight) }),
    rationale: evidence.slice(0, 3).join(' · ') || '依据沪深 300 权重与可用价量证据进入候选。',
    metrics: {
      ...(finite(candidate.close) === undefined ? {} : { close: finite(candidate.close) }),
      ...(candidate.closeDate ? { closeDate: candidate.closeDate } : {}),
      ...(rel13 === undefined ? {} : { relativeReturn13w: rel13 }),
      ...(rel26 === undefined ? {} : { relativeReturn26w: rel26 }),
      ...(beta === undefined ? {} : { beta }),
      ...(liquidity === undefined ? {} : { averageDailyValue3m: liquidity }),
      ...(positiveRatio === undefined ? {} : { analystPositiveRatio: positiveRatio }),
      ...(finite(candidate.analystCount) === undefined ? {} : { analystCount: finite(candidate.analystCount) }),
    },
  }
}

function deterministicSummary(recommendations: StockRecommendation[]): string {
  return `证据评分优先关注 ${recommendations.map((item) => `${item.name}（${item.symbol}）`).join('、')}；请进入单股研究任务复核回撤、仓位与数据完整性。`
}

function runBridge(config: PandaDataConfig, scriptPath: string, payload: object): Promise<BridgeResponse> {
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
      reject(new Error(`PandaData recommendation timed out after ${config.timeoutMs}ms`))
    }, config.timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
      try {
        const response = lastLine ? JSON.parse(lastLine) as BridgeResponse : undefined
        if (code !== 0 || response?.error) reject(new Error(response?.error || stderr.trim() || `bridge exited with ${code}`))
        else resolve(response ?? {})
      } catch (error) {
        reject(error)
      }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

function finite(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
}

function compactDate(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll('-', '')
}

function daysBefore(value: string, days: number): Date {
  const date = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))))
  date.setUTCDate(date.getUTCDate() - days)
  return date
}

function safeProviderError(error: unknown): string {
  return (error instanceof Error ? error.message : 'unknown provider error')
    .replace(/(password|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 160)
}
