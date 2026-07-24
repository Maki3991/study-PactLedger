export type PactLedgerAppId = 'kaleidox' | 'poolmate'

export type AgentPaymentPurpose =
  | 'research'
  | 'backtest'
  | 'risk_review'
  | 'execution'
  | 'merchant_pay'
  | 'refund'

export type AgentPaymentProtocol = 'internal' | 'x402' | 'acp' | 'ap2'

export type AgentPaymentStatus =
  | 'submitted'
  | 'policy_rejected'
  | 'approval_required'
  | 'approved'
  | 'settling'
  | 'confirmed'
  | 'failed'

export type PolicyOutcome = 'approved' | 'rejected' | 'approval_required'
export type SettlementMode = 'mock' | 'testnet'
export type SettlementStatus = 'confirmed' | 'failed'

export interface AgentPaymentIntent {
  id: string
  tenantId: string
  appId: PactLedgerAppId
  payerAgentId: string
  payeeId: string
  payeeAddress?: string
  amount: number
  currency: string
  amountAtomic?: string
  denom?: string
  purpose: AgentPaymentPurpose
  protocol: AgentPaymentProtocol
  status: AgentPaymentStatus
  expiresAt: string
  metadataHash: string
  createdAt: string
}

export interface PolicyCheck {
  code: string
  label: string
  passed: boolean
  detail: string
}

export interface PolicyDecision {
  id: string
  intentId: string
  policyId: string
  outcome: PolicyOutcome
  code: string
  reason: string
  checks: PolicyCheck[]
  evaluatedAt: string
}

export interface SettlementReceipt {
  intentId: string
  mode: SettlementMode
  network: 'Mock' | 'Injective Testnet'
  status: SettlementStatus
  amountAtomic?: string
  denom?: string
  transactionHash?: string
  explorerUrl?: string
  blockHeight?: string
  txCode?: number
  gasUsed?: number
  errorCode?: string
  error?: string
  retryable?: boolean
  confirmedAt: string
}

export interface PactLedgerTrace {
  intent: AgentPaymentIntent
  decision: PolicyDecision
  receipt?: SettlementReceipt
}

export interface PactLedgerPolicy {
  id: string
  appId: PactLedgerAppId
  budgetLimit: number
  maxSinglePayment: number
  approvalThreshold: number
  allowedPayees: string[]
  allowedPurposes: AgentPaymentPurpose[]
}

export type PactLedgerExecutionState =
  | 'mock_ready'
  | 'testnet_configuration_required'
  | 'testnet_ready'
  | 'testnet_confirmed'

export interface PactLedgerBaseStatus {
  product: 'PactLedger'
  category: 'Agent Treasury / Agent Spend Control'
  flow: ['Agent Intent', 'PactLedger Policy', 'Injective Settlement', 'Verifiable Receipt']
  execution: {
    mode: SettlementMode
    state: PactLedgerExecutionState
    network: 'Mock' | 'Injective Testnet'
    chainId: string
    adapter: 'mock' | 'injective-testnet'
    walletConfigured: boolean
    paymentAssetConfigured: boolean
    payeesConfigured: boolean
    receiptPersistence: 'postgresql' | 'memory'
    latestConfirmedReceipt?: Pick<
      SettlementReceipt,
      'intentId' | 'transactionHash' | 'explorerUrl' | 'blockHeight' | 'confirmedAt'
    >
  }
  proofCases: Array<{
    appId: PactLedgerAppId
    role: 'risk-pressure-test' | 'cross-domain-reuse'
    endpoint: string
  }>
}
