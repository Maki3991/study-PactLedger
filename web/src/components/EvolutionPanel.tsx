import { Fragment } from 'react'
import { ArrowRight, Check, GitBranch, TrendingDown, TrendingUp, X } from 'lucide-react'
import type { StrategyCandidate } from '../domain/trading'

interface EvolutionPanelProps {
  candidates: StrategyCandidate[]
  selectedId: string
  onSelect: (id: string) => void
}

export function EvolutionPanel({ candidates, selectedId, onSelect }: EvolutionPanelProps) {
  const statusLabel = (candidate: StrategyCandidate) => candidate.status === 'approved'
    ? 'Winner'
    : candidate.status === 'rejected' ? 'Rejected' : 'Challenger'

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
        {candidates.map((candidate, index) => {
          const stateClass = candidate.status === 'approved' ? 'winner' : candidate.status
          return (
            <Fragment key={candidate.id}>
              {index > 0 && (
                <>
                  <span className="path-line">{candidates[index - 1].status === 'rejected' ? <X size={12} /> : <ArrowRight size={12} />}</span>
                  {index === 1 && <span className="fork-node"><GitBranch size={16} /></span>}
                </>
              )}
              <button className={`version-node ${stateClass}${selectedId === candidate.id ? ' selected' : ''}`} onClick={() => onSelect(candidate.id)}>
                <span>{candidate.name}</span><small>{statusLabel(candidate)}</small>
              </button>
            </Fragment>
          )
        })}
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
