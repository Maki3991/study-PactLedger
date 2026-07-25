import test from 'node:test'
import assert from 'node:assert/strict'
import { toA2ATask } from './a2a.js'
import type { TaskSnapshot } from '../src/domain/trading.js'

test('A2A 0.3 Task and status Message include required kind and messageId fields', () => {
  const snapshot = {
    id: 'task-demo',
    missionId: 'mission-demo',
    phase: 'executed',
    updatedAt: '2026-07-25T13:00:00.000Z',
    timeline: [{
      time: '13:00:00',
      title: '任务已完成',
      detail: '研究与风控流程完成。',
      tone: 'success',
    }],
    paymentTraces: [],
    candidates: [],
  } as unknown as TaskSnapshot

  const task = toA2ATask(snapshot)
  assert.equal(task.kind, 'task')
  assert.equal(task.status.message?.kind, 'message')
  assert.equal(task.status.message?.messageId, 'task-demo-status-1')
  assert.equal(task.status.message?.role, 'agent')
  assert.deepEqual(task.status.message?.parts, [{ kind: 'text', text: '任务已完成' }])
})
