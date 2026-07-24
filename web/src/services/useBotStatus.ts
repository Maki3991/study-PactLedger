import { useCallback, useEffect, useState } from 'react'

interface BotStatus {
  ok: boolean
  configured: boolean
  running: boolean
  settlementMode: 'mock'
  username?: string
  firstName?: string
  inviteUrl?: string
  reasonCode?: 'BOT_NOT_CONFIGURED' | 'BOT_NOT_STARTED' | 'BOT_UNREACHABLE' | 'BOT_POLLING_STOPPED'
}

const reasonLabels: Record<NonNullable<BotStatus['reasonCode']>, string> = {
  BOT_NOT_CONFIGURED: '服务端未配置 Telegram Bot',
  BOT_NOT_STARTED: 'Bot Token 有效，但轮询尚未启动',
  BOT_UNREACHABLE: 'Telegram Bot API 暂时不可达',
  BOT_POLLING_STOPPED: 'Bot 轮询已停止',
}

export function useBotStatus() {
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [testing, setTesting] = useState(false)

  const test = useCallback(async () => {
    setTesting(true)
    const nextStatus = await fetchBotStatus()
    setStatus(nextStatus)
    try {
      return nextStatus
    } finally {
      setTesting(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void fetchBotStatus(controller.signal).then((nextStatus) => {
      if (!controller.signal.aborted) setStatus(nextStatus)
    })
    return () => controller.abort()
  }, [])

  const label = testing
    ? '检测中…'
    : !status ? '—'
      : status.ok && status.username ? `@${status.username}`
        : status.configured ? '离线' : '未配置'
  const reason = status?.reasonCode ? reasonLabels[status.reasonCode] : undefined
  const tone: 'ok' | 'review' = status?.ok && status.running ? 'ok' : 'review'

  return { status, testing, test, label, reason, tone }
}

async function fetchBotStatus(signal?: AbortSignal): Promise<BotStatus> {
  try {
    const response = await fetch('/api/public/poolmate/bot-status', { signal })
    if (response.ok) return await response.json() as BotStatus
  } catch {
    // The stable offline status below keeps transport errors out of the UI.
  }
  return {
    ok: false,
    configured: false,
    running: false,
    settlementMode: 'mock',
    reasonCode: 'BOT_UNREACHABLE',
  }
}
