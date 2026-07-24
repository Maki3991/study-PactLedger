import type { AgentRun, FirewallRule, StrategyCandidate, TimelineEvent } from '../domain/trading'

export const demoAgents: AgentRun[] = [
  { id: 'research', name: 'Research', role: 'Market research', status: 'complete', detail: '趋势与流动性已归因', elapsed: '02:14' },
  { id: 'strategy', name: 'Strategy', role: 'Signal design', status: 'complete', detail: '生成 2 个候选版本', elapsed: '01:48' },
  { id: 'backtest', name: 'Backtest', role: 'Out-of-sample', status: 'complete', detail: '126 日滚动验证完成', elapsed: '04:52' },
  { id: 'risk', name: 'Risk', role: 'Independent veto', status: 'working', detail: '复核 V2-B 修订仓位', elapsed: '00:37' },
  { id: 'evolution', name: 'Evolution', role: 'Champion challenger', status: 'complete', detail: 'V2-B 通过性能晋级', elapsed: '03:06' },
  { id: 'execution', name: 'Execution', role: 'Execution adapter', status: 'waiting', detail: '等待风险签发', elapsed: '--:--' },
]

export const initialCandidates: StrategyCandidate[] = [
  {
    id: 'v1', name: 'V1', status: 'rejected', note: '短周期趋势过拟合', returnPct: 3.2, drawdownPct: 8.1, sharpe: 0.74, winRate: 42, volatility: 18.3, oosReturn: -1.2, trades: 23, signal: '双均线',
  },
  {
    id: 'v2a', name: 'V2-A', status: 'testing', note: '增加波动率过滤', returnPct: 4.0, drawdownPct: 5.7, sharpe: 1.06, winRate: 56, volatility: 12.1, oosReturn: 3.1, trades: 15, signal: '均线 + 波动率过滤',
  },
  {
    id: 'v2b', name: 'V2-B', status: 'rejected', note: '初始 40% 仓位超限', returnPct: 4.6, drawdownPct: 4.2, sharpe: 1.28, winRate: 61, volatility: 9.8, oosReturn: 4.0, trades: 11, signal: '均线 + 市场状态',
  },
]

export const firewallRules: FirewallRule[] = [
  { label: '总交易预算', limit: '1,000 USDT', current: '250 USDT', state: 'pass' },
  { label: '单一股票最大仓位', limit: '30%', current: '25%', state: 'pass' },
  { label: '单策略最大亏损', limit: '5%', current: '4.2%', state: 'pass' },
  { label: '标的白名单', limit: '000001.SZ', current: '000001.SZ', state: 'locked' },
]

export const timeline: TimelineEvent[] = [
  { time: '10:32:18', title: 'V1 实盘偏差已归档', detail: '震荡状态下连续 4 次错误趋势信号', tone: 'warning' },
  { time: '10:35:42', title: 'V2-B 成为性能冠军', detail: '风险调整后 Sharpe 1.28', tone: 'success' },
  { time: '10:36:07', title: 'Risk Agent 退回初版', detail: '建议仓位 40%，超过用户上限', tone: 'warning' },
  { time: '10:36:21', title: 'V2-B 提交修订计划', detail: '执行仓位调整为 25%', tone: 'neutral' },
]
