import { useEffect, useState } from 'react'
import type { PandaConfigStatus } from '../domain/trading'
import { getPandaConfig } from './taskClient'

export function usePandaConfig() {
  const [status, setStatus] = useState<PandaConfigStatus>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    getPandaConfig()
      .then((value) => { if (active) setStatus(value) })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'PandaAI 配置读取失败') })
    return () => { active = false }
  }, [])

  return { status, error }
}
