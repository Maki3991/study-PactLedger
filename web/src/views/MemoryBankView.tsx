import {
  BookOpen,
  Brain,
  Clock,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  User,
  Wallet,
} from 'lucide-react'
import type { TaskSnapshot } from '../domain/trading'

const userFeedback = [
  { type: 'positive' as const, text: '认可 V2-B 的状态识别逻辑', time: '10:37' },
  { type: 'negative' as const, text: '不接受超过 30% 的仓位建议', time: '10:36' },
  { type: 'positive' as const, text: '偏好在趋势确认后分批建仓', time: '10:15' },
]

interface MemoryBankViewProps {
  task?: TaskSnapshot
}

export function MemoryBankView({ task }: MemoryBankViewProps) {
  const objective = task?.objective ?? ''
  const budgetMatch = objective.match(/(\d+(?:,?\d*))\s*USDT/)
  const budget = budgetMatch ? `${budgetMatch[1]} USDT` : '1,000 USDT'
  const maxLossMatch = objective.match(/(\d+(?:\.\d+)?)%.*亏损/)
  const maxLoss = maxLossMatch ? `${maxLossMatch[1]}%` : '5.0%'
  const asset = task?.objective.includes('ETH') ? 'ETH' : 'ETH'

  const userProfile = [
    { icon: Clock, label: '投资期限', value: '中期 (1–4 周)', updated: '2026-07-20' },
    { icon: ShieldCheck, label: '风险承受能力', value: `中等（最大回撤 ${maxLoss}）`, updated: '2026-07-20' },
    { icon: Wallet, label: '交易预算', value: budget, updated: '2026-07-23' },
    { icon: BookOpen, label: '允许交易资产', value: asset, updated: '2026-07-23' },
  ]

  const strategyVersions = task?.candidates?.length
    ? [...task.candidates]
      .sort((a, b) => {
        if (a.status === 'approved') return -1
        if (b.status === 'approved') return 1
        return b.sharpe - a.sharpe
      })
      .map((c) => ({
        version: c.name,
        status: c.status === 'approved' ? 'active' : 'archived',
        fingerprint: `sha256:${c.id.padEnd(7, '0')}`,
        returnPct: c.returnPct,
        drawdownPct: c.drawdownPct,
        sharpe: c.sharpe,
        txHash: c.status === 'approved' ? task.execution.transactionHash : null,
        deviation: c.status === 'approved' ? '+0.3%' : c.status === 'rejected' ? '-4.9%' : null,
        upgradeReason: c.note,
      }))
    : []

  return (
    <div className="memory-view">
      <section className="panel memory-profile-panel" aria-labelledby="profile-heading">
        <div className="panel-heading">
          <div><span className="eyebrow">User Profile Memory</span><h2 id="profile-heading">用户偏好记忆</h2></div>
          <User size={18} className="memory-panel-icon" />
        </div>
        <div className="memory-section">
          {userProfile.map((item) => (
            <div className="memory-item" key={item.label}>
              <div className="memory-item-icon"><item.icon size={14} /></div>
              <div className="memory-item-body">
                <strong>{item.label}</strong>
                <p>{item.value}</p>
                <span className="memory-meta">更新于 {item.updated}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="panel-heading memory-feedback-heading">
          <div><span className="eyebrow">Feedback</span><h2 className="memory-feedback-title">历史反馈</h2></div>
        </div>
        <div className="memory-section">
          {userFeedback.map((item, index) => (
            <div className="memory-item" key={index}>
              <div className={`memory-item-icon ${item.type === 'positive' ? 'positive' : 'negative'}`}>
                {item.type === 'positive' ? <ThumbsUp size={13} /> : <ThumbsDown size={13} />}
              </div>
              <div className="memory-item-body">
                <p>{item.text}</p>
                <span className="memory-meta">{item.time}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel memory-strategy-panel" aria-labelledby="strategy-heading">
        <div className="panel-heading">
          <div><span className="eyebrow">Strategy Performance Memory</span><h2 id="strategy-heading">策略表现记忆</h2></div>
          <Brain size={18} className="memory-panel-icon" />
        </div>
        <div className="memory-section">
          {strategyVersions.length === 0 ? (
            <div className="memory-empty">
              <Brain size={28} />
              <p>启动任务后，策略版本表现将自动归档至记忆库。</p>
            </div>
          ) : (
            strategyVersions.map((sv) => (
              <div className={`strategy-version-card ${sv.status}`} key={sv.version}>
                <div className="sv-header">
                  <div className="sv-title">
                    <strong>{sv.version}</strong>
                    <span className={`sv-badge ${sv.status}`}>{sv.status === 'active' ? '当前版本' : '已归档'}</span>
                  </div>
                  <span className="sv-fingerprint">{sv.fingerprint}</span>
                </div>
                <div className="sv-metrics">
                  <div><span>收益</span><strong className="positive">{sv.returnPct.toFixed(1)}%</strong></div>
                  <div><span>回撤</span><strong className={sv.drawdownPct > 5 ? 'negative' : ''}>{sv.drawdownPct.toFixed(1)}%</strong></div>
                  <div><span>Sharpe</span><strong>{sv.sharpe.toFixed(2)}</strong></div>
                  {sv.deviation && <div><span>偏差</span><strong className={sv.deviation.startsWith('+') ? 'positive' : 'negative'}>{sv.deviation}</strong></div>}
                </div>
                <p className="sv-reason">{sv.upgradeReason}</p>
                {sv.txHash && (
                  <div className="sv-tx">
                    <span>链上凭证</span>
                    <code>{sv.txHash}</code>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
