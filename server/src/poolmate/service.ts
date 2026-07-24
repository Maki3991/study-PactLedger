import { v4 as uuidv4 } from 'uuid'
import { pool } from '../db/pool'
import * as treasury from '../treasury/service'
import { checkout, matchItem } from './merchant'
import type { ParsedPin, PoolMember, PoolSession, SessionStatus } from './types'

// ── natural language parser ───────────────────────────────────────────────────

export function parsePin(text: string): ParsedPin | null {
  // Patterns: "拼三箱杨梅,一箱89" | "拼杨梅 每箱89 需要3人" | "拼 杨梅 89 3份"
  const priceMatch = text.match(/[，,]?\s*[每一][\w箱个件份盒斤]+\s*?(\d+(?:\.\d+)?)/) ??
                     text.match(/(\d+(?:\.\d+)?)\s*元/)
  const slotMatch  = text.match(/(\d+)\s*[人份个件箱盒]/) ??
                     text.match(/[需要共]\s*(\d+)/)
  const priceNum   = priceMatch ? parseFloat(priceMatch[1]) : null
  if (!priceNum || priceNum <= 0) return null

  // extract product name: everything between 拼 and first comma/price keyword
  const productMatch = text.match(/拼\s+?(.+?)(?:[，,]|每|需要|共|\d)/) ??
                       text.match(/拼\s*(.+)/)
  const product = productMatch ? productMatch[1].trim().replace(/[，,\s]+$/, '') : '商品'

  return {
    product,
    priceEach: priceNum,
    slotsTotal: slotMatch ? parseInt(slotMatch[1], 10) : 3,
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

function rowToSession(r: Record<string, unknown>): PoolSession {
  return {
    id: r.id as string,
    chatId: Number(r.chat_id),
    creatorId: Number(r.creator_id),
    creatorName: r.creator_name as string,
    product: r.product as string,
    priceEach: parseFloat(r.price_each as string),
    slotsTotal: Number(r.slots_total),
    slotsFilled: Number(r.slots_filled),
    status: r.status as SessionStatus,
    merchantOrderId: r.merchant_order_id as string | undefined,
    txHash: r.tx_hash as string | undefined,
    messageId: r.message_id ? Number(r.message_id) : undefined,
    deadline: r.deadline ? new Date(r.deadline as string) : undefined,
    createdAt: new Date(r.created_at as string),
  }
}

function rowToMember(r: Record<string, unknown>): PoolMember {
  return {
    id: Number(r.id),
    sessionId: r.session_id as string,
    userId: Number(r.user_id),
    username: r.username as string,
    slots: Number(r.slots),
    amount: parseFloat(r.amount as string),
    status: r.status as PoolMember['status'],
    joinedAt: new Date(r.joined_at as string),
  }
}

// ── session CRUD ──────────────────────────────────────────────────────────────

export async function createSession(
  chatId: number,
  creatorId: number,
  creatorName: string,
  parsed: ParsedPin,
): Promise<PoolSession> {
  const id = uuidv4().slice(0, 8).toUpperCase()
  const deadline = new Date(Date.now() + 30 * 60 * 1000) // 30 min
  const res = await pool.query(
    `INSERT INTO poolmate_sessions
       (id, chat_id, creator_id, creator_name, product, price_each, slots_total, deadline)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [id, chatId, creatorId, creatorName, parsed.product, parsed.priceEach, parsed.slotsTotal, deadline],
  )
  // allocate Treasury account for this session
  const totalBudget = parsed.priceEach * parsed.slotsTotal + 20 // +20 buffer for shipping
  await treasury.allocate(`poolmate:${id}`, [
    { agentId: 'pool',     agentName: 'PoolMate 资金池', amount: totalBudget,
      policy: { maxSingle: totalBudget, dailyLimit: totalBudget * 2, whitelist: ['merchant'], assetWhitelist: ['USDT'] } },
    { agentId: 'merchant', agentName: '演示商户',         amount: 0,
      policy: { maxSingle: 0, dailyLimit: 0, whitelist: [], assetWhitelist: ['USDT'] } },
  ])
  return rowToSession(res.rows[0])
}

export async function getSession(id: string): Promise<PoolSession | null> {
  const res = await pool.query(`SELECT * FROM poolmate_sessions WHERE id=$1`, [id])
  return res.rowCount! > 0 ? rowToSession(res.rows[0]) : null
}

export async function getActiveSession(chatId: number): Promise<PoolSession | null> {
  // auto-cancel any sessions that passed their deadline before returning
  await pool.query(
    `UPDATE poolmate_sessions
     SET status='cancelled', updated_at=NOW()
     WHERE chat_id=$1 AND status IN ('collecting','funded')
       AND deadline IS NOT NULL AND deadline < NOW()`,
    [chatId],
  )
  const res = await pool.query(
    `SELECT * FROM poolmate_sessions WHERE chat_id=$1 AND status IN ('collecting','funded') ORDER BY created_at DESC LIMIT 1`,
    [chatId],
  )
  return res.rowCount! > 0 ? rowToSession(res.rows[0]) : null
}

export async function setMessageId(id: string, messageId: number): Promise<void> {
  await pool.query(`UPDATE poolmate_sessions SET message_id=$2 WHERE id=$1`, [id, messageId])
}

export async function getMembers(sessionId: string): Promise<PoolMember[]> {
  const res = await pool.query(
    `SELECT * FROM poolmate_members WHERE session_id=$1 ORDER BY joined_at`,
    [sessionId],
  )
  return res.rows.map(rowToMember)
}

// ── join / leave ──────────────────────────────────────────────────────────────

export async function joinSession(
  sessionId: string,
  userId: number,
  username: string,
  slots = 1,
): Promise<{ ok: boolean; reason?: string; session: PoolSession }> {
  const session = await getSession(sessionId)
  if (!session) return { ok: false, reason: '拼单不存在', session: null! }
  if (session.status !== 'collecting') return { ok: false, reason: '拼单已结束', session }
  if (session.slotsFilled + slots > session.slotsTotal)
    return { ok: false, reason: `剩余份额不足 (还差 ${session.slotsTotal - session.slotsFilled} 份)`, session }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO poolmate_members (session_id, user_id, username, slots, amount)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (session_id, user_id) DO UPDATE SET slots=$4, amount=$5`,
      [sessionId, userId, username, slots, slots * session.priceEach],
    )
    const newFilled = session.slotsFilled + slots
    const newStatus = newFilled >= session.slotsTotal ? 'funded' : 'collecting'
    await client.query(
      `UPDATE poolmate_sessions SET slots_filled=$2, status=$3, updated_at=NOW() WHERE id=$1`,
      [sessionId, newFilled, newStatus],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally { client.release() }

  return { ok: true, session: (await getSession(sessionId))! }
}

export async function leaveSession(
  sessionId: string,
  userId: number,
): Promise<{ ok: boolean; reason?: string; session: PoolSession }> {
  const session = await getSession(sessionId)
  if (!session) return { ok: false, reason: '拼单不存在', session: null! }
  if (session.status !== 'collecting') return { ok: false, reason: '已凑满，无法退出', session }
  if (session.creatorId === userId) return { ok: false, reason: '发起人不能退出，可以取消', session }

  const member = await pool.query(
    `DELETE FROM poolmate_members WHERE session_id=$1 AND user_id=$2 RETURNING slots`,
    [sessionId, userId],
  )
  if (member.rowCount! > 0) {
    const freed = Number(member.rows[0].slots)
    await pool.query(
      `UPDATE poolmate_sessions SET slots_filled=slots_filled-$2, updated_at=NOW() WHERE id=$1`,
      [sessionId, freed],
    )
  }
  return { ok: true, session: (await getSession(sessionId))! }
}

// ── checkout ──────────────────────────────────────────────────────────────────

export async function checkoutSession(sessionId: string): Promise<{
  ok: boolean
  reason?: string
  txId?: string
  orderId?: string
  txHash?: string
}> {
  const session = await getSession(sessionId)
  if (!session || session.status !== 'funded') return { ok: false, reason: '拼单尚未凑满' }

  await pool.query(`UPDATE poolmate_sessions SET status='ordering', updated_at=NOW() WHERE id=$1`, [sessionId])

  const members = await getMembers(sessionId)
  const totalAmount = members.reduce((s, m) => s + m.amount, 0)

  // Treasury: pool pays merchant
  const txResult = await treasury.transfer({
    tenantId: `poolmate:${sessionId}`,
    fromAgent: 'pool',
    toAgent: 'merchant',
    amount: totalAmount,
    purpose: `拼单结算 · ${session.product} × ${session.slotsTotal}`,
    protocol: 'x402',
  })

  if (!txResult.ok) {
    await pool.query(`UPDATE poolmate_sessions SET status='collecting', updated_at=NOW() WHERE id=$1`, [sessionId])
    return { ok: false, reason: `Treasury 拒付：${txResult.rejectReason}` }
  }

  // Demo merchant checkout
  const item = matchItem(session.product)
  const order = checkout(item?.id ?? 'yangmei-box', session.slotsTotal, totalAmount)

  // mock Injective tx hash
  const txHash = '0x' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('')

  await pool.query(
    `UPDATE poolmate_sessions SET status='completed', merchant_order_id=$2, tx_hash=$3, updated_at=NOW() WHERE id=$1`,
    [sessionId, order.orderId, txHash],
  )
  await pool.query(
    `UPDATE poolmate_members SET status='paid' WHERE session_id=$1`,
    [sessionId],
  )

  return { ok: true, txId: txResult.txId, orderId: order.orderId, txHash }
}

export async function cancelSession(sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE poolmate_sessions SET status='cancelled', updated_at=NOW() WHERE id=$1`,
    [sessionId],
  )
}
