import { useCallback, useEffect, useRef, useState } from 'react'
import type { CreateTaskInput, TaskSnapshot } from '../domain/trading'
import { approveTask, createTask, executeTask, subscribeToTask } from './taskClient'

const demoInput: CreateTaskInput = {
  objective: '使用 1,000 USDT 研究 ETH 的交易机会，最大可接受亏损为 5%，单一资产仓位不能超过 30%。',
  budgetUsdt: 1_000,
  maxLossPct: 5,
  maxAssetPct: 30,
  asset: 'ETH',
}

export function useTaskWorkflow() {
  const [task, setTask] = useState<TaskSnapshot>()
  const [error, setError] = useState<string>()
  const unsubscribeRef = useRef<() => void>(() => undefined)

  useEffect(() => () => unsubscribeRef.current(), [])

  const start = useCallback(async () => {
    setError(undefined)
    unsubscribeRef.current()
    try {
      const created = await createTask(demoInput)
      setTask(created)
      unsubscribeRef.current = subscribeToTask(
        created.id,
        setTask,
        () => setError('实时状态连接中断，正在等待浏览器自动重连。'),
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '任务创建失败')
    }
  }, [])

  const approveAndExecute = useCallback(async () => {
    if (!task || task.phase !== 'awaiting_approval') return
    setError(undefined)
    try {
      const approved = await approveTask(task.id)
      setTask(approved)
      const executed = await executeTask(task.id)
      setTask(executed)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '执行失败')
    }
  }, [task])

  return { task, error, start, approveAndExecute }
}
