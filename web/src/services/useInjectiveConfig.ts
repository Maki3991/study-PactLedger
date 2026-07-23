import { useCallback, useEffect, useState } from 'react'
import type { InjectiveConfigStatus } from '../domain/trading'
import { getInjectiveConfig } from './taskClient'

export function useInjectiveConfig() {
  const [status, setStatus] = useState<InjectiveConfigStatus>()
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    try {
      setStatus(await getInjectiveConfig())
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '配置状态读取失败')
    }
  }, [])

  useEffect(() => {
    let active = true
    void getInjectiveConfig()
      .then((config) => {
        if (!active) return
        setStatus(config)
        setError(undefined)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : '配置状态读取失败')
      })
    return () => {
      active = false
    }
  }, [])

  return { status, error, refresh }
}
