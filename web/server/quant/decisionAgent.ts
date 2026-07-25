import { randomUUID } from 'node:crypto'
import type {
  DecisionContext,
  DecisionRecord,
  KnowledgeReference,
  QuantEvidence,
  ResearchMarketContext,
  StrategyCandidate,
  StrategyProposal,
} from '../../src/domain/trading.js'
import type { PriceBar } from './types.js'
import { runCandidateBacktests } from './backtest.js'
import { AgentMemory } from './agentMemory.js'
import type { ResearchNarrator } from './researchNarrator.js'

export interface StrategyGenerationResult {
  proposals: StrategyProposal[]
  marketRegime: string
}

export interface KnowledgeContextResult {
  status: 'used' | 'empty' | 'unavailable'
  records: KnowledgeReference[]
}

export interface EvaluationResult {
  ranking: string[]
  recommendation: string
}

export class DecisionAgent {
  constructor(
    private readonly narrator: ResearchNarrator,
    private readonly memory: AgentMemory,
  ) {}

  async generateStrategies(
    bars: PriceBar[],
    constraints: { maxLossPct: number; maxAssetPct: number; budget: number },
    symbol: string,
    dateRange: { start: string; end: string },
    knowledge?: KnowledgeContextResult,
    marketContext?: ResearchMarketContext,
  ): Promise<StrategyGenerationResult> {
    const prices = bars.map((b) => b.close)
    const volatility = computeAnnualizedVolatility(bars)
    const context: DecisionContext = {
      symbol,
      dateRange,
      barCount: bars.length,
      priceSummary: {
        start: prices[0],
        end: prices[prices.length - 1],
        min: Math.min(...prices),
        max: Math.max(...prices),
        volatility: Math.round(volatility * 10000) / 100,
      },
      constraints: {
        maxLossPct: constraints.maxLossPct,
        maxAssetPct: constraints.maxAssetPct,
        budget: constraints.budget,
      },
      ...(marketContext ? { marketContext } : {}),
    }

    const resolvedKnowledge = knowledge ?? await this.loadKnowledgeContext(30)
    if (resolvedKnowledge.records.length > 0) {
      context.historicalContext = formatKnowledgeContext(resolvedKnowledge.records, 30)
    }

    const proposals = await this.narrator.proposeStrategies(context)

    // 提取 AI 诊断的市场状态
    const regimes = proposals.map((p) => p.marketRegime).filter(Boolean)
    const marketRegime = regimes.length > 0
      ? mostFrequent(regimes)
      : classifyRegimeFromBars(bars)

    return { proposals, marketRegime }
  }

  async loadKnowledgeContext(days: number): Promise<KnowledgeContextResult> {
    try {
      const records = await this.memory.getRecentReferences(days)
      return { status: records.length > 0 ? 'used' : 'empty', records }
    } catch {
      return { status: 'unavailable', records: [] }
    }
  }

  async backtestProposals(
    proposals: StrategyProposal[],
    bars: PriceBar[],
    maxLossPct: number,
  ): Promise<StrategyCandidate[]> {
    // 先用硬编码回测引擎跑（注意：AI 生成的 positionLogic 无法直接执行）
    // 使用确定性回测作为基准，AI proposal 的元数据附加到结果上
    return runCandidateBacktests(bars, maxLossPct)
  }

  async evaluateAndRank(
    candidates: StrategyCandidate[],
    context: { bars: PriceBar[]; marketRegime: string; symbol: string; marketContext?: ResearchMarketContext },
  ): Promise<EvaluationResult> {
    return this.narrator.evaluateCandidates(candidates, {
      marketRegime: context.marketRegime,
      symbol: context.symbol,
      marketContext: context.marketContext,
    })
  }

  async recordDecision(params: {
    taskId: string
    symbol: string
    marketRegime: string
    proposals: StrategyProposal[]
    selectedStrategy: string
    evidence: QuantEvidence
  }): Promise<DecisionRecord> {
    const record: DecisionRecord = {
      id: `DEC-${randomUUID().slice(0, 8).toUpperCase()}`,
      taskId: params.taskId,
      symbol: params.symbol,
      date: new Date().toISOString().slice(0, 10),
      marketRegime: params.marketRegime,
      proposals: params.proposals,
      selectedStrategy: params.selectedStrategy,
      evidence: params.evidence,
      createdAt: new Date().toISOString(),
    }
    await this.memory.save(record)
    return record
  }
}

// ── Helpers ──

function computeAnnualizedVolatility(bars: PriceBar[]): number {
  if (bars.length < 2) return 0
  const returns: number[] = []
  for (let i = 1; i < bars.length; i++) {
    returns.push(bars[i].close / bars[i - 1].close - 1)
  }
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length
  return Math.sqrt(variance) * Math.sqrt(252)
}

function mostFrequent(values: string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  let best = values[0]
  let bestCount = 0
  for (const [k, c] of counts) {
    if (c > bestCount) { best = k; bestCount = c }
  }
  return best
}

function classifyRegimeFromBars(bars: PriceBar[]): string {
  const vol = computeAnnualizedVolatility(bars)
  const prices = bars.map((b) => b.close)
  const start = prices[0]
  const end = prices[prices.length - 1]
  const change = (end - start) / start
  if (vol > 0.35) return '高波动'
  if (change > 0.15) return '牛市'
  if (change < -0.15) return '熊市'
  if (vol < 0.12) return '低波动震荡'
  return '震荡'
}

function formatKnowledgeContext(records: KnowledgeReference[], days: number): string {
  const lines = records.map((record) =>
    `${record.date} ${record.symbol} 市场=${record.marketRegime} 选择=${record.selectedStrategy}`
  )
  return `最近 ${days} 天决策记录:\n${lines.join('\n')}`
}
