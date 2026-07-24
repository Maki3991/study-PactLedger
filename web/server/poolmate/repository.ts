import type { Pool, PoolClient } from 'pg'
import type {
  PoolMateMember,
  PoolMateMutationResult,
  PoolMateSession,
  PoolMateSessionStatus,
} from './types.js'

interface CreateSessionInput {
  id: string
  chatId: number
  creatorId: number
  creatorName: string
  product: string
  priceEach: number
  slotsTotal: number
  deadline: Date
}

interface SessionRow {
  id: string
  chat_id: string | number
  creator_id: string | number
  creator_name: string
  product: string
  price_each: string | number
  slots_total: string | number
  slots_filled: string | number
  status: PoolMateSessionStatus
  intent_id?: string | null
  merchant_order_id?: string | null
  receipt_mode?: PoolMateSession['receiptMode'] | null
  receipt_status?: PoolMateSession['receiptStatus'] | null
  message_id?: string | number | null
  failure_code?: string | null
  failure_reason?: string | null
  deadline?: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

interface MemberRow {
  id: string | number
  session_id: string
  user_id: string | number
  username: string
  slots: string | number
  amount: string | number
  status: PoolMateMember['status']
  joined_at: Date | string
}

export class ActivePoolMateSessionError extends Error {
  constructor(readonly sessionId: string) {
    super(`群内已有进行中的拼单 #${sessionId}`)
    this.name = 'ActivePoolMateSessionError'
  }
}

export class PoolMateRepository {
  private readonly sessions = new Map<string, PoolMateSession>()
  private readonly members = new Map<string, Map<number, PoolMateMember>>()
  private memberSequence = 0

  constructor(private readonly pool?: Pool) {}

  get hasPersistentStorage(): boolean {
    return Boolean(this.pool)
  }

