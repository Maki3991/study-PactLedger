import { Bot, type BotConfig, type Context, type MiddlewareFn } from 'grammy'
import type {
  CreateTaskInput,
  InjectiveConfigStatus,
  TaskSnapshot,
} from '../../src/domain/trading.js'
import type { TreasuryTx } from '../treasury.js'
import { BOT_COMMANDS, COMMAND_USAGE, parseResearchCommand, parseTaskIdCommand } from './commands.js'
import {
  escapeHtml,
  formatApprovalPrompt,
  formatAuditLog,
  formatTaskCard,
  formatTaskList,
  phaseLabel,
} from './format.js'
import { hasOperators, parseOperatorMap, resolveOperator, type OperatorMap } from './operators.js'

/** bot 需要的全部 KaleidoX 能力，注入以便测试替身。 */
export interface KaleidoxBotDependencies {
  createTask(input: CreateTaskInput, ownerId: string): Promise<TaskSnapshot>
  findTask(id: string): Promise<TaskSnapshot | undefined>
  findTasksByUser(userId: string): Promise<TaskSnapshot[]>
  approveTask(id: string): Promise<TaskSnapshot>
  executeTask(id: string): Promise<TaskSnapshot>
  getAuditLog(tenantId: string): Promise<TreasuryTx[]>
  subscribeTask(taskId: string, listener: (snapshot: TaskSnapshot) => void): () => void
  getInjectiveStatus(): InjectiveConfigStatus
}

export interface KaleidoxBotOptions {
  /** `<telegramUserId>:<kaleidoxUserId>` 逗号分隔。空则 bot 不启动。 */
  operators?: string
  apiRoot?: string
  /** grammy 不读 globalThis.fetch，注入必须走这里。 */
  fetch?: NonNullable<NonNullable<BotConfig<Context>['client']>['fetch']>
}

export interface KaleidoxBotStatus {
  configured: boolean
  running: boolean
  operatorCount: number
  reasonCode?: 'BOT_NOT_CONFIGURED' | 'NO_OPERATORS' | 'BOT_NOT_STARTED' | 'BOT_POLLING_STOPPED'
}

const MAX_LISTED_TASKS = 10
const MAX_LISTED_TRANSACTIONS = 15

export class KaleidoxTelegramRuntime {
  private bot?: Bot
  private polling?: Promise<void>
  private running = false
  private reasonCode: KaleidoxBotStatus['reasonCode']
  private readonly operators: OperatorMap

  constructor(
    private readonly token: string | undefined,
    private readonly dependencies: KaleidoxBotDependencies,
    private readonly options: KaleidoxBotOptions = {},
  ) {
    this.operators = parseOperatorMap(options.operators)
    if (this.operators.invalidEntryCount > 0) {
      console.error(
        `[kaleidox-bot] ignored ${this.operators.invalidEntryCount} malformed KALEIDOX_TELEGRAM_OPERATORS entries`,
      )
    }
  }

  async start(): Promise<void> {
    if (!this.token || this.running) return
    // fail closed：没有授权名单就不启动，避免 bot 在无人可用的状态下监听。
    if (!hasOperators(this.operators)) {
      this.reasonCode = 'NO_OPERATORS'
      console.error('[kaleidox-bot] refusing to start: KALEIDOX_TELEGRAM_OPERATORS is empty')
      return
    }

    const bot = new Bot(this.token, {
      client: {
        ...(this.options.apiRoot ? { apiRoot: this.options.apiRoot } : {}),
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      },
    })
    bot.use(this.createAuthMiddleware())
    registerHandlers(bot, this.dependencies, this.operators)
    bot.catch(({ error }) => {
      console.error(`[kaleidox-bot] update handling failed: ${errorMessage(error)}`)
    })

    this.bot = bot
    this.running = true
    this.reasonCode = undefined
    await bot.api.setMyCommands([...BOT_COMMANDS]).catch((error: unknown) => {
      console.error(`[kaleidox-bot] setMyCommands failed: ${errorMessage(error)}`)
    })
    this.polling = bot.start({ drop_pending_updates: true })
    void this.polling.then(
      () => {
        this.running = false
        this.reasonCode = 'BOT_POLLING_STOPPED'
      },
      (error: unknown) => {
        this.running = false
        this.reasonCode = 'BOT_POLLING_STOPPED'
        console.error(`[kaleidox-bot] polling stopped: ${errorMessage(error)}`)
      },
    )
  }

