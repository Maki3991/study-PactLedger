/**
 * Agent AI functions – each agent calls DeepSeek V4 Pro.
 * Falls back to demo strings when API key is not configured.
 */
import { chat, isConfigured } from './deepseek'

// ── Research Agent ────────────────────────────────────────────────────────────

export interface ResearchOutput {
  summary: string
  opportunity: string
  risk: string
  marketState: 'trending' | 'ranging' | 'volatile'
}

export async function runResearch(
  asset: string,
  objective: string,
  budgetUsdt: number,
): Promise<ResearchOutput> {
  if (!isConfigured()) {
    return {
      summary: `${asset} 当前处于震荡区间，短期趋势信号混杂。`,
      opportunity: '震荡区间中上沿存在突破机会，成交量温和放大。',
      risk: '短期趋势信号过拟合风险高，需要状态识别过滤。',
      marketState: 'ranging',
    }
  }

  const prompt = `You are a quantitative research agent. Analyze the market for ${asset} asset.

User objective: "${objective}"
Budget: ${budgetUsdt} USDT

Respond ONLY with a JSON object in this exact format (no markdown, no explanation):
{
  "summary": "<2-3 sentences market summary in Chinese>",
  "opportunity": "<identified trading opportunity in Chinese>",
  "risk": "<primary risk factor in Chinese>",
  "marketState": "trending" | "ranging" | "volatile"
}`

  const raw = await chat([{ role: 'user', content: prompt }], { temperature: 0.4, maxTokens: 512 })
  try {
    return JSON.parse(raw) as ResearchOutput
  } catch {
    return {
      summary: raw.slice(0, 200),
      opportunity: '见研究报告',
      risk: '见研究报告',
      marketState: 'ranging',
    }
  }
}

// ── Strategy Agent ─────────────────────────────────────────────────────────────

export interface StrategyCandidate {
  name: string
  signal: string
  entryCondition: string
  exitCondition: string
  positionPct: number
  stopLossPct: number
  expectedReturnPct: number
  maxDrawdownPct: number
  sharpe: number
  note: string
}

export async function runStrategy(
  asset: string,
  research: ResearchOutput,
  maxAssetPct: number,
  maxLossPct: number,
): Promise<[StrategyCandidate, StrategyCandidate]> {
  if (!isConfigured()) {
    return [
      { name: 'V2-A', signal: '过滤趋势', entryCondition: 'ATR 突破 + 成交量确认', exitCondition: 'RSI 超买或 3% 止盈', positionPct: 20, stopLossPct: 3.5, expectedReturnPct: 4.0, maxDrawdownPct: 5.7, sharpe: 1.06, note: '增加波动率过滤' },
      { name: 'V2-B', signal: '状态识别', entryCondition: '市场状态确认为趋势后入场', exitCondition: '状态切换为震荡立即离场', positionPct: 40, stopLossPct: 2.8, expectedReturnPct: 4.6, maxDrawdownPct: 4.2, sharpe: 1.28, note: '初始 40% 仓位超限（待风控审核）' },
    ]
  }

  const prompt = `You are a quantitative strategy agent. Generate TWO trading strategy candidates for ${asset}.

Research findings:
- Market state: ${research.marketState}
- Summary: ${research.summary}
- Opportunity: ${research.opportunity}
- Risk: ${research.risk}

Constraints:
- Max asset position: ${maxAssetPct}%
- Max loss tolerance: ${maxLossPct}%

IMPORTANT: Make one candidate slightly exceed the position limit (for risk agent demo) — this is intentional.

Respond ONLY with a JSON array of exactly 2 objects:
[
  {
    "name": "V2-A",
    "signal": "<signal type in Chinese>",
    "entryCondition": "<entry in Chinese>",
    "exitCondition": "<exit in Chinese>",
    "positionPct": <number>,
    "stopLossPct": <number>,
    "expectedReturnPct": <number>,
    "maxDrawdownPct": <number>,
    "sharpe": <number>,
    "note": "<brief note in Chinese>"
  },
  { ... same for V2-B ... }
]`

  const raw = await chat([{ role: 'user', content: prompt }], { temperature: 0.6, maxTokens: 800 })
  try {
    const parsed = JSON.parse(raw) as [StrategyCandidate, StrategyCandidate]
    return parsed
  } catch {
    // fallback
    return [
      { name: 'V2-A', signal: '过滤趋势', entryCondition: 'ATR 突破 + 成交量确认', exitCondition: 'RSI 超买或 3% 止盈', positionPct: 20, stopLossPct: 3.5, expectedReturnPct: 4.0, maxDrawdownPct: 5.7, sharpe: 1.06, note: '增加波动率过滤' },
      { name: 'V2-B', signal: '状态识别', entryCondition: '市场状态确认为趋势后入场', exitCondition: '状态切换为震荡立即离场', positionPct: 40, stopLossPct: 2.8, expectedReturnPct: 4.6, maxDrawdownPct: 4.2, sharpe: 1.28, note: '初始 40% 仓位超限（待风控审核）' },
    ]
  }
}

// ── Risk Agent ────────────────────────────────────────────────────────────────

export interface RiskDecision {
  approved: boolean
  reason: string
  revisedPositionPct?: number
}

export async function runRiskCheck(
  candidate: StrategyCandidate,
  maxAssetPct: number,
  maxLossPct: number,
): Promise<RiskDecision> {
  if (!isConfigured()) {
    if (candidate.positionPct > maxAssetPct) {
      return {
        approved: false,
        reason: `建议仓位 ${candidate.positionPct}% 超过用户上限 ${maxAssetPct}%，拒绝升级`,
        revisedPositionPct: Math.floor(maxAssetPct * 0.85),
      }
    }
    return { approved: true, reason: '所有风险指标通过，仓位合规' }
  }

  const prompt = `You are an independent risk agent with veto power. Review this trading strategy:

Strategy: ${candidate.name}
Position size: ${candidate.positionPct}%
Stop loss: ${candidate.stopLossPct}%
Expected return: ${candidate.expectedReturnPct}%
Max drawdown: ${candidate.maxDrawdownPct}%
Signal: ${candidate.signal}

User constraints:
- Max asset position: ${maxAssetPct}%
- Max loss tolerance: ${maxLossPct}%

Respond ONLY with JSON:
{
  "approved": true | false,
  "reason": "<decision reason in Chinese>",
  "revisedPositionPct": <number or null>
}`

  const raw = await chat([{ role: 'user', content: prompt }], { temperature: 0.2, maxTokens: 256 })
  try {
    return JSON.parse(raw) as RiskDecision
  } catch {
    const approved = candidate.positionPct <= maxAssetPct && candidate.maxDrawdownPct <= maxLossPct
    return { approved, reason: approved ? '风险指标通过' : '仓位或回撤超限' }
  }
}
