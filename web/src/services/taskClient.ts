import type { CreateTaskInput, InjectiveConfigStatus, PandaConfigStatus, StockRecommendationResult, TaskSnapshot, TaskStreamEvent } from '../domain/trading'
import { authHeaders, getAuthToken } from './authClient'

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers)
  if (init?.body) headers.set('Content-Type', 'application/json')
  for (const [key, value] of Object.entries(authHeaders())) headers.set(key, value)
  const response = await fetch(url, { ...init, headers })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: response.statusText })) as { error?: string; message?: string }
    throw new Error(payload.message ?? payload.error ?? `Request failed with status ${response.status}`)
  }
  return response.json() as Promise<T>
}

export const createTask = (input: CreateTaskInput): Promise<TaskSnapshot> => request('/api/tasks', {
  method: 'POST',
  body: JSON.stringify(input),
})

export const approveTask = (taskId: string): Promise<TaskSnapshot> => request(`/api/tasks/${taskId}/approve`, { method: 'POST' })

export const executeTask = (taskId: string): Promise<TaskSnapshot> => request(`/api/tasks/${taskId}/execute`, { method: 'POST' })

export const getInjectiveConfig = (): Promise<InjectiveConfigStatus> => request('/api/config/injective')

export const getPandaConfig = (): Promise<PandaConfigStatus> => request('/api/config/panda')

export const getStockRecommendations = (limit = 3): Promise<StockRecommendationResult> => request('/api/stocks/recommendations', {
  method: 'POST',
  body: JSON.stringify({ limit }),
})

export const subscribeToTask = (
  taskId: string,
  onSnapshot: (snapshot: TaskSnapshot) => void,
  onError: () => void,
): (() => void) => {
  const token = getAuthToken()
  const url = `/api/tasks/${taskId}/events${token ? `?token=${encodeURIComponent(token)}` : ''}`
  const source = new EventSource(url)
  source.addEventListener('task.snapshot', (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as TaskStreamEvent
    onSnapshot(payload.snapshot)
  })
  source.onerror = onError
  return () => source.close()
}
