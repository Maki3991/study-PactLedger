import { Bot, InlineKeyboard } from 'grammy'
import { PoolMateService, PoolMateServiceError, parsePoolRequest } from './service.js'
import type {
  PoolMateBotStatus,
  PoolMateCheckoutResult,
  PoolMateMember,
  PoolMateSession,
} from './types.js'

interface TelegramIdentity {
  username: string
  firstName: string
}

export type TelegramIdentityProbe = (token: string) => Promise<TelegramIdentity>

export class PoolMateTelegramRuntime {
  private bot?: Bot
  private polling?: Promise<void>
  private identity?: TelegramIdentity
  private running = false
  private reasonCode: PoolMateBotStatus['reasonCode']

  constructor(
    private readonly token: string | undefined,
    private readonly service: PoolMateService,
    private readonly probeIdentity: TelegramIdentityProbe = defaultTelegramProbe,
  ) {}

  async start(): Promise<void> {
    if (!this.token || this.running) return
    try {
      this.identity = await this.probeIdentity(this.token)
    } catch {
      this.reasonCode = 'BOT_UNREACHABLE'
      return
    }
    const bot = new Bot(this.token)
    registerHandlers(bot, this.service)
    this.bot = bot
    this.running = true
    this.reasonCode = undefined
    this.polling = bot.start({ drop_pending_updates: true })
    void this.polling.then(() => {
      this.running = false
      this.reasonCode = 'BOT_POLLING_STOPPED'
    }).catch(() => {
      this.running = false
      this.reasonCode = 'BOT_POLLING_STOPPED'
      console.error('[poolmate-bot] polling stopped')
    })
  }

  async stop(): Promise<void> {
    if (!this.bot || !this.running) return
    await this.bot.stop()
    await this.polling?.catch(() => undefined)
    this.running = false
  }

  async refreshStatus(): Promise<PoolMateBotStatus> {
    if (!this.token) return this.getStatus()
    try {
      this.identity = await this.probeIdentity(this.token)
      this.reasonCode = this.running ? undefined : 'BOT_NOT_STARTED'
    } catch {
      this.reasonCode = 'BOT_UNREACHABLE'
    }
    return this.getStatus()
  }

  getStatus(): PoolMateBotStatus {
    const configured = Boolean(this.token)
    const ok = configured && Boolean(this.identity) && this.reasonCode !== 'BOT_UNREACHABLE'
    const reasonCode = !configured ? 'BOT_NOT_CONFIGURED' : this.reasonCode ?? (this.running ? undefined : 'BOT_NOT_STARTED')
    return {
      ok,
      configured,
      running: this.running,
      settlementMode: 'mock',
      username: this.identity?.username,
      firstName: this.identity?.firstName,
      inviteUrl: this.identity ? `https://t.me/${this.identity.username}` : undefined,
      reasonCode,
    }
  }
}

function registerHandlers(bot: Bot, service: PoolMateService): void {
  bot.command(['start', 'help'], async (context) => {
    await context.reply([
      '<b>PoolMate</b> 是 PactLedger 的群聊拼单参考应用。',
      '',
      '发起：<code>拼杨梅，一箱89元，需要3人</code>',
      '取消：<code>/cancel</code>',
      '',
      '所有付款都会经过 Payment Intent、Policy 和 Receipt；当前 Telegram 演示只生成 Mock Receipt，不会上链。',
    ].join('\n'), { parse_mode: 'HTML' })
  })

  bot.command('cancel', async (context) => {
    const session = await service.getActiveSession(context.chat.id)
    if (!session) {
      await context.reply('当前没有进行中的拼单。')
      return
    }
    const result = await service.cancelSession(session.id, context.from?.id ?? 0)
    await context.reply(result.ok ? `拼单 #${session.id} 已取消。` : result.reason ?? '取消失败。')
  })

  bot.on('message:text', async (context) => {
    const text = context.message.text.trim()
    if (text.startsWith('/')) return
    if (/转.*给我|打.*给我|直接给我/u.test(text)) {
      const trace = await service.evaluateUnknownPayee(context.chat.id, context.message.message_id)
      await context.reply(
        `PactLedger 已拒绝付款：<code>${escapeHtml(trace.decision.code)}</code>\n${escapeHtml(trace.decision.reason)}`,
        { parse_mode: 'HTML', reply_parameters: { message_id: context.message.message_id } },
      )
      return
    }
    if (!text.includes('拼')) return
    const parsed = parsePoolRequest(text)
    if (!parsed) {
      await context.reply('格式示例：拼杨梅，一箱89元，需要3人', {
        reply_parameters: { message_id: context.message.message_id },
      })
      return
    }
    try {
      const session = await service.createSession(
        context.chat.id,
        context.from?.id ?? 0,
        displayName(context.from),
        parsed,
      )
      const sent = await context.reply(sessionCard(session, []), {
        parse_mode: 'HTML',
        reply_markup: sessionKeyboard(session),
      })
      await service.setMessageId(session.id, sent.message_id)
    } catch (error) {
      const message = error instanceof PoolMateServiceError ? error.message : '创建拼单失败。'
      await context.reply(message)
    }
  })

  bot.on('callback_query:data', async (context) => {
    const [action, sessionId, slotsText] = context.callbackQuery.data.split(':')
    const userId = context.from.id
    if (action === 'join') {
      const result = await service.joinSession(sessionId, userId, displayName(context.from), Number(slotsText ?? 1))
      if (!result.ok || !result.session) {
        await context.answerCallbackQuery({ text: result.reason ?? '加入失败', show_alert: true })
        return
      }
      await context.answerCallbackQuery({ text: '已加入一份' })
      await updateSessionCard(context.api, service, result.session)
      if (result.session.status === 'funded') {
        await context.api.sendMessage(result.session.chatId, '份额已凑满，PactLedger 正在校验付款 Intent。')
        const checkout = await service.checkoutSession(sessionId)
        const current = await service.getSession(sessionId)
        if (current) await updateSessionCard(context.api, service, current)
        await context.api.sendMessage(result.session.chatId, checkoutMessage(checkout), { parse_mode: 'HTML' })
      }
      return
    }
    if (action === 'leave') {
      const result = await service.leaveSession(sessionId, userId)
      if (!result.ok || !result.session) {
        await context.answerCallbackQuery({ text: result.reason ?? '退出失败', show_alert: true })
        return
      }
      await context.answerCallbackQuery({ text: '已退出拼单' })
      await updateSessionCard(context.api, service, result.session)
      return
    }
    await context.answerCallbackQuery()
  })

  bot.catch(() => {
    console.error('[poolmate-bot] update handling failed')
  })
}