  async initialize(): Promise<void> {
    if (!this.pool) return
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS poolmate_sessions (
        id TEXT PRIMARY KEY,
        chat_id BIGINT NOT NULL,
        creator_id BIGINT NOT NULL,
        creator_name TEXT NOT NULL,
        product TEXT NOT NULL,
        price_each NUMERIC(12,2) NOT NULL,
        slots_total INT NOT NULL,
        slots_filled INT NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'collecting',
        merchant_order_id TEXT,
        message_id BIGINT,
        deadline TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE poolmate_sessions ADD COLUMN IF NOT EXISTS intent_id TEXT;
      ALTER TABLE poolmate_sessions ADD COLUMN IF NOT EXISTS receipt_mode TEXT;
      ALTER TABLE poolmate_sessions ADD COLUMN IF NOT EXISTS receipt_status TEXT;
      ALTER TABLE poolmate_sessions ADD COLUMN IF NOT EXISTS failure_code TEXT;
      ALTER TABLE poolmate_sessions ADD COLUMN IF NOT EXISTS failure_reason TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS poolmate_sessions_intent_idx
        ON poolmate_sessions (intent_id) WHERE intent_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS poolmate_sessions_chat_idx
        ON poolmate_sessions (chat_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS poolmate_members (
        id BIGSERIAL PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES poolmate_sessions(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL,
        username TEXT NOT NULL,
        slots INT NOT NULL DEFAULT 1,
        amount NUMERIC(12,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (session_id, user_id)
      );
    `)
  }

  async createSession(input: CreateSessionInput): Promise<PoolMateSession> {
    const now = new Date()
    if (!this.pool) {
      const active = [...this.sessions.values()].find((session) => session.chatId === input.chatId && isActive(session.status))
      if (active) throw new ActivePoolMateSessionError(active.id)
      const session: PoolMateSession = {
        ...input,
        slotsFilled: 0,
        status: 'collecting',
        createdAt: now,
        updatedAt: now,
      }
      this.sessions.set(session.id, cloneSession(session))
      return cloneSession(session)
    }
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [input.chatId])
      await client.query(`
        UPDATE poolmate_sessions
        SET status = 'cancelled', updated_at = NOW(), failure_code = 'SESSION_EXPIRED',
            failure_reason = '拼单已超过截止时间。'
        WHERE chat_id = $1 AND status IN ('collecting', 'funded') AND deadline <= NOW()
      `, [input.chatId])
      const active = await client.query<{ id: string }>(`
        SELECT id FROM poolmate_sessions
        WHERE chat_id = $1 AND status IN ('collecting', 'funded', 'settling', 'approval_required')
        LIMIT 1
      `, [input.chatId])
      if (active.rows[0]) throw new ActivePoolMateSessionError(active.rows[0].id)
      const result = await client.query<SessionRow>(`
        INSERT INTO poolmate_sessions
          (id, chat_id, creator_id, creator_name, product, price_each, slots_total, deadline)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        input.id,
        input.chatId,
        input.creatorId,
        input.creatorName,
        input.product,
        input.priceEach,
        input.slotsTotal,
        input.deadline,
      ])
      await client.query('COMMIT')
      return rowToSession(result.rows[0])
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async findSession(id: string): Promise<PoolMateSession | undefined> {
    if (!this.pool) {
      const session = this.sessions.get(id)
      return session ? cloneSession(session) : undefined
    }
    const result = await this.pool.query<SessionRow>('SELECT * FROM poolmate_sessions WHERE id = $1', [id])
    return result.rows[0] ? rowToSession(result.rows[0]) : undefined
  }

  async findActiveSession(chatId: number): Promise<PoolMateSession | undefined> {
    const now = new Date()
    if (!this.pool) {
      for (const session of this.sessions.values()) {
        if (session.chatId === chatId && isActive(session.status) && session.deadline <= now) {
          session.status = 'cancelled'
          session.updatedAt = now
        }
      }
      const active = [...this.sessions.values()]
        .filter((session) => session.chatId === chatId && isActive(session.status))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
      return active ? cloneSession(active) : undefined
    }
    await this.pool.query(`
      UPDATE poolmate_sessions
      SET status = 'cancelled', updated_at = NOW(), failure_code = 'SESSION_EXPIRED',
          failure_reason = '拼单已超过截止时间。'
      WHERE chat_id = $1 AND status IN ('collecting', 'funded') AND deadline <= NOW()
    `, [chatId])
    const result = await this.pool.query<SessionRow>(`
      SELECT * FROM poolmate_sessions
      WHERE chat_id = $1 AND status IN ('collecting', 'funded', 'settling', 'approval_required')
      ORDER BY created_at DESC
      LIMIT 1
    `, [chatId])
    return result.rows[0] ? rowToSession(result.rows[0]) : undefined
  }

  async getMembers(sessionId: string): Promise<PoolMateMember[]> {
    if (!this.pool) {
      return [...(this.members.get(sessionId)?.values() ?? [])]
        .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
        .map(cloneMember)
    }
    const result = await this.pool.query<MemberRow>(
      'SELECT * FROM poolmate_members WHERE session_id = $1 ORDER BY joined_at',
      [sessionId],
    )
    return result.rows.map(rowToMember)
  }

  async setMessageId(sessionId: string, messageId: number): Promise<void> {
    if (!this.pool) {
      const session = this.sessions.get(sessionId)
      if (session) {
        session.messageId = messageId
        session.updatedAt = new Date()
      }
      return
    }
    await this.pool.query(
      'UPDATE poolmate_sessions SET message_id = $2, updated_at = NOW() WHERE id = $1',
      [sessionId, messageId],
    )
  }

  async joinSession(
    sessionId: string,
    userId: number,
    username: string,
    slots: number,
  ): Promise<PoolMateMutationResult> {
    if (!this.pool) return this.joinMemory(sessionId, userId, username, slots)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const session = await selectSessionForUpdate(client, sessionId)
      if (!session) return rollback(client, '拼单不存在')
      if (session.status !== 'collecting') return rollback(client, '拼单已停止收集份额', session)
      if (session.deadline <= new Date()) return rollback(client, '拼单已超过截止时间', session)
      if (!Number.isInteger(slots) || slots < 1) return rollback(client, '份额必须是正整数', session)
      if (session.slotsFilled + slots > session.slotsTotal) return rollback(client, '剩余份额不足', session)
      const existing = await client.query('SELECT 1 FROM poolmate_members WHERE session_id = $1 AND user_id = $2', [sessionId, userId])
      if (existing.rowCount) return rollback(client, '你已经加入该拼单', session)

      await client.query(`
        INSERT INTO poolmate_members (session_id, user_id, username, slots, amount)
        VALUES ($1, $2, $3, $4, $5)
      `, [sessionId, userId, username, slots, slots * session.priceEach])
      const nextFilled = session.slotsFilled + slots
      const nextStatus: PoolMateSessionStatus = nextFilled >= session.slotsTotal ? 'funded' : 'collecting'
      const updated = await client.query<SessionRow>(`
        UPDATE poolmate_sessions
        SET slots_filled = $2, status = $3, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [sessionId, nextFilled, nextStatus])
      await client.query('COMMIT')
      return { ok: true, session: rowToSession(updated.rows[0]) }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async leaveSession(sessionId: string, userId: number): Promise<PoolMateMutationResult> {
    if (!this.pool) return this.leaveMemory(sessionId, userId)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const session = await selectSessionForUpdate(client, sessionId)
      if (!session) return rollback(client, '拼单不存在')
      if (session.status !== 'collecting') return rollback(client, '拼单已经锁定，无法退出', session)
      if (session.creatorId === userId) return rollback(client, '发起人不能退出，可以取消拼单', session)
      const removed = await client.query<{ slots: number | string }>(`
        DELETE FROM poolmate_members
        WHERE session_id = $1 AND user_id = $2
        RETURNING slots
      `, [sessionId, userId])
      if (!removed.rows[0]) return rollback(client, '你尚未加入该拼单', session)
      const nextFilled = Math.max(0, session.slotsFilled - Number(removed.rows[0].slots))
      const updated = await client.query<SessionRow>(`
        UPDATE poolmate_sessions
        SET slots_filled = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [sessionId, nextFilled])
      await client.query('COMMIT')
      return { ok: true, session: rowToSession(updated.rows[0]) }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async cancelSession(sessionId: string, creatorId: number): Promise<PoolMateMutationResult> {
    if (!this.pool) {
      const session = this.sessions.get(sessionId)
      if (!session) return { ok: false, reason: '拼单不存在' }
      if (session.creatorId !== creatorId) return { ok: false, reason: '只有发起人可以取消拼单', session: cloneSession(session) }
      if (!['collecting', 'funded', 'approval_required'].includes(session.status)) {
        return { ok: false, reason: '当前状态不能取消', session: cloneSession(session) }
      }
      session.status = 'cancelled'
      session.failureCode = 'CANCELLED_BY_CREATOR'
      session.failureReason = '发起人取消了拼单。'
      session.updatedAt = new Date()
      return { ok: true, session: cloneSession(session) }
    }
    const result = await this.pool.query<SessionRow>(`
      UPDATE poolmate_sessions
      SET status = 'cancelled', failure_code = 'CANCELLED_BY_CREATOR',
          failure_reason = '发起人取消了拼单。', updated_at = NOW()
      WHERE id = $1 AND creator_id = $2 AND status IN ('collecting', 'funded', 'approval_required')
      RETURNING *
    `, [sessionId, creatorId])
    if (result.rows[0]) return { ok: true, session: rowToSession(result.rows[0]) }
    const session = await this.findSession(sessionId)
    if (!session) return { ok: false, reason: '拼单不存在' }
    return {
      ok: false,
      reason: session.creatorId !== creatorId ? '只有发起人可以取消拼单' : '当前状态不能取消',
      session,
    }
  }

  async claimCheckout(sessionId: string, intentId: string): Promise<{ claimed: boolean; session?: PoolMateSession }> {
    if (!this.pool) {
      const session = this.sessions.get(sessionId)
      if (!session || session.status !== 'funded') return { claimed: false, session: session ? cloneSession(session) : undefined }
      session.status = 'settling'
      session.intentId = intentId
      session.updatedAt = new Date()
      return { claimed: true, session: cloneSession(session) }
    }
    const result = await this.pool.query<SessionRow>(`
      UPDATE poolmate_sessions
      SET status = 'settling', intent_id = $2, updated_at = NOW(),
          failure_code = NULL, failure_reason = NULL
      WHERE id = $1 AND status = 'funded' AND (intent_id IS NULL OR intent_id = $2)
      RETURNING *
    `, [sessionId, intentId])
    if (result.rows[0]) return { claimed: true, session: rowToSession(result.rows[0]) }
    return { claimed: false, session: await this.findSession(sessionId) }
  }

  async recordCheckout(
    sessionId: string,
    update: {
      status: Extract<PoolMateSessionStatus, 'approval_required' | 'completed' | 'failed'>
      intentId: string
      merchantOrderId?: string
      receiptMode?: PoolMateSession['receiptMode']
      receiptStatus?: PoolMateSession['receiptStatus']
      failureCode?: string
      failureReason?: string
    },
  ): Promise<PoolMateMutationResult> {
    if (!this.pool) {
      const session = this.sessions.get(sessionId)
      if (!session) return { ok: false, reason: '拼单不存在' }
      Object.assign(session, update, { updatedAt: new Date() })
      if (update.status === 'completed') {
        for (const member of this.members.get(sessionId)?.values() ?? []) member.status = 'paid'
      }
      return { ok: true, session: cloneSession(session) }
    }
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<SessionRow>(`
        UPDATE poolmate_sessions
        SET status = $2,
            intent_id = $3,
            merchant_order_id = COALESCE($4, merchant_order_id),
            receipt_mode = $5,
            receipt_status = $6,
            failure_code = $7,
            failure_reason = $8,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [
        sessionId,
        update.status,
        update.intentId,
        update.merchantOrderId ?? null,
        update.receiptMode ?? null,
        update.receiptStatus ?? null,
        update.failureCode ?? null,
        update.failureReason ?? null,
      ])
      if (update.status === 'completed' && result.rows[0]) {
        await client.query("UPDATE poolmate_members SET status = 'paid' WHERE session_id = $1", [sessionId])
      }
      await client.query('COMMIT')
      return result.rows[0]
        ? { ok: true, session: rowToSession(result.rows[0]) }
        : { ok: false, reason: '拼单不存在' }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private joinMemory(sessionId: string, userId: number, username: string, slots: number): PoolMateMutationResult {
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: false, reason: '拼单不存在' }
    if (session.status !== 'collecting') return { ok: false, reason: '拼单已停止收集份额', session: cloneSession(session) }
    if (session.deadline <= new Date()) return { ok: false, reason: '拼单已超过截止时间', session: cloneSession(session) }
    if (!Number.isInteger(slots) || slots < 1) return { ok: false, reason: '份额必须是正整数', session: cloneSession(session) }
    if (session.slotsFilled + slots > session.slotsTotal) return { ok: false, reason: '剩余份额不足', session: cloneSession(session) }
    const sessionMembers = this.members.get(sessionId) ?? new Map<number, PoolMateMember>()
    if (sessionMembers.has(userId)) return { ok: false, reason: '你已经加入该拼单', session: cloneSession(session) }
    this.memberSequence += 1
    sessionMembers.set(userId, {
      id: this.memberSequence,
      sessionId,
      userId,
      username,
      slots,
      amount: slots * session.priceEach,
      status: 'pending',
      joinedAt: new Date(),
    })
    this.members.set(sessionId, sessionMembers)
    session.slotsFilled += slots
    if (session.slotsFilled >= session.slotsTotal) session.status = 'funded'
    session.updatedAt = new Date()
    return { ok: true, session: cloneSession(session) }
  }

  private leaveMemory(sessionId: string, userId: number): PoolMateMutationResult {
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: false, reason: '拼单不存在' }
    if (session.status !== 'collecting') return { ok: false, reason: '拼单已经锁定，无法退出', session: cloneSession(session) }
    if (session.creatorId === userId) return { ok: false, reason: '发起人不能退出，可以取消拼单', session: cloneSession(session) }
    const member = this.members.get(sessionId)?.get(userId)
    if (!member) return { ok: false, reason: '你尚未加入该拼单', session: cloneSession(session) }
    this.members.get(sessionId)?.delete(userId)
    session.slotsFilled = Math.max(0, session.slotsFilled - member.slots)
    session.updatedAt = new Date()
    return { ok: true, session: cloneSession(session) }
  }
}

async function selectSessionForUpdate(client: PoolClient, sessionId: string): Promise<PoolMateSession | undefined> {
  const result = await client.query<SessionRow>('SELECT * FROM poolmate_sessions WHERE id = $1 FOR UPDATE', [sessionId])
  return result.rows[0] ? rowToSession(result.rows[0]) : undefined
}

async function rollback(
  client: PoolClient,
  reason: string,
  session?: PoolMateSession,
): Promise<PoolMateMutationResult> {
  await client.query('ROLLBACK')
  return { ok: false, reason, session }
}

function isActive(status: PoolMateSessionStatus): boolean {
  return ['collecting', 'funded', 'settling', 'approval_required'].includes(status)
}

function rowToSession(row: SessionRow): PoolMateSession {
  const createdAt = new Date(row.created_at)
  return {
    id: row.id,
    chatId: Number(row.chat_id),
    creatorId: Number(row.creator_id),
    creatorName: row.creator_name,
    product: row.product,
    priceEach: Number(row.price_each),
    slotsTotal: Number(row.slots_total),
    slotsFilled: Number(row.slots_filled),
    status: row.status,
    intentId: row.intent_id ?? undefined,
    merchantOrderId: row.merchant_order_id ?? undefined,
    receiptMode: row.receipt_mode ?? undefined,
    receiptStatus: row.receipt_status ?? undefined,
    messageId: row.message_id == null ? undefined : Number(row.message_id),
    failureCode: row.failure_code ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    deadline: row.deadline ? new Date(row.deadline) : new Date(createdAt.getTime() + 30 * 60 * 1000),
    createdAt,
    updatedAt: new Date(row.updated_at),
  }
}

function rowToMember(row: MemberRow): PoolMateMember {
  return {
    id: Number(row.id),
    sessionId: row.session_id,
    userId: Number(row.user_id),
    username: row.username,
    slots: Number(row.slots),
    amount: Number(row.amount),
    status: row.status,
    joinedAt: new Date(row.joined_at),
  }
}

function cloneSession(session: PoolMateSession): PoolMateSession {
  return structuredClone(session)
}

function cloneMember(member: PoolMateMember): PoolMateMember {
  return structuredClone(member)
}
