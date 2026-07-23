import { Bot, Check, CircleDashed, ShieldAlert } from 'lucide-react'
import type { AgentRun, AgentStatus } from '../domain/trading'

const statusMeta: Record<AgentStatus, { label: string; icon: typeof Check }> = {
  complete: { label: '完成', icon: Check },
  working: { label: '复核中', icon: CircleDashed },
  blocked: { label: '已阻止', icon: ShieldAlert },
  waiting: { label: '等待', icon: Bot },
}

interface AgentRailProps {
  agents: AgentRun[]
}

export function AgentRail({ agents }: AgentRailProps) {
  return (
    <section className="panel agent-panel" aria-labelledby="agent-heading">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">A2A orchestration</span>
          <h2 id="agent-heading">Agent 协作链路</h2>
        </div>
        <span className="live-mark"><i /> 运行中</span>
      </div>

      <div className="agent-list">
        {agents.map((agent, index) => {
          const meta = statusMeta[agent.status]
          const StatusIcon = meta.icon
          return (
            <div className={`agent-row is-${agent.status}`} key={agent.id}>
              <div className="agent-sequence" aria-hidden="true">
                <span>{String(index + 1).padStart(2, '0')}</span>
              </div>
              <div className="agent-copy">
                <div className="agent-title-line">
                  <strong>{agent.name}</strong>
                  <span>{agent.role}</span>
                </div>
                <p>{agent.detail}</p>
              </div>
              <div className="agent-state">
                <span className="status-label"><StatusIcon size={13} /> {meta.label}</span>
                <time>{agent.elapsed}</time>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
