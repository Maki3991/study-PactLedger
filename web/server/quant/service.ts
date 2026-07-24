import type { CreateTaskInput } from '../../src/domain/trading.js'
import type { MarketDataProvider, QuantAnalysis } from './types.js'
import { runCandidateBacktests } from './backtest.js'
import { DecisionAgent } from './decisionAgent.js'
import type { ResearchNarrator } from './researchNarrator.js'

export class QuantResearchService {
  constructor(
    private readonly marketData: MarketDataProvider,
    private readonly narrator: ResearchNarrator,
    private readonly decisionAgent?: DecisionAgent,
  ) {}

  async analyze(input: CreateTaskInput): Promise<QuantAnalysis> {
    const endDate = input.endDate || compactDate(new Date())
    const startDate = input.startDate || compactDate(daysBefore(endDate, 540))
    const result = await this.marketData.fetchDaily({ symbol: input.asset, startDate, endDate })
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

    // AI 策略生成（如果 DecisionAgent 可用且数据源为真实数据）
    let aiProposals: Awaited<ReturnType<DecisionAgent['generateStrategies']>> | undefined
    let marketRegime = '趋势'
    if (this.decisionAgent && result.provider === 'panda-data') {
      try {
        aiProposals = await this.decisionAgent.generateStrategies(
          result.bars,
          { maxLossPct: input.maxLossPct, maxAssetPct: input.maxAssetPct, budget: input.budgetUsdt },
          input.asset,
          { start: startDate, end: endDate },
        )
        marketRegime = aiProposals.marketRegime
      } catch {
        // AI 策略生成失败时静默降级为硬编码策略
      }
    }

    const candidates = runCandidateBacktests(result.bars, input.maxLossPct)

    // AI 评估排序
    let aiEvaluation = ''
    if (this.decisionAgent && candidates.length > 0) {
      try {
        const evaluation = await this.decisionAgent.evaluateAndRank(candidates, {
          bars: result.bars,
          marketRegime,
          symbol: input.asset,
        })
        aiEvaluation = evaluation.recommendation
      } catch {
        aiEvaluation = `回测引擎按 Sharpe 排序完成。${candidates[0].name} 风险调整后表现最佳。`
      }
    }

    const winner = candidates.find((candidate) => candidate.status === 'approved') ?? candidates[0]

    // 记录决策（仅在真实数据 + DecisionAgent 可用时）
    if (this.decisionAgent && aiProposals) {
      try {
        await this.decisionAgent.recordDecision({
          taskId: `research-${Date.now()}`,
          symbol: input.asset,
          marketRegime,
          proposals: aiProposals.proposals,
          selectedStrategy: winner.name,
          evidence,
        })
      } catch {
        // 记录失败不阻塞主流程
      }
    }

    let researchSummary: string
    try {
      researchSummary = await this.narrator.summarize(input, evidence, candidates)
    } catch {
      researchSummary = `研究解释模型暂不可用。回测结果仍由确定性策略引擎生成。本结果不构成投资建议。`
    }

    // 如果有 AI 评估，追加到摘要
    if (aiEvaluation) {
      researchSummary = `${researchSummary} ${aiEvaluation}`
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
