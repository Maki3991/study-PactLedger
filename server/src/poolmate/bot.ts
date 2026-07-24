/**
 * PoolMate Telegram Bot (Grammy)
 * Commands: 拼 <product> 一<unit><price> 共<n>份
 *           加入 / 退出 (inline keyboard)
 *           /cancel – creator cancels session
 */
import { Bot, InlineKeyboard } from 'grammy'
import * as svc from './service'
import type { PoolSession } from './types'

// ── bot instance ─────────────────────────────────────────────────────────────

export function createBot(): Bot {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set')
  return new Bot(token)
}

// ── card formatters ───────────────────────────────────────────────────────────

function sessionCard(session: PoolSession, members: Awaited<ReturnType<typeof svc.getMembers>>): string {
  const statusEmoji: Record<string, string> = {
    collecting: '🟡', funded: '🟢', ordering: '⏳', completed: '✅', cancelled: '❌',
  }
  const memberLines = members.length
    ? members.map((m) => `  • ${m.username} · ${m.slots}份 · ¥${m.amount.toFixed(0)}`).join('\n')
    : '  （暂无人参与）'
  const deadline = session.deadline
    ? `截止 ${session.deadline.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : ''

  return [
    `${statusEmoji[session.status] ?? '●'} **拼单 #${session.id}**`,
    `📦 ${session.product}  ·  ¥${session.priceEach.toFixed(0)}/份`,
    `👥 进度：${session.slotsFilled}/${session.slotsTotal} 份  ${deadline}`,
    ``,
    memberLines,
    session.status === 'funded' ? '\n✅ 已凑满！正在向商户下单…' : '',
    session.status === 'completed' && session.txHash
      ? `\n🔗 链上回执：\`${session.txHash.slice(0, 16)}…\`\n📦 订单：${session.merchantOrderId ?? ''}`
      : '',
    session.status === 'cancelled' ? '\n❌ 拼单已取消。' : '',
  ].filter(Boolean).join('\n')
}

function buildKeyboard(sessionId: string, isFunded: boolean): InlineKeyboard {
  if (isFunded || true) {
    return new InlineKeyboard()
      .text('✅ 加入一份', `join:${sessionId}:1`)
      .text('❌ 退出', `leave:${sessionId}`)
  }
  return new InlineKeyboard()
}

// ── bot setup ─────────────────────────────────────────────────────────────────

