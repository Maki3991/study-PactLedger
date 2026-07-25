import type { CreateTaskInput, ResearchArtifacts, ResearchMarketContext } from '../../src/domain/trading.js'
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

  async analyze(input: CreateTaskInput, taskId?: string): Promise<QuantAnalysis> {
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
    const marketContext = buildMarketContext(result)

    // AI 策略生成（如果 DecisionAgent 可用且数据源为真实数据）
    let aiProposals: Awaited<ReturnType<DecisionAgent['generateStrategies']>> | undefined
    let knowledgeBase: ResearchArtifacts['knowledgeBase'] = {
      status: 'skipped',
      lookbackDays: 30,
      records: [],
      note: result.provider === 'panda-data'
        ? 'DecisionAgent 未启用，本次没有读取历史决策知识库。'
        : 'Replay 模式只运行确定性回测，本次没有将历史知识传入模型。',
    }
    let marketRegime = '趋势'
    if (this.decisionAgent && result.provider === 'panda-data') {
      const knowledge = await this.decisionAgent.loadKnowledgeContext(30)
      knowledgeBase = {
        ...knowledge,
        lookbackDays: 30,
        note: knowledge.status === 'used'
          ? `DecisionAgent 实际引用了 ${knowledge.records.length} 条近期决策记录。`
          : knowledge.status === 'empty'
            ? '知识库读取成功，但近 30 天没有可引用的历史决策。'
            : '知识库读取失败，DecisionAgent 在没有历史记忆的情况下继续分析。',
      }
      try {
        aiProposals = await this.decisionAgent.generateStrategies(
          result.bars,
          { maxLossPct: input.maxLossPct, maxAssetPct: input.maxAssetPct, budget: input.budgetUsdt },
          input.asset,
          { start: startDate, end: endDate },
          knowledge,
          marketContext,
        )
        marketRegime = aiProposals.marketRegime
      } catch {
        knowledgeBase = {
          ...knowledgeBase,
          status: 'unavailable',
          note: '知识库已读取，但 DecisionAgent 分析未完成；本次已降级为确定性策略。',
        }
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
          marketContext,
        })
        aiEvaluation = evaluation.recommendation
      } catch {
        aiEvaluation = `回测引擎按 Sharpe 排序完成。${candidates[0].name} 风险调整后表现最佳。`
      }
    }

    const winner = candidates.find((candidate) => candidate.status === 'approved') ?? candidates[0]

    // 记录决策（仅在真实数据 + DecisionAgent 可用时）
    let decisionRecord: Awaited<ReturnType<DecisionAgent['recordDecision']>> | undefined
    if (this.decisionAgent && aiProposals) {
      try {
        decisionRecord = await this.decisionAgent.recordDecision({
          taskId: taskId ?? `research-${Date.now()}`,
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

    const previousChampion = knowledgeBase.records.find((record) => record.symbol === input.asset)
    const evolutionOutcome = !previousChampion
      ? 'baseline_created'
      : previousChampion.selectedStrategy === winner.name
        ? 'champion_retained'
        : 'champion_promoted'
    const evolutionReason = evolutionOutcome === 'baseline_created'
      ? `${winner.name} 通过本轮 Champion–Challenger 回测，建立 ${input.asset} 的首个可追溯基线。`
      : evolutionOutcome === 'champion_retained'
        ? `${winner.name} 击败本轮 Challenger，继续保留 Champion。`
        : `${winner.name} 在风险调整后表现优于历史 Champion ${previousChampion?.selectedStrategy}，完成版本晋级。`

    let researchSummary: string
    try {
      researchSummary = await this.narrator.summarize(input, evidence, candidates, marketContext)
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
      artifacts: {
        marketData: result.bars.map((bar) => ({ ...bar })),
        ...(marketContext ? { marketContext } : {}),
        knowledgeBase,
        analysis: {
          mode: aiProposals ? 'decision-agent' : 'deterministic',
          marketRegime,
          proposals: aiProposals?.proposals ?? [],
          evaluation: aiEvaluation || `确定性回测引擎按 Sharpe 排序，${winner.name} 的风险调整后表现最佳。`,
        },
        evolution: {
          agentId: 'evolution',
          agentName: 'Evolution Agent',
          iterationId: taskId ?? `research-${evidence.fetchedAt}`,
          outcome: evolutionOutcome,
          ...(previousChampion ? {
            previousChampion: {
              decisionId: previousChampion.id,
              strategy: previousChampion.selectedStrategy,
              date: previousChampion.date,
            },
          } : {}),
          champion: {
            strategyId: winner.id,
            name: winner.name,
            signal: winner.signal,
            returnPct: winner.returnPct,
            drawdownPct: winner.drawdownPct,
            sharpe: winner.sharpe,
            winRate: winner.winRate,
          },
          inputs: {
            marketBars: result.bars.length,
            knowledgeRecords: knowledgeBase.records.length,
            candidateCount: candidates.length,
          },
          referencedDecisionIds: knowledgeBase.records.map((record) => record.id),
          archive: decisionRecord ? {
            status: 'knowledge_base',
            decisionId: decisionRecord.id,
            note: '本轮策略决策已写入 Agent 知识库，可供下一轮引用。',
          } : {
            status: 'task_snapshot_only',
            note: result.provider === 'replay'
              ? 'Replay 轮次仅归档在任务快照，不写入真实数据决策知识库。'
              : '模型决策未完成，本轮进化证据仅保存在任务快照。',
          },
          reason: evolutionReason,
          completedAt: new Date().toISOString(),
        },
      },
      researchSummary,
    }
  }
}

function buildMarketContext(result: Awaited<ReturnType<MarketDataProvider['fetchDaily']>>): ResearchMarketContext | undefined {
  const enrichment = result.enrichment
  if (!enrichment) return undefined

  const benchmark = enrichment.benchmark
    ? calculateBenchmarkContext(result.bars, enrichment.benchmark.symbol, enrichment.benchmark.bars)
    : undefined
  return {
    ...(enrichment.stockProfile ? { stockProfile: enrichment.stockProfile } : {}),
    ...(enrichment.industry ? { industry: enrichment.industry } : {}),
    ...(benchmark ? { benchmark } : {}),
    sources: enrichment.sources.map((source) => ({ ...source })),
  }
}

function calculateBenchmarkContext(
  assetBars: Array<{ date: string; close: number }>,
  symbol: string,
  benchmarkBars: Array<{ date: string; close: number; volume: number }>,
): ResearchMarketContext['benchmark'] | undefined {
  const benchmarkByDate = new Map(benchmarkBars.map((bar) => [bar.date, bar]))
  const aligned = assetBars
    .map((asset) => ({ asset, benchmark: benchmarkByDate.get(asset.date) }))
    .filter((pair): pair is { asset: { date: string; close: number }; benchmark: { date: string; close: number; volume: number } } => Boolean(pair.benchmark))
  if (aligned.length < 2) return undefined

  const assetReturns: number[] = []
  const benchmarkReturns: number[] = []
  for (let index = 1; index < aligned.length; index += 1) {
    assetReturns.push(aligned[index].asset.close / aligned[index - 1].asset.close - 1)
    benchmarkReturns.push(aligned[index].benchmark.close / aligned[index - 1].benchmark.close - 1)
  }
  const assetReturn = aligned.at(-1)!.asset.close / aligned[0].asset.close - 1
  const benchmarkReturn = aligned.at(-1)!.benchmark.close / aligned[0].benchmark.close - 1
  const benchmarkVariance = variance(benchmarkReturns)
  const correlationDenominator = Math.sqrt(variance(assetReturns) * benchmarkVariance)
  const covarianceValue = covariance(assetReturns, benchmarkReturns)

  return {
    symbol,
    bars: benchmarkBars.map((bar) => ({ ...bar })),
    alignedBarCount: aligned.length,
    assetReturnPct: roundPercent(assetReturn),
    benchmarkReturnPct: roundPercent(benchmarkReturn),
    excessReturnPct: roundPercent(assetReturn - benchmarkReturn),
    ...(correlationDenominator > 0 ? { correlation: round(covarianceValue / correlationDenominator) } : {}),
    ...(benchmarkVariance > 0 ? { beta: round(covarianceValue / benchmarkVariance) } : {}),
  }
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
}

function variance(values: number[]): number {
  const mean = average(values)
  return average(values.map((value) => (value - mean) ** 2))
}

function covariance(left: number[], right: number[]): number {
  const leftMean = average(left)
  const rightMean = average(right)
  return average(left.map((value, index) => (value - leftMean) * (right[index] - rightMean)))
}

function roundPercent(value: number): number {
  return round(value * 100)
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

function compactDate(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll('-', '')
}

function daysBefore(compact: string, days: number): Date {
  const date = new Date(Date.UTC(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)) - 1, Number(compact.slice(6, 8))))
  date.setUTCDate(date.getUTCDate() - days)
  return date
}