  async stop(): Promise<void> {
    if (!this.bot || !this.running) return
    await this.bot.stop()
    await this.polling?.catch(() => undefined)
    this.running = false
  }

  getStatus(): KaleidoxBotStatus {
    const configured = Boolean(this.token)
    return {
      configured,
      running: this.running,
      operatorCount: this.operators.byTelegramId.size,
      reasonCode: !configured
        ? 'BOT_NOT_CONFIGURED'
        : this.reasonCode ?? (this.running ? undefined : 'BOT_NOT_STARTED'),
    }
  }

  /** 非白名单用户静默丢弃：不回内容，避免泄露 bot 用途。 */
  private createAuthMiddleware(): MiddlewareFn {
    return async (context, next) => {
      if (!resolveOperator(this.operators, context.from?.id)) return
      await next()
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}

/**
 * 解析任务标识并校验归属。比 web 端的 findAccessibleTask 更严：那里允许
 * 无主任务（A2A 建的），这里要求 ownerId 严格相等，因为 bot 能批准支付。
 */
async function resolveOwnedTask(
  dependencies: KaleidoxBotDependencies,
  ownerId: string,
  reference: string,
): Promise<TaskSnapshot | undefined> {
  const direct = await dependencies.findTask(reference)
  if (direct) return direct.ownerId === ownerId ? direct : undefined

  // 允许用 missionId（KX-YYMMDD-XXXX）指代，只在本人任务里找。
  const owned = await dependencies.findTasksByUser(ownerId)
  const normalized = reference.toUpperCase()
  return owned.find((task) => task.missionId.toUpperCase() === normalized)
}

/** 支付授权只允许私聊：群里所有成员都能看到并触发群内命令。 */
async function requirePrivateChat(context: Context): Promise<boolean> {
  if (context.chat?.type === 'private') return true
  await context.reply('支付相关命令只能在与 Bot 的私聊中使用。')
  return false
}

function registerHandlers(
  bot: Bot,
  dependencies: KaleidoxBotDependencies,
  operators: OperatorMap,
): void {
  /** 中间件已挡掉未授权用户，这里必然拿到 ownerId。 */
  const ownerOf = (context: Context): string =>
    resolveOperator(operators, context.from?.id) as string

  bot.command(['start', 'help'], async (context) => {
    await context.reply([
      '<b>KaleidoX</b> · Agent Treasury 指挥台',
      '',
      '<b>发起研究</b>',
      '<code>/research NVDA.US 5000 15 30 评估财报后的动量策略</code>',
      '（标的 预算USDT 最大回撤% 单标的上限% 目标）',
      '',
      '<b>查看</b>',
      '<code>/tasks</code> 我的任务　<code>/task &lt;id&gt;</code> 详情',
      '<code>/history [id]</code> 历史交易',
      '<code>/status</code> 执行模式与就绪状态',
      '',
      '<b>支付</b>（仅私聊）',
      '<code>/approve &lt;id&gt;</code> 批准意图',
      '<code>/execute &lt;id&gt;</code> 执行已批准的意图',
      '',
      '批准与执行是两步：批准只授权一次执行，真正结算发生在 /execute。',
    ].join('\n'), { parse_mode: 'HTML' })
  })

  bot.command('status', async (context) => {
    const status = dependencies.getInjectiveStatus()
    await context.reply([
      `<b>执行模式</b>：${escapeHtml(status.mode)} · ${escapeHtml(status.adapter)}`,
      `链：${escapeHtml(status.network)} · <code>${escapeHtml(status.chainId)}</code>`,
      `就绪：${status.readyForExecution ? '是' : '否'}`,
      status.missing.length > 0 ? `缺少配置：${escapeHtml(status.missing.join(', '))}` : '',
    ].filter(Boolean).join('\n'), { parse_mode: 'HTML' })
  })

  bot.command('research', async (context) => {
    const input = parseResearchCommand(context.message?.text ?? '')
    if (!input) {
      await context.reply(COMMAND_USAGE.research)
      return
    }
    const ownerId = ownerOf(context)
    try {
      const task = await dependencies.createTask(input, ownerId)
      await context.reply(formatTaskCard(task), { parse_mode: 'HTML' })
      watchForApproval(context, dependencies, task)
    } catch (error) {
      await context.reply(`发起任务失败：${errorMessage(error)}`)
    }
  })

  bot.command('tasks', async (context) => {
    const tasks = await dependencies.findTasksByUser(ownerOf(context))
    const recent = [...tasks]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, MAX_LISTED_TASKS)
    await context.reply(formatTaskList(recent), { parse_mode: 'HTML' })
  })

  bot.command('task', async (context) => {
    const reference = parseTaskIdCommand(context.message?.text ?? '', 'task')
    if (!reference) {
      await context.reply(COMMAND_USAGE.task)
      return
    }
    const task = await resolveOwnedTask(dependencies, ownerOf(context), reference)
    if (!task) {
      await context.reply('未找到该任务。')
      return
    }
    await context.reply(formatTaskCard(task), { parse_mode: 'HTML' })
  })

  bot.command('approve', async (context) => {
    if (!await requirePrivateChat(context)) return
    const reference = parseTaskIdCommand(context.message?.text ?? '', 'approve')
    if (!reference) {
      await context.reply(COMMAND_USAGE.approve)
      return
    }
    const task = await resolveOwnedTask(dependencies, ownerOf(context), reference)
    if (!task) {
      await context.reply('未找到该任务。')
      return
    }
    if (task.phase !== 'awaiting_approval') {
      await context.reply(`当前阶段为「${phaseLabel(task.phase)}」，无法批准。`)
      return
    }
    try {
      const updated = await dependencies.approveTask(task.id)
      await context.reply(
        `${formatTaskCard(updated)}\n\n已授权一次执行。用 <code>/execute ${escapeHtml(updated.id)}</code> 结算。`,
        { parse_mode: 'HTML' },
      )
    } catch (error) {
      await context.reply(`批准失败：${errorMessage(error)}`)
    }
  })

  bot.command('execute', async (context) => {
    if (!await requirePrivateChat(context)) return
    const reference = parseTaskIdCommand(context.message?.text ?? '', 'execute')
    if (!reference) {
      await context.reply(COMMAND_USAGE.execute)
      return
    }
    const task = await resolveOwnedTask(dependencies, ownerOf(context), reference)
    if (!task) {
      await context.reply('未找到该任务。')
      return
    }
    const status = dependencies.getInjectiveStatus()
    if (!status.readyForExecution) {
      await context.reply(
        `Injective 执行未就绪，缺少：${escapeHtml(status.missing.join(', ') || '未知配置')}`,
        { parse_mode: 'HTML' },
      )
      return
    }
    try {
      const updated = await dependencies.executeTask(task.id)
      await context.reply(formatTaskCard(updated), { parse_mode: 'HTML' })
    } catch (error) {
      await context.reply(`执行失败：${errorMessage(error)}`)
    }
  })

  bot.command('history', async (context) => {
    const ownerId = ownerOf(context)
    const reference = parseTaskIdCommand(context.message?.text ?? '', 'history')

    if (reference) {
      const task = await resolveOwnedTask(dependencies, ownerId, reference)
      if (!task) {
        await context.reply('未找到该任务。')
        return
      }
      const entries = await dependencies.getAuditLog(task.id)
      await context.reply(formatAuditLog(entries, `${task.missionId} 交易记录`), { parse_mode: 'HTML' })
      return
    }

    // 不带 id：按任务聚合。treasury 的审计日志是按 tenantId(=taskId) 分片的，
    // 没有跨任务查询，所以这里逐个取再合并。
    const tasks = await dependencies.findTasksByUser(ownerId)
    const recent = [...tasks]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, MAX_LISTED_TASKS)
    const collected: TreasuryTx[] = []
    for (const task of recent) {
      collected.push(...await dependencies.getAuditLog(task.id))
    }
    const merged = collected
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, MAX_LISTED_TRANSACTIONS)
    await context.reply(formatAuditLog(merged, '最近交易'), { parse_mode: 'HTML' })
  })
}

/**
 * 任务进入 awaiting_approval 时私聊推送。
 *
 * TaskEvents 按 taskId 订阅，且订阅只存在于内存：进程重启会丢失，
 * 届时仍可用 /tasks 查到待批准任务。
 */
function watchForApproval(
  context: Context,
  dependencies: KaleidoxBotDependencies,
  task: TaskSnapshot,
): void {
  const chatId = context.chat?.id
  if (chatId === undefined) return

  const unsubscribe = dependencies.subscribeTask(task.id, (snapshot) => {
    if (snapshot.phase !== 'awaiting_approval') return
    unsubscribe()
    void context.api
      .sendMessage(chatId, formatApprovalPrompt(snapshot), { parse_mode: 'HTML' })
      .catch((error: unknown) => {
        console.error(`[kaleidox-bot] approval push failed: ${errorMessage(error)}`)
      })
  })
}
