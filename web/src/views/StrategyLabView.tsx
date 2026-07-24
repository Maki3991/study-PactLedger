import { AlertTriangle, Award, GitBranch, TrendingDown, TrendingUp, X } from 'lucide-react'
import type { StrategyCandidate, TaskSnapshot } from '../domain/trading'

const failureAttribution = [
  'V1 的短周期均线在震荡区间反复交叉，容易产生无效交易',
  '未区分趋势与震荡市场，策略在不同状态下使用同一触发条件',
  '频繁调仓会放大股票交易手续费和滑点对收益的影响',
]

const mechanismSteps = [
  { step: '01', text: 'PandaAI Provider 获取股票日线并记录来源与区间' },
  { step: '02', text: 'Backtest Agent 在相同数据和手续费假设下比较三个版本' },
  { step: '03', text: '只有回撤合规、风险调整后表现更好的策略才能成为候选冠军' },
  { step: '04', text: 'Policy Engine 检查预算和单股仓位，高风险请求必须退回' },
  { step: '05', text: '获批策略转换为统一 Action Intent，再交给 Injective Adapter' },
]

interface StrategyLabViewProps {
  task?: TaskSnapshot
}

export function StrategyLabView({ task }: StrategyLabViewProps) {
  const candidates: StrategyCandidate[] = task?.candidates?.length ? task.candidates : []
  const winner = candidates.find((candidate) => candidate.status === 'approved')
    ?? candidates.reduce<StrategyCandidate | undefined>(
      (best, candidate) => !best || candidate.sharpe > best.sharpe ? candidate : best,
      undefined,
    )
  const evidence = task?.quantEvidence

  return (
    <div className="lab-view">
      <section className="panel lab-metrics-panel" aria-labelledby="metrics-heading">
        <div className="panel-heading">
          <div><span className="eyebrow">Backtest Comparison</span><h2 id="metrics-heading">股票回测指标对比</h2></div>
          <span className="dataset-label">{evidence ? `${evidence.barCount} bars / OOS` : '等待任务'}</span>
        </div>

        {candidates.length === 0 ? (
          <div className="lab-empty">
            <GitBranch size={28} />
            <p>启动任务后，候选策略将在相同股票数据上进行 Champion–Challenger 对比。</p>
          </div>
        ) : (
          <>
            <div className="strategy-table-wrap">
              <table className="strategy-table lab-table">
                <thead>
                  <tr>
                    <th>版本</th><th>信号</th><th>收益</th><th>回撤</th><th>Sharpe</th>
                    <th>胜率</th><th>波动率</th><th>OOS 收益</th><th>交易数</th><th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <tr key={candidate.id} className={candidate.status === 'approved' ? 'selected-row' : ''}>
                      <td><strong>{candidate.name}</strong></td>
                      <td>{candidate.signal}</td>
                      <td className={candidate.returnPct >= 0 ? 'positive' : 'negative'}><TrendingUp size={13} /> {candidate.returnPct.toFixed(2)}%</td>
                      <td className={candidate.drawdownPct > 5 ? 'negative' : ''}><TrendingDown size={13} /> {candidate.drawdownPct.toFixed(2)}%</td>
                      <td>{candidate.sharpe.toFixed(2)}</td>
                      <td>{candidate.winRate.toFixed(1)}%</td>
                      <td>{candidate.volatility.toFixed(2)}%</td>
                      <td className={candidate.oosReturn >= 0 ? 'positive' : 'negative'}>{candidate.oosReturn >= 0 ? '+' : ''}{candidate.oosReturn.toFixed(2)}%</td>
                      <td>{candidate.trades}</td>
                      <td><span className={`lab-status status-${candidate.status}`}>{candidate.status === 'approved' ? '冠军' : candidate.status === 'rejected' ? '淘汰' : '验证中'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {winner && (
              <div className="selected-strategy-note">
                <Award size={15} />
                <span><strong>{winner.name}</strong> 风险调整后表现最优（Sharpe {winner.sharpe.toFixed(2)}，回撤 {winner.drawdownPct.toFixed(2)}%）</span>
              </div>
            )}
          </>
        )}
      </section>

      <div className="lab-side">
        <section className="panel attribution-panel" aria-labelledby="attribution-heading">
          <div className="panel-heading"><div><span className="eyebrow">Failure Attribution</span><h2 id="attribution-heading">V1 失败归因</h2></div><X size={18} className="attribution-icon" /></div>
          <div className="attribution-body">
            {failureAttribution.map((text, index) => <div className="attribution-item" key={index}><AlertTriangle size={14} /><p>{text}</p></div>)}
          </div>
        </section>

        <section className="panel mechanism-panel" aria-labelledby="mechanism-heading">
          <div className="panel-heading"><div><span className="eyebrow">Evidence Pipeline</span><h2 id="mechanism-heading">基座接入过程</h2></div><GitBranch size={18} className="mechanism-icon" /></div>
          <div className="mechanism-body">
            {mechanismSteps.map((item) => <div className="mechanism-step" key={item.step}><span>{item.step}</span><p>{item.text}</p></div>)}
          </div>
        </section>
      </div>
    </div>
  )
}
