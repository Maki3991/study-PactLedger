import type { AgentRun, TaskPhase, TaskSnapshot, TimelineEvent } from '../src/domain/trading.js'
import type { ExecutionAdapter } from './adapters/execution.js'
import { candidateStrategies } from './taskDefaults.js'
import { TaskEvents } from './taskEvents.js'
import { TaskRepository } from './repository.js'

type SnapshotMutation = (snapshot: TaskSnapshot) => void

export class InvalidTaskTransitionError extends Error {}

export class MockTaskOrchestrator {
  private readonly timers = new Set<NodeJS.Timeout>()

  constructor(
    private readonly repository: TaskRepository,
    private readonly events: TaskEvents,
    private readonly executionAdapter: ExecutionAdapter,
    private readonly stepDelay = 450,
  ) {}

  start(taskId: string): void {
    this.update(taskId, 'researching', (snapshot) => {
      setAgent(snapshot, 'research', 'working', '读取 ETH 行情与市场状态', '00:01')
    })

    this.schedule(1, () => this.update(taskId, 'strategizing', (snapshot) => {
      setAgent(snapshot, 'research', 'complete', '趋势与流动性已归因', '02:14')
      setAgent(snapshot, 'strategy', 'working', '生成策略候选版本', '00:01')
    }))

    this.schedule(2, () => this.update(taskId, 'backtesting', (snapshot) => {
      setAgent(snapshot, 'strategy', 'complete', '生成 2 个候选版本', '01:48')
      setAgent(snapshot, 'backtest', 'working', '运行 126 日滚动验证', '00:01')
      snapshot.candidates = structuredClone(candidateStrategies)
      appendTimeline(snapshot, 'V1 实盘偏差已归档', '震荡状态下连续 4 次错误趋势信号', 'warning')
    }))

    this.schedule(3, () => this.update(taskId, 'backtesting', (snapshot) => {
      setAgent(snapshot, 'backtest', 'complete', '126 日滚动验证完成', '04:52')
      setAgent(snapshot, 'evolution', 'working', '执行 Champion-Challenger 竞争', '00:01')
    }))

    this.schedule(4, () => this.update(taskId, 'risk_review', (snapshot) => {
      setAgent(snapshot, 'evolution', 'complete', 'V2-B 通过性能晋级', '03:06')
      setAgent(snapshot, 'risk', 'working', '检查预算、亏损与仓位边界', '00:01')
      appendTimeline(snapshot, 'V2-B 成为性能冠军', '风险调整后 Sharpe 1.28', 'success')
    }))

    this.schedule(5, () => this.update(taskId, 'risk_review', (snapshot) => {
      setAgent(snapshot, 'risk', 'blocked', '40% 仓位超过用户上限，已退回', '00:24')
      snapshot.firewallRules[1].current = '40% / 拒绝'
      appendTimeline(snapshot, 'Risk Agent 退回初版', '建议仓位 40%，超过用户上限 30%', 'warning')
    }))

    this.schedule(6, () => this.update(taskId, 'awaiting_approval', (snapshot) => {
      setAgent(snapshot, 'risk', 'complete', '修订仓位 25%，风险复核通过', '00:37')
      snapshot.firewallRules[0].current = '250 USDT'
      snapshot.firewallRules[1].current = '25%'
      snapshot.firewallRules[2].current = '4.2%'
      appendTimeline(snapshot, 'V2-B 提交修订计划', '执行仓位调整为 25%，等待用户批准', 'neutral')
    }))
  }

  approve(taskId: string): TaskSnapshot {
    const current = this.requireTask(taskId)
    if (current.phase !== 'awaiting_approval') {
      throw new InvalidTaskTransitionError(`Task cannot be approved from phase ${current.phase}`)
    }
    return this.update(taskId, 'approved', (snapshot) => {
      appendTimeline(snapshot, '用户批准 V2-B', 'Capital Firewall 获得一次性执行授权', 'success')
    })
  }

  async execute(taskId: string): Promise<TaskSnapshot> {
    const current = this.requireTask(taskId)
    if (current.phase !== 'approved') {
      throw new InvalidTaskTransitionError(`Task cannot execute from phase ${current.phase}`)
    }

    this.update(taskId, 'executing', (snapshot) => {
      snapshot.execution.state = 'signing'
      setAgent(snapshot, 'execution', 'working', '广播 Injective 测试网交易', '00:01')
    })

    const receipt = await this.executionAdapter.execute(taskId)
    return this.update(taskId, 'executed', (snapshot) => {
      snapshot.execution = { state: 'executed', network: receipt.network, transactionHash: receipt.transactionHash }
      setAgent(snapshot, 'execution', 'complete', '交易已在测试网确认', '00:08')
      appendTimeline(snapshot, 'V2-B 已在测试网执行', `交易哈希 ${receipt.transactionHash}`, 'success')
    })
  }

  close(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
  }

  private schedule(step: number, action: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      action()
    }, this.stepDelay * step)
    this.timers.add(timer)
  }

  private update(taskId: string, phase: TaskPhase, mutation: SnapshotMutation): TaskSnapshot {
    const snapshot = structuredClone(this.requireTask(taskId))
    snapshot.phase = phase
    mutation(snapshot)
    const saved = this.repository.save(snapshot)
    this.events.publish(saved)
    return saved
  }

  private requireTask(taskId: string): TaskSnapshot {
    const task = this.repository.findById(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    return task
  }
}

function setAgent(snapshot: TaskSnapshot, id: string, status: AgentRun['status'], detail: string, elapsed: string): void {
  const agent = snapshot.agents.find((item) => item.id === id)
  if (!agent) return
  Object.assign(agent, { status, detail, elapsed })
}

function appendTimeline(snapshot: TaskSnapshot, title: string, detail: string, tone: TimelineEvent['tone']): void {
  snapshot.timeline.push({
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    title,
    detail,
    tone,
  })
}
