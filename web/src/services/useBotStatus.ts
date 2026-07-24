import { useCallback, useEffect, useState } from 'react'

interface BotStatus {
  ok: boolean
  username?: string
  firstName?: string
  inviteUrl?: string
  reason?: string
}

export function useBotStatus() {
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [testing, setTesting] = useState(false)

  const test = useCallback(async () => {
    setTesting(true)
    try {
      const res = await fetch('/api/poolmate/bot-status')
      if (res.ok) setStatus(await res.json() as BotStatus)
      else setStatus({ ok: false, reason: `HTTP ${res.status}` })
    } catch {
      setStatus({ ok: false, reason: 'network error' })
    } finally {
      setTesting(false)
    }
  }, [])

  useEffect(() => { void test() }, [test])

  const label = testing ? 'checking…' : !status ? '—' : status.ok ? `@${status.username}` : 'offline'
  const tone: 'ok' | 'review' = status?.ok ? 'ok' : 'review'

  return { status, testing, test, label, tone }
}
