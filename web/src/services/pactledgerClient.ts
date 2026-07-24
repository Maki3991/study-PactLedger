import type { PactLedgerBaseStatus, PactLedgerTrace } from '../domain/pactledger'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export async function fetchPactLedgerBaseStatus(signal?: AbortSignal): Promise<PactLedgerBaseStatus> {
  return request<PactLedgerBaseStatus>('/api/public/base-status', { signal })
}

export async function runPoolMateCheckout(
  scenario: 'approved' | 'blocked',
  intentId?: string,
): Promise<PactLedgerTrace> {
  return request<PactLedgerTrace>('/api/demo/poolmate/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, intentId }),
  })
}

export function createPoolMateDemoIntentId(): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const entropy = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `PM-${timestamp}-${entropy}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init)
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as {
      error?: string | { code?: string; message?: string }
      message?: string
    } | undefined
    const structured = typeof payload?.error === 'object' ? payload.error : undefined
    throw new Error(
      structured?.message
      ?? (typeof payload?.error === 'string' ? payload.error : undefined)
      ?? payload?.message
      ?? `PactLedger API 请求失败（${response.status}）`,
    )
  }
  return response.json() as Promise<T>
}
