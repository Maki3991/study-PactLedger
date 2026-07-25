import { createHash, randomUUID } from 'node:crypto'
import type { PactLedgerTrace } from '../../src/domain/pactledger.js'
import { createAgentPaymentIntent } from '../pactledger/intents.js'
import { PactLedgerService } from '../pactledger/service.js'
import { ActivePoolMateSessionError, PoolMateRepository } from './repository.js'
import type {
  ParsedPoolRequest,
  PoolMateCheckoutResult,
  PoolMateMember,
  PoolMateMutationResult,
  PoolMateSession,
} from './types.js'

const SESSION_TTL_MS = 30 * 60 * 1000

export class PoolMateService {
  private readonly checkoutInFlight = new Map<string, Promise<PoolMateCheckoutResult>>()

  constructor(
    private readonly repository: PoolMateRepository,
    private readonly ledger: PactLedgerService,
  ) {}

  async createSession(
    chatId: number,
    creatorId: number,
    creatorName: string,
    request: ParsedPoolRequest,
  ): Promise<PoolMateSession> {
    validateRequest(request)
    const existing = await this.repository.findActiveSession(chatId)
    if (existing) throw new PoolMateServiceError('ACTIVE_SESSION_EXISTS', `群内已有进行中的拼单 #${existing.id}`)
    try {
      return await this.repository.createSession({
        id: randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase(),
        chatId,
        creatorId,
        creatorName: creatorName.trim().slice(0, 80) || `用户${creatorId}`,
        product: request.product.trim().slice(0, 80),
        priceEach: request.priceEach,
        slotsTotal: request.slotsTotal,
        deadline: new Date(Date.now() + SESSION_TTL_MS),
      })
    } catch (error) {
      if (error instanceof ActivePoolMateSessionError) {
        throw new PoolMateServiceError('ACTIVE_SESSION_EXISTS', error.message)
      }
      throw error
    }
  }

  getActiveSession(chatId: number): Promise<PoolMateSession | undefined> {
    return this.repository.findActiveSession(chatId)
  }

  getSession(sessionId: string): Promise<PoolMateSession | undefined> {
    return this.repository.findSession(sessionId)
  }

  getMembers(sessionId: string): Promise<PoolMateMember[]> {
    return this.repository.getMembers(sessionId)
  }

  setMessageId(sessionId: string, messageId: number): Promise<void> {
    return this.repository.setMessageId(sessionId, messageId)
  }

  joinSession(
    sessionId: string,
    userId: number,
    username: string,
    slots = 1,
  ): Promise<PoolMateMutationResult> {
    return this.repository.joinSession(sessionId, userId, username.trim().slice(0, 80) || `用户${userId}`, slots)
  }

  leaveSession(sessionId: string, userId: number): Promise<PoolMateMutationResult> {
    return this.repository.leaveSession(sessionId, userId)
  }

  cancelSession(sessionId: string, creatorId: number): Promise<PoolMateMutationResult> {
    return this.repository.cancelSession(sessionId, creatorId)
  }

  async lockAndCheckoutSession(
    sessionId: string,
    creatorId: number,
  ): Promise<PoolMateCheckoutResult> {
    const locked = await this.repository.lockSession(sessionId, creatorId)
    if (!locked.ok || !locked.session) {
      return {
        ok: false,
        reason: locked.reason ?? '拼单无法锁定。',
        session: locked.session,
      }
    }
    return this.checkoutSession(sessionId)
  }

  checkoutSession(sessionId: string): Promise<PoolMateCheckoutResult> {
    const pending = this.checkoutInFlight.get(sessionId)
    if (pending) return pending
    const operation = this.checkoutOnce(sessionId).finally(() => {
      this.checkoutInFlight.delete(sessionId)
    })
    this.checkoutInFlight.set(sessionId, operation)
    return operation
  }

