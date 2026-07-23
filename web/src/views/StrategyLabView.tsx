import { AlertTriangle, Award, GitBranch, TrendingDown, TrendingUp, X } from 'lucide-react'

interface StrategyMetric {
  version: string
  status: 'champion' | 'challenger' | 'winner' | 'rejected'
  signal: string
  returnPct: number
  drawdownPct: number
  sharpe: number
  winRate: number
  volatility: number
  oosReturn: number
  trades: number
}

const metrics: StrategyMetric[] = [
  { version: 'V1', status: 'rejected', signal: '趋势跟随', returnPct: 3.2, drawdownPct: 8.1, sharpe: 0.74, winRate: 42, volatility: 18.3, oosReturn: -1.2, trades: 23 },
  { version: 'V2-A', status: 'challenger', signal: '过滤趋势', returnPct: 4.0, drawdownPct: 5.7, sharpe: 1.06, winRate: 56, volatility: 12.1, oosReturn: 3.1, trades: 15 },
  { version: 'V2-B', status: 'winner', signal: '状态识别', returnPct: 4.6, drawdownPct: 4.2, sharpe: 1.28, winRate: 61, volatility: 9.8, oosReturn: 4.0, trades: 11 },
]

const failureAttribution = [
  'V1 过度依赖短期趋势信号，在震荡行情中连续产生错误入场',
  '未识别当前市场状态（震荡 vs 趋势），导致策略与环境不匹配',
  '交易频率过高（23 笔），放大错误信号影响并增加手续费损耗',
]

const mechanismSteps = [
  { step: '01', text: 'Evolution Agent 从失败交易中生成多个候选策略变体' },
  { step: '02', text: 'Backtest Agent 使用相同数据区间进行 Champion–Challenger 回测' },
  { step: '03', text: '只有风险调整后表现更好、且通过样本外验证的候选策略才能晋级' },
  { step: '04', text: 'Risk Agent 重新审核，高风险变更需用户确认' },
  { step: '05', text: '获胜策略升级为新版本，后续交易关联到明确的策略版本' },
]

export function StrategyLabView() {
  return (
    <div className="lab-view">
      <section className="panel lab-metrics-panel" aria-labelledby="metrics-heading">
        <div className="panel-heading">
          <div><span className="eyebrow">Backtest Comparison</span><h2 id="metrics-heading">回测指标对比</h2></div>
          <span className="dataset-label">126D / OOS</span>
        </div>
        <div className="strategy-table-wrap">
          <table className="strategy-table lab-table">
            <thead>
              <tr>
                <th>版本</th>
                <th>信号</th>
                <th>收益</th>
                <th>回撤</th>
                <th>Sharpe</th>
                <th>胜率</th>
                <th>波动率</th>
                <th>OOS 收益</th>
                <th>交易数</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.version} className={m.status === 'winner' ? 'selected-row' : ''}>
                  <td><strong>{m.version}</strong></td>
                  <td>{m.signal}</td>
                  <td className="positive"><TrendingUp size={13} /> {m.returnPct.toFixed(1)}%</td>
                  <td className={m.drawdownPct > 5 ? 'negative' : ''}><TrendingDown size={13} /> {m.drawdownPct.toFixed(1)}%</td>
                  <td>{m.sharpe.toFixed(2)}</td>
                  <td>{m.winRate}%</td>
                  <td>{m.volatility.toFixed(1)}%</td>
                  <td className={m.oosReturn >= 0 ? 'positive' : 'negative'}>{m.oosReturn >= 0 ? '+' : ''}{m.oosReturn.toFixed(1)}%</td>
                  <td>{m.trades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="selected-strategy-note">
          <Award size={15} />
          <span><strong>V2-B</strong> 在风险调整后表现最优（Sharpe 1.28，回撤 4.2%），成为 Champion</span>
        </div>
      </section>

      <div className="lab-side">
        <section className="panel attribution-panel" aria-labelledby="attribution-heading">
          <div className="panel-heading">
            <div><span className="eyebrow">Failure Attribution</span><h2 id="attribution-heading">V1 失败归因</h2></div>
            <X size={18} className="attribution-icon" />
          </div>
          <div className="attribution-body">
            {failureAttribution.map((text, index) => (
              <div className="attribution-item" key={index}>
                <AlertTriangle size={14} />
                <p>{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="panel mechanism-panel" aria-labelledby="mechanism-heading">
          <div className="panel-heading">
            <div><span className="eyebrow">Champion–Challenger</span><h2 id="mechanism-heading">晋级机制</h2></div>
            <GitBranch size={18} className="mechanism-icon" />
          </div>
          <div className="mechanism-body">
            {mechanismSteps.map((item) => (
              <div className="mechanism-step" key={item.step}>
                <span>{item.step}</span>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
