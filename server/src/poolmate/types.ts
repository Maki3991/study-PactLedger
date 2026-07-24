export type SessionStatus = 'collecting' | 'funded' | 'ordering' | 'completed' | 'cancelled'
export type MemberStatus  = 'pending' | 'paid' | 'refunded'

export interface PoolSession {
  id: string
  chatId: number
  creatorId: number
  creatorName: string
  product: string
  priceEach: number
  slotsTotal: number
  slotsFilled: number
  status: SessionStatus
  merchantOrderId?: string
  txHash?: string
  messageId?: number
  deadline?: Date
  createdAt: Date
}

export interface PoolMember {
  id: number
  sessionId: string
  userId: number
  username: string
  slots: number
  amount: number
  status: MemberStatus
  joinedAt: Date
}

export interface ParsedPin {
  product: string
  priceEach: number
  slotsTotal: number
}
