import type { CreateTaskInput } from '../../src/domain/trading.js'
import type { MarketDataProvider, QuantAnalysis } from './types.js'
import { runCandidateBacktests } from './backtest.js'
import type { ResearchNarrator } from './researchNarrator.js'

export class QuantResearchService {
  constructor(
    private readonly marketData: MarketDataProvider,
    private readonly narrator: ResearchNarrator,
  ) {}

  async analyze(input: CreateTaskInput): Promise<QuantAnalysis> {
    const endDate = input.endDate || compactDate(new Date())
    const startDate = input.startDate || compactDate(daysBefore(endDate, 540))
    const result = await this.marketData.fetchDaily({ symbol: input.asset, startDate, endDate })
    const candidates = runCandidateBacktests(result.bars, input.maxLossPct)
    const winner = candidates.find((candidate) => candidate.status === 'approved') ?? candidates[0]
    const evidence = {
      provider: result.provider,
      configured: result.configured,
      sourceMethod: result.sourceMethod,
      sdkVersion: result.sdkVersion,
      adjustment: result.adjustment,
      skill: result.skill,
      symbol: input.asset,
      startDate,
      endDate,
      barCount: result.bars.length,
      fetchedAt: new Date().toISOString(),
      note: result.note,
    } as const
    let researchSummary: string
    try {
      researchSummary = await this.narrator.summarize(input, evidence, candidates)
    } catch (error) {
      researchSummary = `研究解释模型暂不可用：${error instanceof Error ? error.message : 'unknown error'}。回测结果仍由确定性策略引擎生成。本结果不构成投资建议。`
    }
    return {
      candidates,
      winner,
      evidence,
      researchSummary,
    }
  }
}

function compactDate(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll('-', '')
}

function daysBefore(compact: string, days: number): Date {
  const date = new Date(Date.UTC(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)) - 1, Number(compact.slice(6, 8))))
  date.setUTCDate(date.getUTCDate() - days)
  return date
}
