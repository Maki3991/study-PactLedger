import { useEffect, useRef, useState } from 'react'
import { authHeaders } from './authClient'

export interface TreasuryAccount {
  id: string
  agentId: string
  agentName: string
  balance: number
  allocated: number
  spent: number
  earned: number
  currency: string
}

export interface TreasuryTx {
  id: string
  fromAgent: string | null
  toAgent: string | null
  amount: number
  currency: string
  purpose: string
  protocol: 'internal' | 'x402' | 'acp' | 'ap2'
  status: 'completed' | 'rejected'
  rejectReason?: string
  createdAt: string
}

export interface TreasuryState {
  accounts: TreasuryAccount[]
  log: TreasuryTx[]
  loading: boolean
}

const POLL_MS = 2_500

export function useTreasury(taskId: string | undefined): TreasuryState {
  const [accounts, setAccounts] = useState<TreasuryAccount[]>([])
  const [log, setLog] = useState<TreasuryTx[]>([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastTaskIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!taskId) {
      lastTaskIdRef.current = undefined
      return
    }

    let active = true
    const shouldReset = lastTaskIdRef.current !== taskId
    lastTaskIdRef.current = taskId

    async function poll() {
      if (!active) return
      setLoading(true)
      try {
        const [accRes, logRes] = await Promise.all([
          fetch(`/api/treasury/${taskId}/accounts`, { headers: authHeaders() }),
          fetch(`/api/treasury/${taskId}/audit-log`, { headers: authHeaders() }),
        ])
        if (!active) return
        if (shouldReset) {
          setAccounts(accRes.ok ? (await accRes.json() as TreasuryAccount[]) : [])
          setLog(logRes.ok ? (await logRes.json() as TreasuryTx[]) : [])
        } else {
          if (accRes.ok) setAccounts(await accRes.json() as TreasuryAccount[])
          if (logRes.ok) setLog(await logRes.json() as TreasuryTx[])
        }
      } catch { /* ignore */ } finally {
        if (active) setLoading(false)
      }
    }

    void poll()
    timerRef.current = setInterval(() => void poll(), POLL_MS)

    return () => {
      active = false
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [taskId])

  return { accounts: taskId ? accounts : [], log: taskId ? log : [], loading }
}
