const STORAGE_KEY = 'kaleidox.auth'

export interface AuthUser {
  id: string
  username: string
  createdAt: string
}

export interface AuthSession {
  token: string
  user: AuthUser
  expiresAt: string
}

let cachedSession: AuthSession | null | undefined

export function getStoredSession(): AuthSession | null {
  if (cachedSession !== undefined) return cachedSession
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    cachedSession = raw ? JSON.parse(raw) as AuthSession : null
  } catch {
    cachedSession = null
  }
  return cachedSession
}

export function storeSession(session: AuthSession | null): void {
  cachedSession = session
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  else localStorage.removeItem(STORAGE_KEY)
}

export function getAuthToken(): string | undefined {
  return getStoredSession()?.token
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const token = getAuthToken()
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(path, { ...init, headers })
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({})) as { error?: string; message?: string }
  if (!response.ok) throw new Error(payload.error ?? payload.message ?? `请求失败（${response.status}）`)
  return payload as T
}

export const authApi = {
  register: (username: string, password: string) =>
    request<AuthSession>('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) =>
    request<AuthSession>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request<{ user: AuthUser }>('/api/auth/me'),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
}
