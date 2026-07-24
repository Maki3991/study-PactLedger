import { useCallback, useEffect, useRef, useState } from 'react'
import type { CreateTaskInput, TaskSnapshot } from '../domain/trading'
import { approveTask, createTask, executeTask, subscribeToTask } from './taskClient'

const demoInput: CreateTaskInput = {
  objective: '使用 PandaAI 数据研究 000001.SZ 的股票策略，最大可接受回撤为 5%，单一股票仓位不能超过 30%。',
  budgetUsdt: 1_000,
  maxLossPct: 5,
  maxAssetPct: 30,
  asset: '000001.SZ',
}

export function useTaskWorkflow() {
  const [task, setTask] = useState<TaskSnapshot>()
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const unsubscribeRef = useRef<() => void>(() => undefined)

  useEffect(() => () => unsubscribeRef.current(), [])

  const start = useCallback(async (input: CreateTaskInput = demoInput) => {
    setError(undefined)
    setSubmitting(true)
    unsubscribeRef.current()
    try {
      const created = await createTask(input)
      setTask(created)
      unsubscribeRef.current = subscribeToTask(
        created.id,
        setTask,
        () => setError('实时状态连接中断，正在等待浏览器自动重连。'),
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '任务创建失败')
    } finally {
      setSubmitting(false)
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

  return { task, error, submitting, start, approveAndExecute }
}
