import { useCallback, useEffect, useState } from 'react'
import { authApi, getStoredSession, storeSession, type AuthSession } from './authClient'

export function useAuth() {
  const [session, setSession] = useState<AuthSession | null>(() => getStoredSession())
  const [validating, setValidating] = useState(() => getStoredSession() !== null)

  useEffect(() => {
    if (!getStoredSession()) return
    let active = true
    authApi.me()
      .then(({ user }) => {
        if (!active) return
        setSession((prev) => {
          if (!prev) return prev
          const next = { ...prev, user }
          storeSession(next)
          return next
        })
      })
      .catch(() => {
        if (!active) return
        storeSession(null)
        setSession(null)
      })
      .finally(() => {
        if (active) setValidating(false)
      })
    return () => {
      active = false
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const next = await authApi.login(username, password)
    storeSession(next)
    setSession(next)
  }, [])

  const register = useCallback(async (username: string, password: string) => {
    const next = await authApi.register(username, password)
    storeSession(next)
    setSession(next)
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // 即使服务端会话已失效，本地也要正常登出
    }
    storeSession(null)
    setSession(null)
  }, [])

  return { session, validating, login, register, logout }
}
