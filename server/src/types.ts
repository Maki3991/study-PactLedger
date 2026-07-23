// Mirror of web/src/domain/trading.ts – server-side copy

export type AgentStatus = 'complete' | 'working' | 'blocked' | 'waiting'
export type CandidateStatus = 'rejected' | 'approved' | 'testing'

export interface AgentRun {
  id: string
  name: string
  role: string
  status: AgentStatus
  detail: string
  elapsed: string
}

export interface StrategyCandidate {
  id: string
  name: string
  status: CandidateStatus
  note: string
  returnPct: number
  drawdownPct: number
  sharpe: number
  signal: string
}

export interface FirewallRule {
  label: string
  limit: string
  current: string
  state: 'pass' | 'locked'
}

export interface TimelineEvent {
  time: string
  title: string
  detail: string
  tone: 'neutral' | 'warning' | 'success'
}

export type TaskPhase =
  | 'created'
  | 'researching'
  | 'strategizing'
  | 'backtesting'
  | 'risk_review'
  | 'awaiting_approval'
  | 'approved'
  | 'executing'
  | 'executed'
  | 'failed'

export interface TaskExecution {
  state: 'ready' | 'signing' | 'executed'
  network: 'Injective Testnet'
  transactionHash?: string
}

export interface TaskSnapshot {
  id: string
  missionId: string
  objective: string
  phase: TaskPhase
  agents: AgentRun[]
  candidates: StrategyCandidate[]
  firewallRules: FirewallRule[]
  timeline: TimelineEvent[]
  execution: TaskExecution
  createdAt: string
  updatedAt: string
}

export interface CreateTaskInput {
  objective: string
  budgetUsdt: number
  maxLossPct: number
  maxAssetPct: number
  asset: 'ETH'
}

export interface TaskStreamEvent {
  type: 'task.snapshot'
  snapshot: TaskSnapshot
}
