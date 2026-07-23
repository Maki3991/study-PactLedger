import type { AgentRun, FirewallRule, StrategyCandidate, TaskSnapshot } from '../src/domain/trading.js'

export const candidateStrategies: StrategyCandidate[] = [
  { id: 'v1', name: 'V1', status: 'rejected', note: '短周期趋势过拟合', returnPct: 3.2, drawdownPct: 8.1, sharpe: 0.74, signal: '趋势跟随' },
  { id: 'v2a', name: 'V2-A', status: 'testing', note: '增加波动率过滤', returnPct: 4.0, drawdownPct: 5.7, sharpe: 1.06, signal: '过滤趋势' },
  { id: 'v2b', name: 'V2-B', status: 'approved', note: '状态识别，修订仓位 25%', returnPct: 4.6, drawdownPct: 4.2, sharpe: 1.28, signal: '状态识别' },
]

export const createAgents = (): AgentRun[] => [
  { id: 'research', name: 'Research', role: 'Market research', status: 'waiting', detail: '等待市场研究任务', elapsed: '--:--' },
  { id: 'strategy', name: 'Strategy', role: 'Signal design', status: 'waiting', detail: '等待研究结论', elapsed: '--:--' },
  { id: 'backtest', name: 'Backtest', role: 'Out-of-sample', status: 'waiting', detail: '等待候选策略', elapsed: '--:--' },
  { id: 'risk', name: 'Risk', role: 'Independent veto', status: 'waiting', detail: '等待独立风控', elapsed: '--:--' },
  { id: 'evolution', name: 'Evolution', role: 'Champion challenger', status: 'waiting', detail: '等待竞争验证', elapsed: '--:--' },
  { id: 'execution', name: 'Execution', role: 'Injective testnet', status: 'waiting', detail: '等待风险签发', elapsed: '--:--' },
]

export const createFirewallRules = (): FirewallRule[] => [
  { label: '总交易预算', limit: '1,000 USDT', current: '0 USDT', state: 'pass' },
  { label: 'ETH 最大仓位', limit: '30%', current: '待计算', state: 'pass' },
  { label: '单策略最大亏损', limit: '5%', current: '待计算', state: 'pass' },
  { label: '资产白名单', limit: 'ETH', current: 'ETH / USDT', state: 'locked' },
]

export const createTaskSnapshot = (id: string, missionId: string, objective: string): TaskSnapshot => {
  const now = new Date().toISOString()
  return {
    id,
    missionId,
    objective,
    phase: 'created',
    agents: createAgents(),
    candidates: [],
    firewallRules: createFirewallRules(),
    timeline: [],
    execution: { state: 'ready', network: 'Injective Testnet' },
    createdAt: now,
    updatedAt: now,
  }
}
