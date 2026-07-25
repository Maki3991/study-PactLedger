import type { CreateTaskInput } from '../../src/domain/trading.js'

/**
 * 命令解析。各字段边界与 app.ts 中 POST /api/tasks 的 JSON schema 一致，
 * 好让非法输入在 bot 层就被挡住并给出用法，而不是到 service 才报错。
 */

const OBJECTIVE_MIN_LENGTH = 8
const ASSET_PATTERN = /^[A-Za-z0-9.\-_]{6,16}$/
const BUDGET_MIN = 1
const MAX_LOSS_MIN = 0.1
const MAX_LOSS_MAX = 100
const MAX_ASSET_MIN = 1
const MAX_ASSET_MAX = 100
const TASK_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

export interface BotCommandDescriptor {
  command: string
  description: string
}

export const BOT_COMMANDS: readonly BotCommandDescriptor[] = [
  { command: 'help', description: '查看用法' },
  { command: 'status', description: '查看执行模式与就绪状态' },
  { command: 'research', description: '发起研究任务：标的 预算 回撤% 上限% 目标' },
  { command: 'tasks', description: '我的任务列表' },
  { command: 'task', description: '查看任务详情：/task <id>' },
  { command: 'approve', description: '批准支付意图：/approve <id>' },
  { command: 'execute', description: '执行已批准的意图：/execute <id>' },
  { command: 'history', description: '历史交易：/history [id]' },
]

function commandPayload(text: string, command: string): string {
  return text
    .replace(new RegExp(`^/${command}(?:@[A-Za-z0-9_]+)?(?:\\s+|$)`, 'iu'), '')
    .trim()
}

function finiteNumber(raw: string): number | undefined {
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/** `/research <标的> <预算> <最大回撤%> <单标的上限%> <目标...>` */
export function parseResearchCommand(text: string): CreateTaskInput | undefined {
  const payload = commandPayload(text, 'research').replaceAll('，', ' ')
  const match = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+([\s\S]+)$/u.exec(payload)
  if (!match) return undefined

  const [, asset, budgetRaw, maxLossRaw, maxAssetRaw, objectiveRaw] = match
  const budgetUsdt = finiteNumber(budgetRaw)
  const maxLossPct = finiteNumber(maxLossRaw)
  const maxAssetPct = finiteNumber(maxAssetRaw)
  const objective = objectiveRaw.trim()

  if (!ASSET_PATTERN.test(asset)) return undefined
  if (budgetUsdt === undefined || budgetUsdt < BUDGET_MIN) return undefined
  if (maxLossPct === undefined || maxLossPct < MAX_LOSS_MIN || maxLossPct > MAX_LOSS_MAX) return undefined
  if (maxAssetPct === undefined || maxAssetPct < MAX_ASSET_MIN || maxAssetPct > MAX_ASSET_MAX) return undefined
  if (objective.length < OBJECTIVE_MIN_LENGTH) return undefined

  return { objective, budgetUsdt, maxLossPct, maxAssetPct, asset }
}

/** 提取 `/task` `/approve` `/execute` `/history` 的任务标识，可为 id 或 missionId。 */
export function parseTaskIdCommand(
  text: string,
  command: 'task' | 'approve' | 'execute' | 'history',
): string | undefined {
  const payload = commandPayload(text, command)
  if (!payload) return undefined
  const candidate = payload.split(/\s+/u)[0]
  return TASK_ID_PATTERN.test(candidate) ? candidate : undefined
}

export const COMMAND_USAGE = {
  research: [
    '用法：/research <标的> <预算USDT> <最大回撤%> <单标的上限%> <目标>',
    '例：/research NVDA.US 5000 15 30 评估财报后的动量策略',
    '',
    `标的 6-16 位字母数字，预算 ≥ ${BUDGET_MIN}，回撤 ${MAX_LOSS_MIN}-${MAX_LOSS_MAX}，`
      + `上限 ${MAX_ASSET_MIN}-${MAX_ASSET_MAX}，目标至少 ${OBJECTIVE_MIN_LENGTH} 字。`,
  ].join('\n'),
  task: '用法：/task <任务 ID>',
  approve: '用法：/approve <任务 ID>',
  execute: '用法：/execute <任务 ID>',
} as const
