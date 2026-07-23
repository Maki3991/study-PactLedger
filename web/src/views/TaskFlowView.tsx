import { ArrowDown, ArrowRight, Check, CircleDashed, Clock, RotateCcw, XCircle } from 'lucide-react'

type FlowStatus = 'complete' | 'working' | 'waiting' | 'blocked'

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

interface FlowStep {
  id: string
  label: string
  role: string
  status: FlowStatus
  detail: string
}

const flowSteps: FlowStep[] = [
  { id: 'input', label: '用户目标与风险边界', role: 'INPUT', status: 'complete', detail: '1,000 USDT · 最大亏损 5% · 仓位 ≤30%' },
  { id: 'orchestrator', label: 'A2A Orchestrator', role: 'ORCHESTRATE', status: 'complete', detail: '任务拆分完成，分发至 6 个专业 Agent' },
  { id: 'research', label: 'Research Agent', role: 'RESEARCH', status: 'complete', detail: '趋势与流动性归因，识别震荡市场状态' },
  { id: 'strategy', label: 'Strategy Agent', role: 'STRATEGY', status: 'complete', detail: '生成 V2-A、V2-B 两个候选策略版本' },
  { id: 'backtest', label: 'Backtest Agent', role: 'BACKTEST', status: 'complete', detail: '126 日滚动样本外验证通过' },
  { id: 'risk', label: 'Risk Agent', role: 'RISK VETO', status: 'working', detail: '复核 V2-B 修订仓位 (25%)' },
  { id: 'firewall', label: 'Capital Firewall', role: 'FIREWALL', status: 'waiting', detail: '等待 Risk Agent 签发' },
  { id: 'injective', label: 'Injective 测试网', role: 'EXECUTE', status: 'waiting', detail: '等待交易广播与链上确认' },
  { id: 'evolution', label: 'Evolution Agent', role: 'EVOLVE', status: 'waiting', detail: '等待链上结果反馈，准备下一轮进化' },
]

interface LogEntry {
  from: string
  to: string
  message: string
  type: 'normal' | 'veto' | 'approve'
}

const interactionLog: LogEntry[] = [
  { from: 'Backtest', to: 'Strategy', message: 'V1 样本外表现不合格，请重新设计信号组合', type: 'normal' },
  { from: 'Strategy', to: 'Backtest', message: '提交 V2-A（波动率过滤）、V2-B（状态识别）', type: 'normal' },
  { from: 'Backtest', to: 'Risk', message: 'V2-B Sharpe 1.28，成为性能冠军', type: 'normal' },
  { from: 'Risk', to: 'Strategy', message: '否决：建议仓位 40% 超过用户上限 30%', type: 'veto' },
  { from: 'Strategy', to: 'Risk', message: '修订仓位至 25%，重新提交审核', type: 'normal' },
  { from: 'Risk', to: 'Firewall', message: '签发通过，允许执行', type: 'approve' },
]

export function TaskFlowView() {
  return (
    <div className="flow-view">
      <section className="panel flow-pipeline-panel" aria-labelledby="pipeline-heading">
        <div className="panel-heading">
          <div><span className="eyebrow">A2A Pipeline</span><h2 id="pipeline-heading">任务执行管线</h2></div>
          <span className="live-mark"><i /> 运行中</span>
        </div>
        <div className="flow-steps">
          {flowSteps.map((step, index) => {
            const StatusIcon = statusIconMap[step.status]
            return (
              <div key={step.id}>
                <div className={`flow-step is-${step.status}`}>
                  <div className={`flow-step-icon is-${step.status}`}>
                    <StatusIcon size={13} />
                  </div>
                  <div className="flow-step-body">
                    <div className="flow-step-header">
                      <strong>{step.label}</strong>
                      <span className="flow-role">{step.role}</span>
                    </div>
                    <p>{step.detail}</p>
                  </div>
                  <span className={`flow-status-label is-${step.status}`}>{statusLabelMap[step.status]}</span>
                </div>
                {index < flowSteps.length - 1 && (
                  <div className="flow-connector"><ArrowDown size={11} /></div>
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
          <div><span className="eyebrow">Interaction Log</span><h2 id="log-heading">Agent 交互记录</h2></div>
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
          <XCircle size={14} />
          <span>Risk Agent 拥有独立否决权，任何策略变更必须经过风险审批</span>
        </div>
      </section>
    </div>
  )
}