export function setupBot(bot: Bot): void {

  // ── 拼单 触发 ───────────────────────────────────────────────────────────────
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text ?? ''
    const chatId = ctx.chat.id
    const userId = ctx.from?.id ?? 0
    const username = ctx.from?.first_name ?? ctx.from?.username ?? `用户${userId}`

    // detect "转给我" easter egg (whitelist rejection)
    if (/转.*给我|打.*给我|直接给我/.test(text)) {
      await ctx.reply(
        '🛡 收款方不在白名单内——我只能向已授权的演示商户付款。\n' +
        '这条规则由 Agent Treasury 的 Policy Engine 强制执行，我做不到。',
        { reply_parameters: { message_id: ctx.message.message_id } },
      )
      return
    }

    // detect 拼单 request
    if (/拼/.test(text)) {
      const parsed = svc.parsePin(text)
      if (!parsed) {
        await ctx.reply('📋 格式示例：拼杨梅，一箱89元，需要3人', {
          reply_parameters: { message_id: ctx.message.message_id },
        })
        return
      }

      const existing = await svc.getActiveSession(chatId)
      if (existing) {
        await ctx.reply(`⚠️ 群内已有进行中的拼单 #${existing.id}，请先完成或取消它。`)
        return
      }

      const session = await svc.createSession(chatId, userId, username, parsed)
      const members = await svc.getMembers(session.id)
      const kbd = buildKeyboard(session.id, false)

      const msg = await ctx.reply(sessionCard(session, members), {
        parse_mode: 'Markdown',
        reply_markup: kbd,
      })
      await svc.setMessageId(session.id, msg.message_id)
    }
  })

  // ── /cancel ──────────────────────────────────────────────────────────────────
  bot.command('cancel', async (ctx) => {
    const session = await svc.getActiveSession(ctx.chat.id)
    if (!session) { await ctx.reply('当前没有进行中的拼单。'); return }
    if (session.creatorId !== ctx.from?.id) { await ctx.reply('只有发起人可以取消拼单。'); return }
    await svc.cancelSession(session.id)
    await ctx.reply(`❌ 拼单 #${session.id} 已取消。`)
  })

  // ── /help ─────────────────────────────────────────────────────────────────────
  bot.command(['start', 'help'], async (ctx) => {
    await ctx.reply(
      '👋 我是 **PoolMate**，群内拼单结算 Agent。\n\n' +
      '**发起拼单：**\n`拼杨梅，一箱89，需要3人`\n\n' +
      '**加入/退出：** 点击消息下方按钮\n\n' +
      '**取消：** `/cancel`\n\n' +
      '💡 每笔付款都经过 Treasury Policy 校验，收款方限定演示商户。',
      { parse_mode: 'Markdown' },
    )
  })

  // ── inline keyboard callbacks ─────────────────────────────────────────────────
  bot.on('callback_query:data', async (ctx) => {
    const data  = ctx.callbackQuery.data
    const userId   = ctx.from.id
    const username = ctx.from.first_name ?? ctx.from.username ?? `用户${userId}`

    if (data.startsWith('join:')) {
      const [, sessionId, slotsStr] = data.split(':')
      const slots = parseInt(slotsStr ?? '1', 10)

      const result = await svc.joinSession(sessionId, userId, username, slots)
      if (!result.ok) {
        await ctx.answerCallbackQuery({ text: result.reason ?? '加入失败', show_alert: true })
        return
      }
      await ctx.answerCallbackQuery({ text: `✅ 已加入 ${slots} 份！` })

      const members = await svc.getMembers(sessionId)
      const session = result.session

      // update card message
      if (session.messageId) {
        await ctx.api.editMessageText(
          session.chatId, session.messageId,
          sessionCard(session, members),
          { parse_mode: 'Markdown', reply_markup: buildKeyboard(sessionId, session.status === 'funded') },
        ).catch(() => undefined)
      }

      // auto-checkout when funded
      if (session.status === 'funded') {
        await ctx.api.sendMessage(session.chatId, '✅ 份额已凑满！Treasury 正在校验并向演示商户下单…')

        const co = await svc.checkoutSession(sessionId)
        const final = await svc.getSession(sessionId)
        const finalMembers = await svc.getMembers(sessionId)

        if (co.ok && final) {
          await ctx.api.sendMessage(
            session.chatId,
            `🎉 **订单已成功下单！**\n\n` +
            `📦 订单号：\`${co.orderId}\`\n` +
            `🔗 链上回执：\`${co.txHash?.slice(0, 20)}…\`\n\n` +
            `每人账单：\n${finalMembers.map((m) => `  • ${m.username}：¥${m.amount.toFixed(0)}`).join('\n')}\n\n` +
            `预计 3-5 个工作日发货。`,
            { parse_mode: 'Markdown' },
          )
          if (final.messageId) {
            await ctx.api.editMessageText(
              final.chatId, final.messageId,
              sessionCard(final, finalMembers),
              { parse_mode: 'Markdown' },
            ).catch(() => undefined)
          }
        } else {
          await ctx.api.sendMessage(session.chatId, `❌ 下单失败：${co.reason ?? '未知错误'}，请联系发起人。`)
        }
      }
      return
    }

    if (data.startsWith('leave:')) {
      const [, sessionId] = data.split(':')
      const result = await svc.leaveSession(sessionId, userId)
      if (!result.ok) {
        await ctx.answerCallbackQuery({ text: result.reason ?? '退出失败', show_alert: true })
        return
      }
      await ctx.answerCallbackQuery({ text: '已退出拼单' })

      const members = await svc.getMembers(sessionId)
      if (result.session.messageId) {
        await ctx.api.editMessageText(
          result.session.chatId, result.session.messageId,
          sessionCard(result.session, members),
          { parse_mode: 'Markdown', reply_markup: buildKeyboard(sessionId, false) },
        ).catch(() => undefined)
      }
      return
    }

    await ctx.answerCallbackQuery()
  })

  // global error handler
  bot.catch((err) => console.error('[poolmate-bot] error:', err.message))
}

export async function startBot(): Promise<void> {
  const bot = createBot()
  setupBot(bot)
  console.log('[poolmate-bot] starting long-poll…')
  await bot.start({ drop_pending_updates: true })
}
