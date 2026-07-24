import type { CreateTaskInput, QuantEvidence, StrategyCandidate } from '../../src/domain/trading.js'
import type { PandaModelConfig } from '../config/pandaModel.js'

export interface ResearchNarrator {
  summarize(input: CreateTaskInput, evidence: QuantEvidence, candidates: StrategyCandidate[]): Promise<string>
}

export class PandaModelResearchNarrator implements ResearchNarrator {
  constructor(private readonly config: PandaModelConfig) {}

  async summarize(input: CreateTaskInput, evidence: QuantEvidence, candidates: StrategyCandidate[]): Promise<string> {
    if (!this.config.apiKey || this.config.provider === 'template') {
      throw new Error('PandaAI model API key is not configured')
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const prompt = createPrompt(input, evidence, candidates)
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
              temperature: 0.2,
              max_tokens: 1_024,
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
            body: JSON.stringify({
              model: this.config.endpointId,
              input: prompt,
            }),
            signal: controller.signal,
          })
      if (!response.ok) throw new Error(`PandaAI model request failed with status ${response.status}`)
      const payload = await response.json() as ModelResponsePayload
      const text = this.config.provider === 'deepseek'
        ? extractChatCompletionText(payload)
        : extractArkOutputText(payload)
      if (!text) throw new Error('PandaAI model returned no text output')
      return ensureRiskDisclaimer(text)
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
