import { useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  BarChart3,
  BrainCircuit,
  Database,
  GitBranch,
  Layers,
  LoaderCircle,
  Search,
  TrendingUp,
  Workflow,
  Zap,
} from 'lucide-react'
import type { DecisionRecord } from '../domain/trading'
import { useKnowledgeBase } from './useKnowledgeBase'

const presetSymbols = ['000001.SZ', '600519.SH', '300750.SZ']

export function KnowledgeBase() {
  const [symbol, setSymbol] = useState('')
  const [searchSymbol, setSearchSymbol] = useState('')
  const { records, total, loading, error } = useKnowledgeBase(searchSymbol || undefined)

  const submitSearch = (event?: FormEvent) => {
    event?.preventDefault()
    setSearchSymbol(symbol.trim().toUpperCase())
  }

  const clearSearch = () => {
    setSymbol('')
    setSearchSymbol('')
  }

  return (
    <div className="kb-app">
      <header className="kb-nav">
        <a className="kb-nav-brand" href="/">
          <span className="kb-brand-glyph"><Workflow size={16} /></span>
          <span><strong>PactLedger</strong><small>Knowledge Base</small></span>
        </a>
        <div className="kb-product-path">
          <ArrowRight size={13} />
          <span>Agent Memory</span>
          <em>Decision Records</em>
        </div>
        <div className="kb-nav-actions">
          <a className="kb-nav-link" href="/kaleidox.html">KaleidoX</a>
          <a className="kb-nav-link" href="/poolmate.html">PoolMate</a>
        </div>
      </header>

      <main className="kb-main">
        <section className="kb-hero">
          <div>
            <p className="kb-kicker">DECISION AGENT KNOWLEDGE BASE</p>
            <h1>Agent 策略决策记忆库</h1>
            <p>每次 AI 策略生成与评估的决策记录，包含市场状态诊断、候选策略提案与最终选择。这些记录构成 DecisionAgent 的训练记忆。</p>
          </div>
          <aside className="kb-hero-stats">
            <StatCard icon={Database} label="决策记录总数" value={loading ? '…' : String(total)} />
            <StatCard icon={BrainCircuit} label="AI 策略提案" value={loading ? '…' : String(records.reduce((sum, r) => sum + r.proposals.length, 0))} />
            <StatCard icon={Layers} label="覆盖股票" value={loading ? '…' : String(new Set(records.map((r) => r.symbol)).size)} />
          </aside>
        </section>

        <section className="kb-toolbar">
          <form className="kb-search" onSubmit={submitSearch}>
            <Search size={16} />
            <input
              type="text"
              placeholder="输入股票代码搜索，如 000001.SZ"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              aria-label="搜索股票代码"
            />
            {searchSymbol && (
              <button type="button" className="kb-search-clear" onClick={clearSearch}>清除</button>
            )}
          </form>
          <div className="kb-presets">
            {presetSymbols.map((s) => (
              <button
                key={s}
                className={searchSymbol === s ? 'active' : ''}
                type="button"
                onClick={() => { setSymbol(s); setSearchSymbol(s) }}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        {error && <div className="kb-error" role="alert">{error}</div>}

        {loading ? (
          <div className="kb-loading">
            <LoaderCircle size={24} className="spin" />
            <p>正在加载决策记录…</p>
          </div>
        ) : records.length === 0 ? (
          <EmptyState symbol={searchSymbol} />
        ) : (
          <>
            <RegimeChart records={records} />
            <DecisionTimeline records={records} />
          </>
        )}
      </main>

      <footer className="kb-footer">
        <span><strong>PactLedger</strong> Agent Knowledge Base</span>
        <span>DecisionAgent 训练记忆 · PostgreSQL 持久化 · DeepSeek V4 Pro 驱动的策略生成</span>
      </footer>
    </div>
  )
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: string }) {
  return (
    <div className="kb-stat-card">
      <Icon size={20} />
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </div>
  )
}

function EmptyState({ symbol }: { symbol?: string }) {
  return (
    <section className="kb-empty">
      <div className="kb-empty-icon"><Database size={48} /></div>
      <h2>{symbol ? `没有 ${symbol} 的决策记录` : '知识库为空'}</h2>
      <p>
        {symbol
          ? `尚未对 ${symbol} 生成任何策略决策。请在 KaleidoX 中创建一个任务来开始训练 DecisionAgent。`
          : '启动 KaleidoX 任务后，Agent 的策略生成与评估记录将自动归档到这里。'}
      </p>
      <a className="kb-empty-link" href="/kaleidox.html">前往 KaleidoX 创建任务 <ArrowLeft size={14} style={{ transform: 'rotate(180deg)' }} /></a>
    </section>
  )
}

function RegimeChart({ records }: { records: DecisionRecord[] }) {
  const regimes = new Map<string, number>()
  records.forEach((r) => {
    regimes.set(r.marketRegime, (regimes.get(r.marketRegime) ?? 0) + 1)
  })
  const sorted = [...regimes.entries()].sort((a, b) => b[1] - a[1])
  const maxCount = sorted[0]?.[1] ?? 1

  return (
    <section className="kb-regime-chart" aria-label="市场状态分布">
      <div className="kb-section-title">
        <BarChart3 size={18} />
        <h2>市场状态分布</h2>
      </div>
      <div className="kb-regime-bars">
        {sorted.map(([regime, count]) => (
          <div className="kb-regime-bar" key={regime}>
            <div className="kb-regime-label">
              <span>{regime}</span>
              <strong>{count}</strong>
            </div>
            <div className="kb-regime-track">
              <div className="kb-regime-fill" style={{ width: `${(count / maxCount) * 100}%` }} />
            </div>
          </div>
        ))}
        {sorted.length === 0 && <p className="kb-empty-text">暂无市场状态数据</p>}
      </div>
    </section>
  )
}

function DecisionTimeline({ records }: { records: DecisionRecord[] }) {
  return (
    <section className="kb-timeline" aria-label="决策时间线">
      <div className="kb-section-title">
        <GitBranch size={18} />
        <h2>决策记录时间线</h2>
        <small>{records.length} 条记录</small>
      </div>
      <div className="kb-timeline-list">
        {records.map((record, index) => (
          <DecisionCard key={record.id} record={record} index={records.length - index} />
        ))}
      </div>
    </section>
  )
}

function DecisionCard({ record, index }: { record: DecisionRecord; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const selectedProposal = record.proposals.find((p) => p.name === record.selectedStrategy)

  return (
    <article className={`kb-decision-card ${expanded ? 'expanded' : ''}`}>
      <div className="kb-card-header" onClick={() => setExpanded(!expanded)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setExpanded(!expanded) }}>
        <div className="kb-card-marker">
          <span>{String(index).padStart(2, '0')}</span>
        </div>
        <div className="kb-card-meta">
          <div className="kb-card-top">
            <strong>{record.symbol}</strong>
            <span className={`kb-regime-badge ${regimeTone(record.marketRegime)}`}>{record.marketRegime}</span>
            <span className="kb-strategy-badge">{record.selectedStrategy}</span>
          </div>
          <div className="kb-card-sub">
            <time>{record.date}</time>
            <span>{record.proposals.length} 个提案</span>
            <span>置信度 {selectedProposal ? Math.round(selectedProposal.confidence * 100) : '—'}%</span>
          </div>
        </div>
        <div className="kb-card-toggle">{expanded ? '收起' : '展开'}</div>
      </div>

      {expanded && (
        <div className="kb-card-body">
          <div className="kb-card-evidence">
            <div className="kb-evidence-grid">
              <div><span>Provider</span><strong>{record.evidence.provider}</strong></div>
              <div><span>区间</span><strong>{record.evidence.startDate} — {record.evidence.endDate}</strong></div>
              <div><span>日线数</span><strong>{record.evidence.barCount}</strong></div>
              <div><span>方法</span><strong>{record.evidence.sourceMethod}</strong></div>
            </div>
          </div>

          <div className="kb-proposals">
            <h4>AI 策略提案</h4>
            {record.proposals.map((proposal) => (
              <div
                className={`kb-proposal-card ${proposal.name === record.selectedStrategy ? 'selected' : ''}`}
                key={proposal.id}
              >
                <div className="kb-proposal-head">
                  <strong>{proposal.name}</strong>
                  {proposal.name === record.selectedStrategy && <span className="kb-selected-tag"><Zap size={11} /> 选中</span>}
                  <span className="kb-confidence">{Math.round(proposal.confidence * 100)}% 置信</span>
                </div>
                <p>{proposal.description}</p>
                <div className="kb-proposal-rules">
                  <div><small>开仓</small><code>{proposal.entryRules}</code></div>
                  <div><small>平仓</small><code>{proposal.exitRules}</code></div>
                  <div><small>仓位</small><code>{proposal.positionLogic}</code></div>
                </div>
                <p className="kb-proposal-rationale"><TrendingUp size={12} /> {proposal.rationale}</p>
              </div>
            ))}
          </div>

          <div className="kb-record-id">
            <span>Decision ID</span>
            <code>{record.id}</code>
          </div>
        </div>
      )}
    </article>
  )
}

function regimeTone(regime: string): string {
  const map: Record<string, string> = {
    '牛市': 'bull',
    '熊市': 'bear',
    '震荡': 'range',
    '震荡偏牛': 'bull',
    '趋势': 'trend',
    '高波动': 'volatile',
    '低波动震荡': 'range',
  }
  return map[regime] ?? 'neutral'
}
