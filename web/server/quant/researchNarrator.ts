import type { CreateTaskInput, QuantEvidence, StrategyCandidate } from '../../src/domain/trading.js'
import type { PandaModelConfig } from '../config/pandaModel.js'

export interface ResearchNarrator {
  summarize(input: CreateTaskInput, evidence: QuantEvidence, candidates: StrategyCandidate[]): Promise<string>
}

export class PandaModelResearchNarrator implements ResearchNarrator {
  constructor(private readonly config: PandaModelConfig) {}

  async summarize(input: CreateTaskInput, evidence: QuantEvidence, candidates: StrategyCandidate[]): Promise<string> {
    if (!this.config.apiKey) throw new Error('ARK_API_KEY is not configured')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = await fetch(`${this.config.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.endpointId,
          input: createPrompt(input, evidence, candidates),
        }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`PandaAI model request failed with status ${response.status}`)
      const payload = await response.json() as ArkResponsesPayload
      const text = extractOutputText(payload)
      if (!text) throw new Error('PandaAI model returned no text output')
      return text.trim()
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

interface ArkResponsesPayload {
  output_text?: string
  output?: Array<{ content?: Array<{ text?: string }> }>
}

function extractOutputText(payload: ArkResponsesPayload): string | undefined {
  if (payload.output_text) return payload.output_text
  return payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text).find(Boolean)
}