  async evaluateUnknownPayee(chatId: number, messageId: number): Promise<PactLedgerTrace> {
    const fingerprint = createHash('sha256').update(`${chatId}:${messageId}`).digest('hex').slice(0, 12).toUpperCase()
    return this.ledger.process(createAgentPaymentIntent({
      tenantId: `poolmate-chat-${chatId}`,
      appId: 'poolmate',
      payerAgentId: 'poolmate-treasury',
      payeeId: 'random-group-member',
      amount: 89,
      currency: 'CNY-DEMO',
      purpose: 'merchant_pay',
      protocol: 'ap2',
      intentId: `PM-BLOCKED-${fingerprint}`,
      metadata: {
        source: 'telegram',
        scenario: 'unknown_payee',
      },
    }))
  }

  private async checkoutOnce(sessionId: string): Promise<PoolMateCheckoutResult> {
    const initial = await this.repository.findSession(sessionId)
    if (!initial) return { ok: false, reason: '拼单不存在' }
    const intentId = initial.intentId ?? `PM-${initial.id}-MERCHANT`

    if (initial.status === 'completed' || initial.status === 'failed' || initial.status === 'approval_required') {
      return this.replayCheckout(initial, intentId)
    }
    if (initial.status === 'settling') {
      return { ok: false, reason: '结算正在处理，系统不会重复提交付款。', session: initial }
    }
    if (initial.status !== 'funded') {
      return { ok: false, reason: '拼单尚未由发起人锁定', session: initial }
    }

    const claim = await this.repository.claimCheckout(sessionId, intentId)
    if (!claim.claimed) {
      if (claim.session?.status === 'completed' || claim.session?.status === 'failed' || claim.session?.status === 'approval_required') {
        return this.replayCheckout(claim.session, intentId)
      }
      return { ok: false, reason: '结算已由另一请求接管，系统不会重复付款。', session: claim.session }
    }
    if (!claim.session) return { ok: false, reason: '结算状态已更新，但会话无法恢复。' }

    const members = await this.repository.getMembers(sessionId)
    const amount = roundCurrency(members.reduce((total, member) => total + member.amount, 0))
    if (!amount) {
      return this.failSession(claim.session, intentId, 'EMPTY_POOL', '没有可结算的成员份额。')
    }

    const trace = await this.ledger.process(createCheckoutIntent(claim.session, intentId, amount))
    return this.persistTrace(claim.session, trace)
  }

  private async replayCheckout(session: PoolMateSession, intentId: string): Promise<PoolMateCheckoutResult> {
    const members = await this.repository.getMembers(session.id)
    const amount = roundCurrency(members.reduce((total, member) => total + member.amount, 0))
    if (!amount) return { ok: false, reason: session.failureReason ?? '没有可结算的成员份额。', session }
    const trace = await this.ledger.process(createCheckoutIntent(session, intentId, amount))
    if (session.status === 'completed' && trace.receipt?.status === 'confirmed') {
      const repaired = await this.repository.recordCheckout(session.id, {
        status: 'completed',
        intentId,
        merchantOrderId: session.merchantOrderId,
        receiptMode: trace.receipt.mode,
        receiptStatus: trace.receipt.status,
      })
      return { ok: true, session: repaired.session, trace }
    }
    return {
      ok: session.status === 'completed' && trace.receipt?.status === 'confirmed',
      reason: session.status === 'completed' ? undefined : session.failureReason ?? trace.decision.reason,
      session,
      trace,
    }
  }

  private async persistTrace(session: PoolMateSession, trace: PactLedgerTrace): Promise<PoolMateCheckoutResult> {
    if (trace.decision.outcome === 'rejected') {
      return this.failSession(session, trace.intent.id, trace.decision.code, trace.decision.reason, trace)
    }
    if (trace.decision.outcome === 'approval_required') {
      const updated = await this.repository.recordCheckout(session.id, {
        status: 'approval_required',
        intentId: trace.intent.id,
        failureCode: trace.decision.code,
        failureReason: trace.decision.reason,
      })
      return { ok: false, reason: trace.decision.reason, session: updated.session, trace }
    }
    if (!trace.receipt || trace.receipt.status !== 'confirmed') {
      return this.failSession(
        session,
        trace.intent.id,
        trace.receipt?.errorCode ?? 'SETTLEMENT_FAILED',
        trace.receipt?.error ?? '结算未返回确认 Receipt。',
        trace,
      )
    }
    const updated = await this.repository.recordCheckout(session.id, {
      status: 'completed',
      intentId: trace.intent.id,
      merchantOrderId: `DEMO-ORDER-${session.id}`,
      receiptMode: trace.receipt.mode,
      receiptStatus: trace.receipt.status,
    })
    return { ok: true, session: updated.session, trace }
  }

