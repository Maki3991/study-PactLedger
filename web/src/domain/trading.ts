import type { PactLedgerTrace } from './pactledger.js'

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
  winRate: number
  volatility: number
  oosReturn: number
  trades: number
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
  network: 'Mock' | 'Injective Testnet'
  transactionHash?: string
}

export interface QuantEvidence {
  provider: 'panda-data' | 'replay'
  configured: boolean
  sourceMethod: 'get_stock_daily_pre' | 'deterministic_replay'
  sdkVersion: '0.0.12'
  adjustment: 'pre-adjusted' | 'synthetic'
  skill: 'QuantSkills/pandadata-api'
  symbol: string
  startDate: string
  endDate: string
  barCount: number
  fetchedAt: string
  note: string
}

export type IntentStatus =
  | 'submitted'
  | 'policy_rejected'
  | 'awaiting_approval'
  | 'approved'
  | 'executing'
  | 'executed'
  | 'failed'

export interface ActionIntent {
  id: string
  appId: 'kaleidox'
  agentId: 'execution'
  action: 'stock_trade'
  symbol: string
  side: 'buy' | 'sell'
  notional: number
  currency: 'USDT'
  protocolTag: 'investment'
  strategyVersion: string
  status: IntentStatus
  policyReason?: string
  createdAt: string
}

export interface TaskSnapshot {
  id: string
  missionId: string
  ownerId?: string
  objective: string
  phase: TaskPhase
  agents: AgentRun[]
  candidates: StrategyCandidate[]
  firewallRules: FirewallRule[]
  timeline: TimelineEvent[]
  quantEvidence?: QuantEvidence
  researchSummary?: string
  actionIntent?: ActionIntent
  paymentTraces: PactLedgerTrace[]
  execution: TaskExecution
  createdAt: string
  updatedAt: string
}

export interface CreateTaskInput {
  objective: string
  budgetUsdt: number
  maxLossPct: number
  maxAssetPct: number
  asset: string
  startDate?: string
  endDate?: string
}

export interface TaskStreamEvent {
  type: 'task.snapshot'
  snapshot: TaskSnapshot
}

export interface InjectiveConfigStatus {
  mode: 'mock' | 'testnet'
  network: 'testnet'
  chainId: string
  adapter: 'mock' | 'injective-testnet'
  executionState: 'mock_ready' | 'testnet_configuration_required' | 'testnet_ready'
  readyForExecution: boolean
  credentialsConfigured: boolean
  paymentAssetConfigured: boolean
  payeesConfigured: boolean
  walletAddress?: string
  paymentDenom?: string
  paymentDecimals?: number
  explorerTxBaseUrl: string
  payees: {
    risk: boolean
    execution: boolean
    poolmateMerchant: boolean
  }
  endpoints: {
    rpc: string
    rest: string
    grpc: string
    indexer: string
  }
  missing: string[]
}

export interface PandaConfigStatus {
  mode: 'auto' | 'panda' | 'replay'
  provider: 'panda-data' | 'replay'
  ready: boolean
  credentialsConfigured: boolean
  pythonExecutable: string
  defaultSymbol: string
  sourceMethod: 'get_stock_daily_pre'
  sdkVersion: '0.0.12'
  skill: 'QuantSkills/pandadata-api'
  missing: string[]
}

export interface PandaModelStatus {
  provider: 'deepseek' | 'ark' | 'template'
  configured: boolean
  endpointId: string
  baseUrl: string
  missing: string[]
}
