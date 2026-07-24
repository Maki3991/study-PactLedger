import type {
  PactLedgerTrace,
  SettlementMode,
  SettlementStatus,
} from '../../src/domain/pactledger.js'

export type PoolMateSessionStatus =
  | 'collecting'
  | 'funded'
  | 'settling'
  | 'approval_required'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type PoolMateMemberStatus = 'pending' | 'paid' | 'refunded'

export interface PoolMateSession {
  id: string
  chatId: number
  creatorId: number
  creatorName: string
  product: string
  priceEach: number
  slotsTotal: number
  slotsFilled: number
  status: PoolMateSessionStatus
  intentId?: string
  merchantOrderId?: string
  receiptMode?: SettlementMode
  receiptStatus?: SettlementStatus
  messageId?: number
  failureCode?: string
  failureReason?: string
  deadline: Date
  createdAt: Date
  updatedAt: Date
}

export interface PoolMateMember {
  id: number
  sessionId: string
  userId: number
  username: string
  slots: number
  amount: number
  status: PoolMateMemberStatus
  joinedAt: Date
}

export interface ParsedPoolRequest {
  product: string
  priceEach: number
  slotsTotal: number
}

export interface PoolMateMutationResult {
  ok: boolean
  reason?: string
  session?: PoolMateSession
}

export interface PoolMateCheckoutResult extends PoolMateMutationResult {
  trace?: PactLedgerTrace
}

export interface PoolMateBotStatus {
  ok: boolean
  configured: boolean
  running: boolean
  settlementMode: 'mock'
  username?: string
  firstName?: string
  inviteUrl?: string
  reasonCode?: 'BOT_NOT_CONFIGURED' | 'BOT_NOT_STARTED' | 'BOT_UNREACHABLE' | 'BOT_POLLING_STOPPED'
}