async function updateSessionCard(
  api: Bot['api'],
  service: PoolMateService,
  session: PoolMateSession,
): Promise<void> {
  if (!session.messageId) return
  const members = await service.getMembers(session.id)
  await api.editMessageText(
    session.chatId,
    session.messageId,
    sessionCard(session, members),
    { parse_mode: 'HTML', reply_markup: sessionKeyboard(session) },
  ).catch(() => undefined)
}

function sessionCard(session: PoolMateSession, members: PoolMateMember[]): string {
  const statusLabels: Record<PoolMateSession['status'], string> = {
    collecting: '收集中',
    funded: '已凑满',
    settling: 'Policy 校验中',
    approval_required: '等待人工批准',
    completed: '已完成',
    failed: '已停止',
    cancelled: '已取消',
  }
  const memberLines = members.length
    ? members.map((member) => `- ${escapeHtml(member.username)} · ${member.slots} 份 · ¥${member.amount.toFixed(2)}`).join('\n')
    : '暂无成员'
  return [
    `<b>拼单 #${escapeHtml(session.id)}</b> · ${statusLabels[session.status]}`,
    `商品：${escapeHtml(session.product)} · ¥${session.priceEach.toFixed(2)}/份`,
    `进度：${session.slotsFilled}/${session.slotsTotal} 份`,
    '',
    memberLines,
    session.status === 'completed'
      ? `\nMock Receipt · No Chain\nIntent：<code>${escapeHtml(session.intentId ?? '')}</code>`
      : '',
    session.failureCode ? `\n状态码：<code>${escapeHtml(session.failureCode)}</code>` : '',
  ].filter(Boolean).join('\n')
}

function sessionKeyboard(session: PoolMateSession): InlineKeyboard {
  if (session.status !== 'collecting') return new InlineKeyboard()
  return new InlineKeyboard()
    .text('加入一份', `join:${session.id}:1`)
    .text('退出', `leave:${session.id}`)
}

function checkoutMessage(result: PoolMateCheckoutResult): string {
  const trace = result.trace
  if (!result.ok || !trace?.receipt) {
    return [
      '<b>付款未执行</b>',
      `状态：<code>${escapeHtml(trace?.decision.code ?? result.session?.failureCode ?? 'CHECKOUT_FAILED')}</code>`,
      escapeHtml(result.reason ?? 'PactLedger 未返回确认 Receipt。'),
    ].join('\n')
  }
  if (trace.receipt.mode === 'mock') {
    return [
      '<b>演示商户订单已生成</b>',
      '回执：<b>Mock Receipt · No Chain</b>',
      `Intent：<code>${escapeHtml(trace.intent.id)}</code>`,
      `Policy：<code>${escapeHtml(trace.decision.code)}</code>`,
      `订单：<code>${escapeHtml(result.session?.merchantOrderId ?? '')}</code>`,
    ].join('\n')
  }
  if (trace.receipt.explorerUrl && trace.receipt.transactionHash) {
    return [
      '<b>Injective Testnet 已确认</b>',
      `Intent：<code>${escapeHtml(trace.intent.id)}</code>`,
      `<a href="${escapeHtml(trace.receipt.explorerUrl)}">打开 Explorer</a>`,
    ].join('\n')
  }
  return '<b>付款未执行</b>\nTestnet Receipt 缺少可验证 Explorer 证据。'
}

function displayName(user: { first_name?: string; username?: string; id: number } | undefined): string {
  return user?.first_name ?? user?.username ?? `用户${user?.id ?? 0}`
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

async function defaultTelegramProbe(token: string): Promise<TelegramIdentity> {
  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error('Telegram probe failed')
  const payload = await response.json() as {
    ok?: boolean
    result?: { username?: string; first_name?: string }
  }
  if (!payload.ok || !payload.result?.username) throw new Error('Telegram rejected bot token')
  return { username: payload.result.username, firstName: payload.result.first_name ?? payload.result.username }
}
