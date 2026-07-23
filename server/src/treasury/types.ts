// Treasury types – tenant-agnostic, no trading/poolmate semantics

export interface TreasuryAccount {
  id: string
  tenantId: string
  agentId: string
  agentName: string
  balance: number
  allocated: number
  spent: number
  earned: number
  currency: string
  createdAt: string
  updatedAt: string
}

export interface SpendingPolicy {
  tenantId: string
  agentId: string
  maxSingle: number     // max USDT per transaction
  dailyLimit: number    // max USDT per calendar day
  whitelist: string[]   // allowed recipient agent IDs (empty = any)
  assetWhitelist: string[]
}

export interface TreasuryTx {
  id: string
  tenantId: string
  fromAgent: string | null
  toAgent: string | null
  amount: number
  currency: string
  purpose: string
  protocol: 'internal' | 'x402' | 'acp' | 'ap2'
  status: 'completed' | 'rejected'
  rejectReason?: string
  injTxHash?: string
  createdAt: string
}

export interface TransferRequest {
  tenantId: string
  fromAgent: string
  toAgent: string
  amount: number
  purpose: string
  protocol?: TreasuryTx['protocol']
}

export interface TransferResult {
  ok: boolean
  txId: string
  rejectReason?: string
  fromBalance?: number
  toBalance?: number
}

export interface AllocationPlan {
  agentId: string
  agentName: string
  amount: number
  policy: Omit<SpendingPolicy, 'tenantId' | 'agentId'>
}
