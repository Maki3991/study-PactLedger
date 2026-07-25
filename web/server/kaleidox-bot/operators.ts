/**
 * Telegram 用户 → KaleidoX 账号的授权映射。
 *
 * 这是 bot 唯一的权限边界：能通过这里的人可以批准真实支付
 * （orchestrator.approve / execute），所以规则是 fail closed——
 * 名单为空时 bot 根本不启动，而不是放行所有人。
 */

/** `<telegramUserId>:<kaleidoxUserId>`，多条用逗号分隔。 */
const ENTRY_PATTERN = /^(\d{1,20}):([A-Za-z0-9_-]{1,64})$/

export interface OperatorMap {
  /** Telegram 用户 ID（字符串形式）→ KaleidoX userId */
  readonly byTelegramId: ReadonlyMap<string, string>
  /** 被跳过的非法条目，供启动时告警。不含原始值以免泄露配置内容。 */
  readonly invalidEntryCount: number
}

export function parseOperatorMap(raw: string | undefined): OperatorMap {
  const byTelegramId = new Map<string, string>()
  let invalidEntryCount = 0

  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const match = ENTRY_PATTERN.exec(trimmed)
    if (!match) {
      invalidEntryCount += 1
      continue
    }
    // 同一 Telegram ID 重复配置时后者覆盖前者。
    byTelegramId.set(match[1], match[2])
  }

  return { byTelegramId, invalidEntryCount }
}

/** 返回 undefined 表示该 Telegram 用户未获授权。 */
export function resolveOperator(
  operators: OperatorMap,
  telegramUserId: number | string | undefined,
): string | undefined {
  if (telegramUserId === undefined) return undefined
  return operators.byTelegramId.get(String(telegramUserId))
}

export function hasOperators(operators: OperatorMap): boolean {
  return operators.byTelegramId.size > 0
}
