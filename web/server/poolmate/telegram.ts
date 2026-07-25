import { Bot, InlineKeyboard, type BotConfig, type Context, type MiddlewareFn } from 'grammy'
import { BOT_COMMANDS, COMMAND_USAGE, parseClaimCommand, parseNewPoolCommand } from './commands.js'
import { PoolMateService, PoolMateServiceError, parsePoolRequest } from './service.js'
import type {
  ParsedPoolRequest,
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

export interface PoolMateTelegramOptions {
  /** 关闭时（默认）任何用户都可交互；开启但名单为空则拒绝所有人。 */
  userAllowlistEnabled?: boolean
  allowedUserIds?: readonly (string | number)[]
  /** 自建 Bot API 服务器地址，缺省官方。 */
  apiRoot?: string
  /** 注入 fetch（走代理或测试替身）。grammy 不读 globalThis.fetch，必须从这里传。 */
  fetch?: NonNullable<NonNullable<BotConfig<Context>['client']>['fetch']>
}

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
    private readonly options: PoolMateTelegramOptions = {},
  ) {}

  async start(): Promise<void> {
    if (!this.token || this.running) return
    try {
      this.identity = await this.probeIdentity(this.token)
    } catch {
      this.reasonCode = 'BOT_UNREACHABLE'
      return
    }
    const bot = new Bot(this.token, {
      client: {
        ...(this.options.apiRoot ? { apiRoot: this.options.apiRoot } : {}),
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      },
    })
    const allowlist = createAccessMiddleware(
      this.options.userAllowlistEnabled ?? false,
      this.options.allowedUserIds ?? [],
    )
    if (allowlist) bot.use(allowlist)
    registerHandlers(bot, this.service, () => this.getStatus())
    this.bot = bot
    this.running = true
    this.reasonCode = undefined
    // 命令菜单注册失败不应阻断轮询：菜单只是 UI 提示，命令本身仍可手输。
    await bot.api.setMyCommands([...BOT_COMMANDS]).catch((error: unknown) => {
      console.error(`[poolmate-bot] setMyCommands failed: ${errorMessage(error)}`)
    })
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

function registerHandlers(
  bot: Bot,
  service: PoolMateService,
  getStatus: () => PoolMateBotStatus,
): void {
  bot.command(['start', 'help'], async (context) => {
    await context.reply([
      '<b>PoolMate</b> 是 PactLedger 的群聊拼单参考应用。',
      '',
      '<b>发起拼单</b>',
      '命令：<code>/pool_new 3 89 杨梅</code>（份数 单价 商品）',
      '自然语言：<code>拼杨梅，一箱89元，需要3人</code>',
      '',
      '<b>参与</b>',
      '<code>/pool_claim</code> 加入一份，<code>/pool_claim 2</code> 加入两份',
      '<code>/pool_leave</code> 退出',
      '',
      '<b>查看与管理</b>',
      '<code>/pool_status</code> 当前进度',
      '<code>/pool_quote</code> 份额已满但结算失败时重试',
      '<code>/pool_cancel</code> 取消（仅发起人）',
      '<code>/status</code> Bot 与结算模式',
      '',
      '一个群同时只有一个进行中的拼单，所以命令都作用于当前这一单。',
      '所有付款都会经过 Payment Intent、Policy 和 Receipt；当前 Telegram 演示只生成 Mock Receipt，不会上链。',
    ].join('\n'), { parse_mode: 'HTML' })
  })

  bot.command('status', async (context) => {
    const status = getStatus()
    await context.reply([
      `<b>PoolMate Bot</b> · ${status.running ? '运行中' : '未运行'}`,
      `结算模式：<code>${escapeHtml(status.settlementMode)}</code>`,
      status.username ? `账号：@${escapeHtml(status.username)}` : '账号：未知',
      status.reasonCode ? `状态码：<code>${escapeHtml(status.reasonCode)}</code>` : '',
    ].filter(Boolean).join('\n'), { parse_mode: 'HTML' })
  })

  bot.command('pool_new', async (context) => {
    const parsed = parseNewPoolCommand(context.message?.text ?? '')
    if (!parsed) {
      await context.reply(COMMAND_USAGE.poolNew)
      return
    }
    await createAndAnnounceSession(context, service, parsed)
  })

  bot.command('pool_claim', async (context) => {
    const parsed = parseClaimCommand(context.message?.text ?? '')
    if (!parsed) {
      await context.reply(COMMAND_USAGE.poolClaim)
      return
    }
    const session = await service.getActiveSession(context.chat.id)
    if (!session) {
      await context.reply('当前没有进行中的拼单。用 /pool_new 发起一个。')
      return
    }
    const result = await service.joinSession(
      session.id,
      context.from?.id ?? 0,
      displayName(context.from),
      parsed.slots,
    )
    if (!result.ok || !result.session) {
      await context.reply(result.reason ?? '加入失败。')
      return
    }
    await updateSessionCard(context.api, service, result.session)
    await context.reply(`已加入 ${parsed.slots} 份。`)
    await settleIfFunded(context.api, service, result.session)
  })

  bot.command('pool_leave', async (context) => {
    const session = await service.getActiveSession(context.chat.id)
    if (!session) {
      await context.reply('当前没有进行中的拼单。')
      return
    }
    const result = await service.leaveSession(session.id, context.from?.id ?? 0)
    if (!result.ok || !result.session) {
      await context.reply(result.reason ?? '退出失败。')
      return
    }
    await updateSessionCard(context.api, service, result.session)
    await context.reply('已退出拼单。')
  })

  bot.command('pool_status', async (context) => {
    const session = await service.getActiveSession(context.chat.id)
    if (!session) {
      await context.reply('当前没有进行中的拼单。')
      return
    }
    const members = await service.getMembers(session.id)
    await context.reply(sessionCard(session, members), { parse_mode: 'HTML' })
  })

  bot.command('pool_quote', async (context) => {
    const session = await service.getActiveSession(context.chat.id)
    if (!session) {
      await context.reply('当前没有进行中的拼单。')
      return
    }
    if (session.slotsFilled < session.slotsTotal) {
      await context.reply(`份额还没满（${session.slotsFilled}/${session.slotsTotal}），无法结算。`)
      return
    }
    const checkout = await service.checkoutSession(session.id)
    const current = await service.getSession(session.id)
    if (current) await updateSessionCard(context.api, service, current)
    await context.reply(checkoutMessage(checkout), { parse_mode: 'HTML' })
  })

  bot.command(['cancel', 'pool_cancel'], async (context) => {
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
      await context.reply('格式示例：拼杨梅，一箱89元，需要3人\n或用命令：/pool_new 3 89 杨梅', {
        reply_parameters: { message_id: context.message.message_id },
      })
      return
    }
    await createAndAnnounceSession(context, service, parsed)
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
      await settleIfFunded(context.api, service, result.session)
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

/** 建单 + 发卡片 + 记住 message_id，命令与自然语言两条入口共用。 */
async function createAndAnnounceSession(
  context: Context,
  service: PoolMateService,
  parsed: ParsedPoolRequest,
): Promise<void> {
  if (!context.chat) return
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
}

/** 份额刚满时触发结算。checkoutSession 自身幂等，重复调用安全。 */
async function settleIfFunded(
  api: Bot['api'],
  service: PoolMateService,
  session: PoolMateSession,
): Promise<void> {
  if (session.status !== 'funded') return
  await api.sendMessage(session.chatId, '份额已凑满，PactLedger 正在校验付款 Intent。')
  const checkout = await service.checkoutSession(session.id)
  const current = await service.getSession(session.id)
  if (current) await updateSessionCard(api, service, current)
  await api.sendMessage(session.chatId, checkoutMessage(checkout), { parse_mode: 'HTML' })
}

/** 返回 undefined 表示不需要挂中间件（未开启名单）。 */
function createAccessMiddleware(
  enabled: boolean,
  allowedUserIds: readonly (string | number)[],
): MiddlewareFn | undefined {
  if (!enabled) return undefined
  const allowed = new Set(allowedUserIds.map(String))
  return async (context, next) => {
    const userId = context.from?.id
    if (userId === undefined || !allowed.has(String(userId))) return
    await next()
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
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
