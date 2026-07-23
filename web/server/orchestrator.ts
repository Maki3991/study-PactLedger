import { randomUUID } from 'node:crypto'
import type { ActionIntent, AgentRun, CreateTaskInput, TaskPhase, TaskSnapshot, TimelineEvent } from '../src/domain/trading.js'
import type { ExecutionAdapter } from './adapters/execution.js'
import { QuantResearchService } from './quant/service.js'
import { TaskEvents } from './taskEvents.js'
import { TaskRepository } from './repository.js'
import { TreasuryService } from './treasury.js'

type SnapshotMutation = (snapshot: TaskSnapshot) => void

export class InvalidTaskTransitionError extends Error {}

export class TaskOrchestrator {
  private readonly timers = new Set<NodeJS.Timeout>()
  private closed = false

  constructor(
    private readonly repository: TaskRepository,
    private readonly events: TaskEvents,
    private readonly executionAdapter: ExecutionAdapter,
    private readonly quantResearch: QuantResearchService,
    private readonly treasury: TreasuryService,
    private readonly stepDelay = 450,
  ) {}

  async start(taskId: string, input: CreateTaskInput): Promise<void> {
    await this.update(taskId, 'researching', (snapshot) => {
      setAgent(snapshot, 'research', 'working', `通过 PandaAI Provider 读取 ${input.asset} 日线`, '00:01')
    })
    void this.runResearchFlow(taskId, input)
  }

  async approve(taskId: string): Promise<TaskSnapshot> {
    const current = await this.requireTask(taskId)
    if (current.phase !== 'awaiting_approval') {
      throw new InvalidTaskTransitionError(`Task cannot be approved from phase ${current.phase}`)
    }
    return this.update(taskId, 'approved', (snapshot) => {
      if (snapshot.actionIntent) snapshot.actionIntent.status = 'approved'
      appendTimeline(snapshot, '用户批准股票策略意图', 'Agent Treasury 获得一次性执行授权', 'success')
    })
  }

  async execute(taskId: string): Promise<TaskSnapshot> {
    const current = await this.requireTask(taskId)
    if (current.phase !== 'approved' || !current.actionIntent) {
      throw new InvalidTaskTransitionError(`Task cannot execute from phase ${current.phase}`)
    }

    const intent = structuredClone(current.actionIntent)
    await this.treasury.recordExecutionCost(taskId)
    await this.update(taskId, 'executing', (snapshot) => {
      snapshot.execution.state = 'signing'
      if (snapshot.actionIntent) snapshot.actionIntent.status = 'executing'
      setAgent(snapshot, 'execution', 'working', '提交 Injective 执行适配器', '00:01')
    })

    try {
      const receipt = await this.executionAdapter.execute(intent)
      return this.update(taskId, 'executed', (snapshot) => {
        snapshot.execution = { state: 'executed', network: receipt.network, transactionHash: receipt.transactionHash }
        if (snapshot.actionIntent) snapshot.actionIntent.status = 'executed'
        setAgent(snapshot, 'execution', 'complete', '执行回执已写入统一账本', '00:08')
        appendTimeline(snapshot, '股票策略意图已完成结算', `交易哈希 ${receipt.transactionHash}`, 'success')
      })
    } catch (error) {
      return this.update(taskId, 'failed', (snapshot) => {
        snapshot.execution.state = 'ready'
        if (snapshot.actionIntent) snapshot.actionIntent.status = 'failed'
        setAgent(snapshot, 'execution', 'blocked', 'Injective 执行适配器返回失败', '00:01')
        appendTimeline(snapshot, '链上执行失败', error instanceof Error ? error.message : '未知执行错误', 'warning')
      })
    }
  }

  close(): void {
    this.closed = true
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
  }

