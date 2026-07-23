import {
  ArrowDown,
  ArrowRight,
  Check,
  CircleDashed,
  Clock,
  Loader2,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import type { TaskSnapshot, TaskPhase } from '../domain/trading'

type FlowStatus = 'complete' | 'working' | 'waiting' | 'blocked'

interface FlowStep {
  id: string
  label: string
  role: string
  status: FlowStatus
  detail: string
  doing: string
  agentId?: string
}

const PHASE_ORDER: TaskPhase[] = [
  'created',
  'researching',
  'strategizing',
  'backtesting',
  'risk_review',
  'awaiting_approval',
  'approved',
  'executing',
  'executed',
  'failed',
]

const STEP_META: Omit<FlowStep, 'status' | 'detail'>[] = [
  {
    id: 'input',
    label: '用户目标与风险边界',
    role: 'INPUT',
    doing: '解析用户目标、预算、最大亏损与仓位限制，形成不可变授权边界。',
  },
  {
    id: 'orchestrator',
    label: 'A2A Orchestrator',
    role: 'ORCHESTRATE',
    doing: '将任务拆分为研究、策略、回测、风控、执行子任务并分发给对应 Agent。',
  },
  {
    id: 'research',
    label: 'Research Agent',
    role: 'PANDA DATA',
    doing: '读取股票日线，识别市场状态（趋势/震荡/高波动），输出可追溯研究证据。',
    agentId: 'research',
  },
  {
    id: 'strategy',
    label: 'Strategy Agent',
    role: 'STRATEGY',
    doing: '基于研究结论生成多个候选策略版本（V2-A、V2-B）。',
    agentId: 'strategy',
  },
  {
    id: 'backtest',
    label: 'Backtest Agent',
    role: 'BACKTEST',
    doing: '对候选策略进行含手续费和样本外区间的回测，计算收益、回撤与 Sharpe。',
    agentId: 'backtest',
  },
  {
    id: 'risk',
    label: 'Risk Agent',
    role: 'RISK VETO',
    doing: '独立复核仓位、亏损与预算边界，对超限策略行使否决权并触发修订。',
    agentId: 'risk',
  },
  {
    id: 'firewall',
    label: 'Capital Firewall',
    role: 'FIREWALL',
    doing: '执行最终规则校验：单笔仓位 ≤30%、资产白名单、日亏损熔断、预算余额。',
  },
  {
    id: 'injective',
    label: 'Injective Adapter',
    role: 'EXECUTE',
    doing: '接收统一 Action Intent；合约团队接入后返回授权、结算和链上回执。',
    agentId: 'execution',
  },
  {
    id: 'evolution',
    label: 'Evolution Agent',
    role: 'EVOLVE',
    doing: '将链上结果与回测偏差归档至策略表现记忆，驱动下一轮 Champion–Challenger 进化。',
    agentId: 'evolution',
  },
]

const statusIconMap: Record<FlowStatus, typeof Check> = {
  complete: Check,
  working: CircleDashed,
  waiting: Clock,
  blocked: XCircle,
}

const statusLabelMap: Record<FlowStatus, string> = {
  complete: '完成',
  working: '进行中',
  waiting: '等待',
  blocked: '已阻止',
}

function phaseIndex(phase: TaskPhase): number {
  return PHASE_ORDER.indexOf(phase)
}

function deriveSteps(task: TaskSnapshot | undefined): FlowStep[] {
  const agents = task?.agents ?? []
  const agentMap = new Map(agents.map((a) => [a.id, a] as const))
  const currentIdx = task ? phaseIndex(task.phase) : -1

  return STEP_META.map((meta) => {
    let status: FlowStatus = 'waiting'
    let detail = meta.doing

    if (!task) {
      return { ...meta, status, detail }
    }

    // input & orchestrator are considered complete once a task exists
    if (meta.id === 'input' || meta.id === 'orchestrator') {
      status = 'complete'
      detail = meta.id === 'input'
        ? `1,000 USDT · 最大亏损 5% · 仓位 ≤30% · 标的 ${task.quantEvidence?.symbol ?? '000001.SZ'}`
        : '任务拆分完成，已分发至 6 个专业 Agent'
    } else if (meta.id === 'research') {
      if (currentIdx >= phaseIndex('strategizing')) status = 'complete'
      else if (task.phase === 'researching') status = 'working'
    } else if (meta.id === 'strategy') {
      if (currentIdx >= phaseIndex('backtesting')) status = 'complete'
      else if (task.phase === 'strategizing') status = 'working'
    } else if (meta.id === 'backtest') {
      if (currentIdx >= phaseIndex('risk_review')) status = 'complete'
      else if (task.phase === 'backtesting') status = 'working'
    } else if (meta.id === 'risk') {
      if (currentIdx >= phaseIndex('awaiting_approval')) status = 'complete'
      else if (task.phase === 'risk_review') status = 'working'
    } else if (meta.id === 'firewall') {
      if (currentIdx >= phaseIndex('approved')) status = 'complete'
      else if (task.phase === 'awaiting_approval') status = 'working'
      else if (task.phase === 'approved') status = 'complete'
    } else if (meta.id === 'injective') {
      if (task.phase === 'executed') status = 'complete'
      else if (task.phase === 'executing') status = 'working'
    } else if (meta.id === 'evolution') {
      if (currentIdx >= phaseIndex('awaiting_approval')) status = 'complete'
    }

    const agent = meta.agentId ? agentMap.get(meta.agentId) : undefined
    if (agent) {
      detail = agent.detail || meta.doing
      if (agent.status === 'blocked') status = 'blocked'
    }

    return { ...meta, status, detail }
  })
}

function progressPct(steps: FlowStep[]): number {
  const complete = steps.filter((s) => s.status === 'complete').length
  const working = steps.filter((s) => s.status === 'working').length
  return Math.round(((complete + working * 0.5) / steps.length) * 100)
}

interface LogEntry {
  from: string
  to: string
  message: string
  type: 'normal' | 'veto' | 'approve'
}

function buildInteractionLog(task: TaskSnapshot | undefined): LogEntry[] {
  if (!task || task.timeline.length === 0) {
    return [
      { from: 'System', to: 'Operator', message: '等待任务启动…', type: 'normal' },
    ]
  }

  const inferred: LogEntry[] = task.timeline.map((event) => {
    const title = event.title
    let type: LogEntry['type'] = 'normal'
    let from = 'System'
    let to = 'Task'

    if (title.includes('Research')) { from = 'Research'; to = 'Orchestrator' }
    else if (title.includes('Strategy')) {
      if (title.includes('支付')) { from = 'Strategy'; to = title.split('→')[1]?.trim().split(' ')[0] ?? 'Agent' }
      else { from = 'Strategy'; to = 'Backtest' }
    }
    else if (title.includes('Backtest')) { from = 'Backtest'; to = 'Evolution' }
    else if (title.includes('Risk')) {
      from = 'Risk'
      to = 'Strategy'
      type = title.includes('退回') ? 'veto' : 'approve'
    }
    else if (title.includes('用户批准')) { from = 'Operator'; to = 'Firewall'; type = 'approve' }
    else if (title.includes('测试网') || title.includes('执行')) { from = 'Execution'; to = 'Evolution'; type = 'approve' }

    if (title.includes('冠军') || title.includes('通过') || title.includes('批准') || title.includes('确认')) {
      type = type === 'veto' ? 'veto' : 'approve'
    }

    return { from, to, message: `${title} · ${event.detail}`, type }
  })

  return inferred
}

interface TaskFlowViewProps {
  task?: TaskSnapshot
}

export function TaskFlowView({ task }: TaskFlowViewProps) {
  const steps = deriveSteps(task)
  const currentStep = steps.find((s) => s.status === 'working')
  const progress = progressPct(steps)
  const interactionLog = buildInteractionLog(task)

  return (
    <div className="flow-view">
      <section className="panel flow-pipeline-panel" aria-labelledby="pipeline-heading">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">A2A Pipeline</span>
            <h2 id="pipeline-heading">任务执行管线</h2>
          </div>
          <span className="live-mark"><i /> 运行中</span>
        </div>

        <div className="flow-progress-wrap">
          <div className="flow-progress-head">
            <span>总体进度</span>
            <strong>{progress}%</strong>
          </div>
          <div className="flow-progress-track">
            <div className="flow-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {currentStep && (
          <div className="flow-current-step">
            <Loader2 size={14} className="spin" />
            <span>当前步骤：</span>
            <strong>{currentStep.label}</strong>
            <span className="flow-current-detail">{currentStep.doing}</span>
          </div>
        )}

        <div className="flow-steps">
          {steps.map((step, index) => {
            const StatusIcon = statusIconMap[step.status]
            return (
              <div key={step.id} className={`flow-step-wrap ${step.status}`}>
                <div className={`flow-step is-${step.status}`}>
                  <div className={`flow-step-icon is-${step.status}`}>
                    <StatusIcon size={13} />
                  </div>
                  <div className="flow-step-body">
                    <div className="flow-step-header">
                      <strong>{step.label}</strong>
                      <span className="flow-role">{step.role}</span>
                    </div>
                    <p className="flow-step-detail">{step.detail}</p>
                    <p className="flow-step-doing">{step.doing}</p>
                  </div>
                  <span className={`flow-status-label is-${step.status}`}>{statusLabelMap[step.status]}</span>
                </div>
                {index < steps.length - 1 && (
                  <div className={`flow-connector ${steps[index + 1].status === 'working' ? 'active' : ''}`}>
                    <ArrowDown size={11} />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="flow-loop-note">
          <RotateCcw size={14} />
          <span>Evolution Agent 将链上结果反馈至 Backtest Agent，形成"研究—验证—进化"闭环</span>
        </div>
      </section>

      <section className="panel flow-log-panel" aria-labelledby="log-heading">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Interaction Log</span>
            <h2 id="log-heading">Agent 交互记录</h2>
          </div>
          <span className="dataset-label">{interactionLog.length} 条</span>
        </div>
        <div className="log-entries">
          {interactionLog.map((entry, index) => (
            <div className={`log-entry ${entry.type}`} key={index}>
              <span className="log-from">{entry.from}</span>
              <span className="log-arrow"><ArrowRight size={11} /></span>
              <span className="log-to">{entry.to}</span>
              <span className="log-message">{entry.message}</span>
            </div>
          ))}
        </div>
        <div className="flow-loop-note">
          <ShieldCheck size={14} />
          <span>Risk Agent 拥有独立否决权，任何策略变更必须经过风险审批</span>
        </div>
      </section>
    </div>
  )
}
