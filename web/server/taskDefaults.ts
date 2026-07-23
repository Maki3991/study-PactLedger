import type { AgentRun, CreateTaskInput, FirewallRule, StrategyCandidate, TaskSnapshot } from '../src/domain/trading.js'

export const candidateStrategies: StrategyCandidate[] = [
  { id: 'v1', name: 'V1', status: 'rejected', note: '短周期趋势过拟合', returnPct: 3.2, drawdownPct: 8.1, sharpe: 0.74, winRate: 42, volatility: 18.3, oosReturn: -1.2, trades: 23, signal: '双均线' },
  { id: 'v2a', name: 'V2-A', status: 'testing', note: '增加波动率过滤', returnPct: 4.0, drawdownPct: 5.7, sharpe: 1.06, winRate: 56, volatility: 12.1, oosReturn: 3.1, trades: 15, signal: '均线 + 波动率过滤' },
  { id: 'v2b', name: 'V2-B', status: 'approved', note: '市场状态过滤，修订仓位 25%', returnPct: 4.6, drawdownPct: 4.2, sharpe: 1.28, winRate: 61, volatility: 9.8, oosReturn: 4.0, trades: 11, signal: '均线 + 市场状态' },
]

export const createAgents = (): AgentRun[] => [
  { id: 'research', name: 'Research', role: 'Market research', status: 'waiting', detail: '等待市场研究任务', elapsed: '--:--' },
  { id: 'strategy', name: 'Strategy', role: 'Signal design', status: 'waiting', detail: '等待研究结论', elapsed: '--:--' },
  { id: 'backtest', name: 'Backtest', role: 'Out-of-sample', status: 'waiting', detail: '等待候选策略', elapsed: '--:--' },
  { id: 'risk', name: 'Risk', role: 'Independent veto', status: 'waiting', detail: '等待独立风控', elapsed: '--:--' },
  { id: 'evolution', name: 'Evolution', role: 'Champion challenger', status: 'waiting', detail: '等待竞争验证', elapsed: '--:--' },
  { id: 'execution', name: 'Execution', role: 'Execution adapter', status: 'waiting', detail: '等待风险签发', elapsed: '--:--' },
]

export const createFirewallRules = (input: CreateTaskInput): FirewallRule[] => [
  { label: '策略资金预算', limit: `${input.budgetUsdt.toLocaleString()} USDT`, current: '0 USDT', state: 'pass' },
  { label: '单一股票最大仓位', limit: `${input.maxAssetPct}%`, current: '待计算', state: 'pass' },
  { label: '单策略最大回撤', limit: `${input.maxLossPct}%`, current: '待计算', state: 'pass' },
  { label: '标的白名单', limit: input.asset, current: input.asset, state: 'locked' },
]

export const createTaskSnapshot = (
  id: string,
  missionId: string,
  input: CreateTaskInput,
  ownerId?: string,
): TaskSnapshot => {
  const now = new Date().toISOString()
  return {
    id,
    missionId,
    ownerId,
    objective: input.objective,
    phase: 'created',
    agents: createAgents(),
    candidates: [],
    firewallRules: createFirewallRules(input),
    timeline: [],
    execution: { state: 'ready', network: 'Mock' },
    createdAt: now,
    updatedAt: now,
  }
}
