import { useEffect, useState } from 'react'
import type { DecisionRecord } from '../domain/trading'

interface KnowledgeBaseResponse {
  records?: DecisionRecord[]
  total?: number
  totalRecords?: number
  recentContext?: string
  hint?: string
}

async function fetchKnowledgeBase(symbol?: string): Promise<KnowledgeBaseResponse> {
  const params = new URLSearchParams()
  if (symbol) params.set('symbol', symbol)
  params.set('limit', '50')
  const url = `/api/public/knowledge-base${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`API error ${response.status}`)
  return response.json() as Promise<KnowledgeBaseResponse>
}

export function useKnowledgeBase(symbol?: string) {
  const [records, setRecords] = useState<DecisionRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(undefined)
    fetchKnowledgeBase(symbol)
      .then((data) => {
        if (!active) return
        setRecords(data.records ?? [])
        setTotal(data.total ?? data.totalRecords ?? 0)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Failed to load knowledge base')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [symbol])

  return { records, total, loading, error }
}
