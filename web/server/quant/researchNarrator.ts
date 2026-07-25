import type {
  CreateTaskInput,
  DecisionContext,
  QuantEvidence,
  StrategyCandidate,
  StrategyProposal,
} from '../../src/domain/trading.js'
import type { PandaModelConfig } from '../config/pandaModel.js'

export interface ResearchNarrator {
  summarize(input: CreateTaskInput, evidence: QuantEvidence, candidates: StrategyCandidate[]): Promise<string>
  proposeStrategies(context: DecisionContext): Promise<StrategyProposal[]>
  evaluateCandidates(
    candidates: StrategyCandidate[],
    context: { marketRegime: string; symbol: string },
  ): Promise<{ ranking: string[]; recommendation: string }>
}

export class PandaModelResearchNarrator implements ResearchNarrator {
  constructor(private readonly config: PandaModelConfig) {}

  async summarize(input: CreateTaskInput, evidence: QuantEvidence, candidates: StrategyCandidate[]): Promise<string> {
    if (!this.config.apiKey || this.config.provider === 'template') {
      throw new Error('PandaAI model API key is not configured')
    }
    const prompt = createPrompt(input, evidence, candidates)
    const text = await this.callDeepSeek(prompt, 0.2, 1_024)
    return ensureRiskDisclaimer(text)
  }

  async proposeStrategies(context: DecisionContext): Promise<StrategyProposal[]> {
    if (!this.config.apiKey || this.config.provider === 'template') {
      throw new Error('PandaAI model API key is not configured')
    }
    const prompt = createProposePrompt(context)
    const text = await this.callDeepSeek(prompt, 0.5, 2_048)
    return parseProposals(text, context.symbol)
  }

  async evaluateCandidates(
    candidates: StrategyCandidate[],
    context: { marketRegime: string; symbol: string },
  ): Promise<{ ranking: string[]; recommendation: string }> {
    if (!this.config.apiKey || this.config.provider === 'template') {
      throw new Error('PandaAI model API key is not configured')
    }
    const prompt = createEvaluatePrompt(candidates, context)
    const text = await this.callDeepSeek(prompt, 0.3, 1_024)
    return parseEvaluation(text, candidates)
  }