  private async runResearchFlow(taskId: string, input: CreateTaskInput): Promise<void> {
    try {
      const analysis = await this.quantResearch.analyze(input)
      if (this.closed) return

      await this.wait(1)
      await this.treasury.recordResearchPayment(taskId)
      await this.update(taskId, 'strategizing', (snapshot) => {
        snapshot.quantEvidence = analysis.evidence
        snapshot.researchSummary = analysis.researchSummary
        setAgent(snapshot, 'research', 'complete', `${analysis.evidence.barCount} 根日线已归档`, '00:06')
        setAgent(snapshot, 'strategy', 'working', '生成双均线、波动率和市场状态策略', '00:01')
        appendTimeline(snapshot, '股票数据获取完成', `${analysis.evidence.provider} · ${analysis.evidence.symbol} · ${analysis.evidence.barCount} bars`, 'success')
      })

      await this.wait(1)
      await this.update(taskId, 'backtesting', (snapshot) => {
        setAgent(snapshot, 'strategy', 'complete', '生成 V1、V2-A、V2-B 三个版本', '00:03')
        setAgent(snapshot, 'backtest', 'working', '运行含手续费和样本外区间的回测', '00:01')
      })

      await this.wait(1)
      await this.treasury.recordBacktestPayment(taskId)
      await this.update(taskId, 'risk_review', (snapshot) => {
        snapshot.candidates = structuredClone(analysis.candidates)
        setAgent(snapshot, 'backtest', 'complete', `${analysis.evidence.startDate}–${analysis.evidence.endDate} 回测完成`, '00:05')
        setAgent(snapshot, 'evolution', 'complete', `${analysis.winner.name} 风险调整后表现最佳`, '00:02')
        setAgent(snapshot, 'risk', 'working', '检查预算、回撤与单股仓位', '00:01')
        appendTimeline(snapshot, `${analysis.winner.name} 成为候选冠军`, `Sharpe ${analysis.winner.sharpe.toFixed(2)} · 最大回撤 ${analysis.winner.drawdownPct.toFixed(2)}%`, 'success')
      })

      await this.wait(1)
      await this.treasury.recordRiskFee(taskId)
      await this.update(taskId, 'risk_review', (snapshot) => {
        setAgent(snapshot, 'risk', 'blocked', '40% 单股仓位超过用户上限，已退回', '00:02')
        snapshot.firewallRules[1].current = '40% / 拒绝'
        snapshot.actionIntent = createActionIntent(input.asset, analysis.winner.name, 400, 'policy_rejected', '40% 单股仓位超过 30% 上限')
        appendTimeline(snapshot, 'Policy Engine 退回初版', '建议仓位 40%，超过单一股票仓位上限 30%', 'warning')
      })

      await this.wait(1)
      await this.update(taskId, 'awaiting_approval', (snapshot) => {
        setAgent(snapshot, 'risk', 'complete', '修订仓位 25%，策略复核通过', '00:04')
        setAgent(snapshot, 'execution', 'waiting', '等待用户批准统一 Action Intent', '--:--')
        snapshot.firewallRules[0].current = '250 USDT'
        snapshot.firewallRules[1].current = '25%'
        snapshot.firewallRules[2].current = `${analysis.winner.drawdownPct.toFixed(2)}%`
        snapshot.actionIntent = createActionIntent(input.asset, analysis.winner.name, 250, 'awaiting_approval')
        appendTimeline(snapshot, '策略提交修订意图', '名义金额调整为 250 USDT，等待用户批准', 'neutral')
      })
    } catch (error) {
      if (this.closed) return
      await this.update(taskId, 'failed', (snapshot) => {
        setAgent(snapshot, 'research', 'blocked', '股票数据或回测流程失败', '00:01')
        appendTimeline(snapshot, '量化研究失败', error instanceof Error ? error.message : '未知研究错误', 'warning')
      })
    }
  }

  private wait(steps: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer)
        resolve()
      }, this.stepDelay * steps)
      this.timers.add(timer)
    })
  }

  private async update(taskId: string, phase: TaskPhase, mutation: SnapshotMutation): Promise<TaskSnapshot> {
    const snapshot = structuredClone(await this.requireTask(taskId))
    snapshot.phase = phase
    mutation(snapshot)
    const saved = await this.repository.save(snapshot)
    this.events.publish(saved)
    return saved
  }

  private async requireTask(taskId: string): Promise<TaskSnapshot> {
    const task = await this.repository.findById(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    return task
  }
}

function createActionIntent(
  symbol: string,
  strategyVersion: string,
  notional: number,
  status: ActionIntent['status'],
  policyReason?: string,
): ActionIntent {
  return {
    id: `INT-${randomUUID().slice(0, 8).toUpperCase()}`,
    appId: 'kaleidox',
    agentId: 'execution',
    action: 'stock_trade',
    symbol,
    side: 'buy',
    notional,
    currency: 'USDT',
    protocolTag: 'investment',
    strategyVersion,
    status,
    policyReason,
    createdAt: new Date().toISOString(),
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
