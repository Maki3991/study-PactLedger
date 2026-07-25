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

export interface ResearchPriceBar {
  date: string
  close: number
  volume: number
}

export interface ResearchDataSourceEvidence {
  method: 'get_stock_daily_pre' | 'get_stock_detail' | 'get_stock_industry' | 'get_index_daily'
  status: 'used' | 'empty' | 'unavailable' | 'skipped'
  recordCount: number
  note?: string
}

export interface ResearchStockProfile {
  symbol: string
  name: string
  status?: number
  boardType?: string
  specialType?: string
  listedDate?: string
  deListedDate?: string
  minOrderAmount?: number
}

export interface ResearchIndustryContext {
  code: string
  name: string
  level: 'L1'
}

export interface ResearchBenchmarkContext {
  symbol: string
  bars: ResearchPriceBar[]
  alignedBarCount: number
  assetReturnPct: number
  benchmarkReturnPct: number
  excessReturnPct: number
  correlation?: number
  beta?: number
}

export interface ResearchMarketContext {
  stockProfile?: ResearchStockProfile
  industry?: ResearchIndustryContext
  benchmark?: ResearchBenchmarkContext
  sources: ResearchDataSourceEvidence[]
}

export interface KnowledgeReference {
  id: string
  symbol: string
  date: string
  marketRegime: string
  selectedStrategy: string
  createdAt: string
}

export interface AgentEvolutionSnapshot {
  agentId: 'evolution'
  agentName: 'Evolution Agent'
  iterationId: string
  outcome: 'baseline_created' | 'champion_promoted' | 'champion_retained'
  previousChampion?: {
    decisionId: string
    strategy: string
    date: string
  }
  champion: {
    strategyId: string
    name: string
    signal: string
    returnPct: number
    drawdownPct: number
    sharpe: number
    winRate: number
  }
  inputs: {
    marketBars: number
    knowledgeRecords: number
    candidateCount: number
  }
  referencedDecisionIds: string[]
  archive: {
    status: 'knowledge_base' | 'task_snapshot_only'
    decisionId?: string
    note: string
  }
  reason: string
  completedAt: string
}

export interface ResearchArtifacts {
  marketData: ResearchPriceBar[]
  marketContext?: ResearchMarketContext
  knowledgeBase: {
    status: 'used' | 'empty' | 'skipped' | 'unavailable'
    lookbackDays: number
    records: KnowledgeReference[]
    note: string
  }
  analysis: {
    mode: 'decision-agent' | 'deterministic'
    marketRegime: string
    proposals: StrategyProposal[]
    evaluation: string
  }
  evolution?: AgentEvolutionSnapshot
}

export interface CompletedResearchArtifacts extends ResearchArtifacts {
  evolution: AgentEvolutionSnapshot
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
  researchArtifacts?: ResearchArtifacts
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

// ── Decision Agent Types ──

/** AI 生成的策略提案（来自 DeepSeek） */
export interface StrategyProposal {
  id: string
  name: string
  description: string
  entryRules: string
  exitRules: string
  positionLogic: string
  confidence: number
  rationale: string
  marketRegime: string
}

/** 决策记录——Agent 记忆的基本单元 */
export interface DecisionRecord {
  id: string
  taskId: string
  symbol: string
  date: string
  marketRegime: string
  proposals: StrategyProposal[]
  selectedStrategy: string
  evidence: QuantEvidence
  createdAt: string
}

/** 传递给 AI 的决策上下文 */
export interface DecisionContext {
  symbol: string
  dateRange: { start: string; end: string }
  barCount: number
  priceSummary: {
    start: number
    end: number
    min: number
    max: number
    volatility: number
  }
  constraints: {
    maxLossPct: number
    maxAssetPct: number
    budget: number
  }
  marketContext?: ResearchMarketContext
  historicalContext?: string
}

export interface StockRecommendation {
  symbol: string
  name: string
  score: number
  indexWeight?: number
  rationale: string
  metrics: {
    close?: number
    closeDate?: string
    relativeReturn13w?: number
    relativeReturn26w?: number
    beta?: number
    averageDailyValue3m?: number
    analystPositiveRatio?: number
    analystCount?: number
  }
}

export interface StockRecommendationResult {
  provider: 'panda-data'
  benchmarkSymbol: string
  universeSize: number
  generatedAt: string
  analysisMode: 'evidence-ranking' | 'evidence-ranking+deepseek'
  modelSummary: string
  recommendations: StockRecommendation[]
  sources: Array<{
    method: 'get_index_weights' | 'get_stock_detail' | 'get_stock_daily_pre' | 'get_index_daily'
    status: 'used' | 'empty' | 'unavailable'
    recordCount: number
    note?: string
  }>
  disclaimer: string
}
