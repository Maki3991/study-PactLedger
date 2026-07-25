import type { ParsedPoolRequest } from './types.js'

/**
 * Bot 命令层。
 *
 * 与 poolmate/backend 的命令集相比，这里省掉了每条命令的 orderId 参数：
 * web 侧 PoolMateService 约束了「一个群同时只能有一个进行中的拼单」
 * （见 service.ts 的 ACTIVE_SESSION_EXISTS），所以命令默认作用于当前活跃单。
 */

const MAX_SLOTS = 20
const MIN_SLOTS = 2
const MAX_PRICE = 500
const MAX_PRODUCT_LENGTH = 80
const MAX_CLAIM_SLOTS = 20

export interface BotCommandDescriptor {
  command: string
  description: string
}

/** 注册到 Telegram 命令菜单的列表，顺序即菜单显示顺序。 */
export const BOT_COMMANDS: readonly BotCommandDescriptor[] = [
  { command: 'help', description: '查看用法' },
  { command: 'status', description: '查看 Bot 与结算模式状态' },
  { command: 'pool_new', description: '发起拼单：份数 单价 商品' },
  { command: 'pool_claim', description: '加入当前拼单，可带份数' },
  { command: 'pool_leave', description: '退出当前拼单' },
  { command: 'pool_status', description: '查看当前拼单进度' },
  { command: 'pool_quote', description: '发起人按当前份额锁单并确认结算' },
  { command: 'pool_cancel', description: '取消当前拼单（仅发起人）' },
]

function commandPayload(text: string, command: string): string {
  return text
    .replace(new RegExp(`^/${command}(?:@[A-Za-z0-9_]+)?(?:\\s+|$)`, 'iu'), '')
    .trim()
}

function positiveInteger(raw: string | undefined, max: number): number | undefined {
  if (!raw || !/^\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 && value <= max ? value : undefined
}

/**
 * `/pool_new <份数> <单价> <商品>`
 *
 * 单价是必填的：web 侧 validateRequest 要求 priceEach，poolmate 的
 * `/pool_new <units> <title>` 语法在这里不够用。
 */
export function parseNewPoolCommand(text: string): ParsedPoolRequest | undefined {
  const payload = commandPayload(text, 'pool_new').replaceAll('，', ' ')
  const match = /^(\d+)\s+(\d+(?:\.\d{1,2})?)\s+(.+)$/u.exec(payload)
  if (!match) return undefined

  const slotsTotal = Number(match[1])
  const priceEach = Number(match[2])
  const product = match[3].trim().replace(/[，,\s]+$/u, '')

  if (!Number.isInteger(slotsTotal) || slotsTotal < MIN_SLOTS || slotsTotal > MAX_SLOTS) return undefined
  if (!Number.isFinite(priceEach) || priceEach <= 0 || priceEach > MAX_PRICE) return undefined
  if (!product || product.length > MAX_PRODUCT_LENGTH) return undefined

  return { product, priceEach, slotsTotal }
}

/** `/pool_claim [份数]`，缺省 1 份。返回 undefined 表示参数非法。 */
export function parseClaimCommand(text: string): { slots: number } | undefined {
  const payload = commandPayload(text, 'pool_claim')
  if (!payload) return { slots: 1 }
  const slots = positiveInteger(payload, MAX_CLAIM_SLOTS)
  return slots ? { slots } : undefined
}

export const COMMAND_USAGE = {
  poolNew: '用法：/pool_new <份数> <单价> <商品>\n例：/pool_new 3 89 杨梅',
  poolClaim: '用法：/pool_claim [份数]，例：/pool_claim 2',
} as const