  private async callDeepSeek(prompt: string, temperature: number, maxTokens: number): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = this.config.provider === 'deepseek'
        ? await fetch(`${this.config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.config.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: this.config.endpointId,
              messages: [{ role: 'user', content: prompt }],
              temperature,
              max_tokens: maxTokens,
              stream: false,
            }),
            signal: controller.signal,
          })
        : await fetch(`${this.config.baseUrl}/responses`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.config.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ model: this.config.endpointId, input: prompt }),
            signal: controller.signal,
          })
      if (!response.ok) throw new Error(`PandaAI model request failed with status ${response.status}`)
      const payload = await response.json() as ModelResponsePayload
      const text = this.config.provider === 'deepseek'
        ? extractChatCompletionText(payload)
        : extractArkOutputText(payload)
      if (!text) throw new Error('PandaAI model returned no text output')
      return text
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class TemplateResearchNarrator implements ResearchNarrator {
  async summarize(_input: CreateTaskInput, evidence: QuantEvidence, candidates: StrategyCandidate[]): Promise<string> {
    const winner = candidates.find((candidate) => candidate.status === 'approved') ?? candidates[0]
    return `${evidence.symbol} 使用 ${evidence.provider} 的 ${evidence.barCount} 根日线完成验证。${winner.name} 在当前区间风险调整后表现最佳，但结果仅用于系统演示，不构成投资建议。`
  }

  async proposeStrategies(context: DecisionContext): Promise<StrategyProposal[]> {
    return createHardcodedProposals(context.symbol)
  }

  async evaluateCandidates(
    candidates: StrategyCandidate[],
  ): Promise<{ ranking: string[]; recommendation: string }> {
    const sorted = [...candidates].sort((a, b) => b.sharpe - a.sharpe)
    return {
      ranking: sorted.map((c) => c.id),
      recommendation: `回测引擎按 Sharpe 比率排序，${sorted[0].name} 风险调整后表现最佳。`,
    }
  }
}

export function createResearchNarrator(config: PandaModelConfig): ResearchNarrator {
  return config.apiKey ? new PandaModelResearchNarrator(config) : new TemplateResearchNarrator()
}

function createPrompt(input: CreateTaskInput, evidence: QuantEvidence, candidates: StrategyCandidate[]): string {
  return [
    '你是股票量化研究解释 Agent。请只根据提供的回测证据写一段不超过 180 字的中文摘要。',
    '必须说明数据来源、区间、胜出策略、主要风险，并明确“不构成投资建议”。不要补造新闻、价格或基本面事实。',
    `任务：${input.objective}`,
    `数据：${JSON.stringify(evidence)}`,
    `候选策略：${JSON.stringify(candidates)}`,
  ].join('\n')
}

interface ModelResponsePayload {
  output_text?: string
  output?: Array<{ content?: Array<{ text?: string }> }>
  choices?: Array<{ message?: { content?: string } }>
}

function extractArkOutputText(payload: ModelResponsePayload): string | undefined {
  if (payload.output_text) return payload.output_text
  return payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text).find(Boolean)
}

function extractChatCompletionText(payload: ModelResponsePayload): string | undefined {
  return payload.choices?.map((choice) => choice.message?.content).find(Boolean)
}

function ensureRiskDisclaimer(value: string): string {
  const disclaimer = '本结果不构成投资建议。'
  const normalized = value.trim()
  if (normalized.includes('不构成投资建议') && normalized.length <= 180) return normalized
  const withoutDuplicate = normalized.replace(/(?:本结果)?不构成投资建议[。.]?/g, '').trim()
  const separator = withoutDuplicate && !/[。！？.!?]$/.test(withoutDuplicate) ? '。' : ''
  const maxBodyLength = Math.max(0, 180 - separator.length - disclaimer.length)
  return `${withoutDuplicate.slice(0, maxBodyLength)}${separator}${disclaimer}`
}

// ── Strategy Proposal Prompts ──

function createProposePrompt(context: DecisionContext): string {
  return [
    '你是量化策略研究员。根据以下市场数据生成 3 个可回测的技术策略提案。',
    '每个策略必须包含：id (v1/v2a/v2b)、name (中文名)、description、entryRules (开仓规则)、exitRules (平仓规则)、positionLogic (仓位计算)、confidence (0-1)、rationale (理由)、marketRegime (市场状态)。',
    '策略必须是规则化的，能用日线回测实现。只返回 JSON 数组，不要任何解释文本。',
    `股票: ${context.symbol}`,
    `区间: ${context.dateRange.start} - ${context.dateRange.end}`,
    `日线数: ${context.barCount}`,
    `价格: 起始 ${context.priceSummary.start}, 结束 ${context.priceSummary.end}, 最低 ${context.priceSummary.min}, 最高 ${context.priceSummary.max}`,
    `波动率: ${context.priceSummary.volatility}`,
    `约束: 最大回撤 ≤${context.constraints.maxLossPct}%, 单股仓位 ≤${context.constraints.maxAssetPct}%, 预算 ${context.constraints.budget} USDT`,
    context.historicalContext ? `历史参考: ${context.historicalContext}` : '',
  ].filter(Boolean).join('\n')
}

function createEvaluatePrompt(
  candidates: StrategyCandidate[],
  context: { marketRegime: string; symbol: string },
): string {
  const summary = candidates.map((c) =>
    `${c.name}: 收益 ${c.returnPct}%, 回撤 ${c.drawdownPct}%, Sharpe ${c.sharpe}, 胜率 ${c.winRate}%, OOS收益 ${c.oosReturn}%`
  ).join('\n')
  return [
    '你是量化策略评估专家。根据回测结果和市场环境，对候选策略排序并给出建议。',
    '只返回 JSON: {"ranking":["v1","v2b","v2a"],"recommendation":"一句话理由"}',
    '不要任何额外文本。',
    `股票: ${context.symbol}`,
    `市场状态: ${context.marketRegime}`,
    `候选策略回测:\n${summary}`,
  ].join('\n')
}

// ── Parsing Helpers ──

function parseProposals(text: string, symbol: string): StrategyProposal[] {
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim()
  const jsonStart = cleaned.indexOf('[')
  const jsonEnd = cleaned.lastIndexOf(']') + 1
  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    return createHardcodedProposals(symbol)
  }
  try {
    const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd)) as Array<Record<string, unknown>>
    return parsed.map((item, index) => ({
      id: String(item.id ?? `ai-v${index + 1}`),
      name: String(item.name ?? `AI 策略 ${index + 1}`),
      description: String(item.description ?? ''),
      entryRules: String(item.entryRules ?? item.entry_rules ?? ''),
      exitRules: String(item.exitRules ?? item.exit_rules ?? ''),
      positionLogic: String(item.positionLogic ?? item.position_logic ?? ''),
      confidence: Number(item.confidence ?? 0.5),
      rationale: String(item.rationale ?? ''),
      marketRegime: String(item.marketRegime ?? item.market_regime ?? 'unknown'),
    }))
  } catch {
    return createHardcodedProposals(symbol)
  }
}

function parseEvaluation(
  text: string,
  candidates: StrategyCandidate[],
): { ranking: string[]; recommendation: string } {
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim()
  const jsonStart = cleaned.indexOf('{')
  const jsonEnd = cleaned.lastIndexOf('}') + 1
  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    return fallbackRanking(candidates)
  }
  try {
    const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd)) as { ranking?: string[]; recommendation?: string }
    return {
      ranking: parsed.ranking ?? candidates.sort((a, b) => b.sharpe - a.sharpe).map((c) => c.id),
      recommendation: parsed.recommendation ?? 'AI 评估解析失败，已退回 Sharpe 排序。',
    }
  } catch {
    return fallbackRanking(candidates)
  }
}

function fallbackRanking(candidates: StrategyCandidate[]): { ranking: string[]; recommendation: string } {
  const sorted = [...candidates].sort((a, b) => b.sharpe - a.sharpe)
  return {
    ranking: sorted.map((c) => c.id),
    recommendation: `无法解析 AI 评估结果，已退回 Sharpe 排序。${sorted[0].name} 风险调整后表现最佳。`,
  }
}

function createHardcodedProposals(symbol: string): StrategyProposal[] {
  return [
    {
      id: 'v1',
      name: '双均线趋势',
      description: '5/20 日双均线金叉做多，震荡区间可能反复交易',
      entryRules: '5日均线向上突破20日均线',
      exitRules: '5日均线下穿20日均线',
      positionLogic: '持仓 30% 名义本金',
      confidence: 0.6,
      rationale: `经典双均线交叉策略，适用于 ${symbol} 的趋势跟踪`,
      marketRegime: '趋势',
    },
    {
      id: 'v2a',
      name: '均线+波动率过滤',
      description: '趋势跟随 + 短期波动率过滤，降低震荡市误触发',
      entryRules: '5日均线 > 20日均线 且 10日波动率 < 2.2%',
      exitRules: '5日均线下穿20日均线 或 波动率突破 3.5%',
      positionLogic: '持仓 30% 名义本金',
      confidence: 0.7,
      rationale: '加入波动率过滤器可减少震荡市中的假突破信号',
      marketRegime: '震荡偏趋势',
    },
    {
      id: 'v2b',
      name: '均线+市场状态',
      description: '中期趋势强度确认 + 市场状态过滤',
      entryRules: '10日均线 > 30日均线 且 两者差距 > 0.9%',
      exitRules: '10日均线下穿30日均线',
      positionLogic: '持仓 25% 名义本金，保守仓位',
      confidence: 0.75,
      rationale: '中期趋势信号更可靠，保守仓位控制在极端行情中保护本金',
      marketRegime: '趋势确认',
    },
  ]
}