  private async failSession(
    session: PoolMateSession | undefined,
    intentId: string,
    code: string,
    reason: string,
    trace?: PactLedgerTrace,
  ): Promise<PoolMateCheckoutResult> {
    if (!session) return { ok: false, reason, trace }
    const updated = await this.repository.recordCheckout(session.id, {
      status: 'failed',
      intentId,
      receiptMode: trace?.receipt?.mode,
      receiptStatus: trace?.receipt?.status,
      failureCode: code,
      failureReason: reason,
    })
    return { ok: false, reason, session: updated.session, trace }
  }
}

export class PoolMateServiceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'PoolMateServiceError'
  }
}

export function parsePoolRequest(text: string): ParsedPoolRequest | undefined {
  const normalized = text
    .replace(/@[A-Za-z0-9_]+/gu, '')
    .replaceAll('，', ',')
    .trim()
  const priceMatch = normalized.match(/(?:每|一)[\p{L}箱个件份盒斤]*\s*(\d+(?:\.\d{1,2})?)/u)
    ?? normalized.match(/(\d+(?:\.\d{1,2})?)\s*元/u)
  const slotsMatch = normalized.match(/(?:期望|需要|共)\s*(\d+)\s*(?:人|份|个|件|箱|盒|瓶|杯|包)?/u)
    ?? normalized.match(/(\d+)\s*(?:人|份)(?:\s|$)/u)
  const productMatch = normalized.match(
    /拼(?:单)?[\s,:：]*(?:期望\s*\d+\s*(?:人|份|个|件|箱|盒|瓶|杯|包)?\s*)?(.+?)(?=,|每|一[箱个件份盒斤瓶杯包]|需要|共|\d+\s*元|$)/u,
  )
  if (!priceMatch || !productMatch) return undefined
  const priceEach = Number(priceMatch[1])
  const slotsTotal = slotsMatch ? Number(slotsMatch[1]) : 3
  const product = productMatch[1].trim().replace(/[，,\s]+$/u, '')
  if (!product || !Number.isFinite(priceEach) || priceEach <= 0) return undefined
  return { product, priceEach, slotsTotal }
}

function createCheckoutIntent(session: PoolMateSession, intentId: string, amount: number) {
  return createAgentPaymentIntent({
    tenantId: `poolmate:${session.id}`,
    appId: 'poolmate',
    payerAgentId: 'poolmate-treasury',
    payeeId: 'merchant-demo',
    amount,
    currency: 'CNY-DEMO',
    purpose: 'merchant_pay',
    protocol: 'ap2',
    intentId,
    metadata: {
      source: 'telegram',
      sessionId: session.id,
      slots: session.slotsTotal,
      demoOnly: true,
      settlementMode: 'mock',
    },
  })
}

function validateRequest(request: ParsedPoolRequest): void {
  if (!request.product.trim()) throw new PoolMateServiceError('PRODUCT_REQUIRED', '商品名称不能为空')
  if (!Number.isFinite(request.priceEach) || request.priceEach <= 0 || request.priceEach > 500) {
    throw new PoolMateServiceError('INVALID_PRICE', '单价需在 0 到 500 之间')
  }
  if (!Number.isInteger(request.slotsTotal) || request.slotsTotal < 2 || request.slotsTotal > 20) {
    throw new PoolMateServiceError('INVALID_SLOTS', '份额数量需在 2 到 20 之间')
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}
