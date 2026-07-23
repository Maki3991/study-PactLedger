import { ArrowRight, Check, GitBranch, TrendingDown, TrendingUp, X } from 'lucide-react'
import type { StrategyCandidate } from '../domain/trading'

interface EvolutionPanelProps {
  candidates: StrategyCandidate[]
  selectedId: string
  onSelect: (id: string) => void
}

export function EvolutionPanel({ candidates, selectedId, onSelect }: EvolutionPanelProps) {
  return (
    <section className="panel evolution-panel" aria-labelledby="evolution-heading">
      <div className="panel-heading evolution-heading-row">
        <div>
          <span className="eyebrow">Alpha evolution loop</span>
          <h2 id="evolution-heading">策略竞争实验</h2>
        </div>
        <span className="dataset-label">126D / OOS</span>
      </div>

      <div className="evolution-path" aria-label="策略版本进化路径">
        <button className={selectedId === 'v1' ? 'version-node selected rejected' : 'version-node rejected'} onClick={() => onSelect('v1')}>
          <span>V1</span><small>Champion</small>
        </button>
        <span className="path-line"><X size={12} /></span>
        <span className="fork-node"><GitBranch size={16} /></span>
        <span className="path-line branch"><ArrowRight size={12} /></span>
        <button className={selectedId === 'v2a' ? 'version-node selected testing' : 'version-node testing'} onClick={() => onSelect('v2a')}>
          <span>V2-A</span><small>Challenger</small>
        </button>
        <button className={selectedId === 'v2b' ? 'version-node selected winner' : 'version-node winner'} onClick={() => onSelect('v2b')}>
          <span>V2-B</span><small>Winner</small>
        </button>
      </div>

      <div className="strategy-table-wrap">
        <table className="strategy-table">
          <thead>
            <tr>
              <th>版本</th>
              <th>核心信号</th>
              <th>收益</th>
              <th>最大回撤</th>
              <th>Sharpe</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => (
              <tr className={selectedId === candidate.id ? 'selected-row' : ''} key={candidate.id} onClick={() => onSelect(candidate.id)}>
                <td><strong>{candidate.name}</strong></td>
                <td>{candidate.signal}</td>
                <td className="positive"><TrendingUp size={13} /> {candidate.returnPct.toFixed(1)}%</td>
                <td className={candidate.drawdownPct > 5 ? 'negative' : ''}><TrendingDown size={13} /> {candidate.drawdownPct.toFixed(1)}%</td>
                <td>{candidate.sharpe.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="selected-strategy-note">
        <Check size={15} />
        <span><strong>{candidates.find((item) => item.id === selectedId)?.name}</strong> · {candidates.find((item) => item.id === selectedId)?.note}</span>
      </div>
    </section>
  )
}
