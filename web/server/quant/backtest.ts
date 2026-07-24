import type { StrategyCandidate } from '../../src/domain/trading.js'
import type { PriceBar } from './types.js'

type StrategyId = 'v1' | 'v2a' | 'v2b'

interface StrategyDefinition {
  id: StrategyId
  name: string
  signal: string
  note: string
  positionAt: (bars: PriceBar[], index: number) => number
}

const feeRate = 0.001

export function runCandidateBacktests(bars: PriceBar[], maxLossPct: number): StrategyCandidate[] {
  if (bars.length < 60) throw new Error('At least 60 price bars are required for backtesting')
  const definitions = createDefinitions()
  const candidates = definitions.map((definition) => backtest(definition, bars))
  const eligible = candidates.filter((candidate) => candidate.drawdownPct <= maxLossPct)
  const winnerPool = eligible.length ? eligible : candidates
  const winner = winnerPool.reduce((best, candidate) => candidate.sharpe > best.sharpe ? candidate : best)
  return candidates.map((candidate) => ({
    ...candidate,
    status: candidate.id === winner.id ? 'approved' : candidate.id === 'v1' ? 'rejected' : 'testing',
    note: candidate.id === winner.id ? `${candidate.note}，风险调整后表现最佳` : candidate.note,
  }))
}

function createDefinitions(): StrategyDefinition[] {
  return [
    {
      id: 'v1',
      name: 'V1',
      signal: '双均线',
      note: '5/20 日双均线，震荡区间容易反复交易',
      positionAt: (bars, index) => sma(bars, index, 5) > sma(bars, index, 20) ? 0.30 : 0,
    },
    {
      id: 'v2a',
      name: 'V2-A',
      signal: '均线 + 波动率过滤',
      note: '仅在短期波动率可控时跟随趋势',
      positionAt: (bars, index) => sma(bars, index, 5) > sma(bars, index, 20) && volatility(bars, index, 10) < 0.022 ? 0.30 : 0,
    },
    {
      id: 'v2b',
      name: 'V2-B',
      signal: '均线 + 市场状态',
      note: '要求中期趋势强度确认，降低震荡市误触发',
      positionAt: (bars, index) => {
        const short = sma(bars, index, 10)
        const long = sma(bars, index, 30)
        return short > long && (short - long) / long > 0.009 ? 0.25 : 0
      },
    },
  ]
}

function backtest(definition: StrategyDefinition, bars: PriceBar[]): StrategyCandidate {
  const dailyReturns: number[] = []
  const equity: number[] = [1]
  let previousPosition = 0
  let trades = 0
  let activeWins = 0
  let activeDays = 0

  for (let index = 1; index < bars.length; index += 1) {
    const position = definition.positionAt(bars, index - 1)
    const turnover = Math.abs(position - previousPosition)
    if (position > 0 && previousPosition === 0) trades += 1
    const marketReturn = bars[index].close / bars[index - 1].close - 1
    const strategyReturn = previousPosition * marketReturn - turnover * feeRate
    if (previousPosition > 0) {
      activeDays += 1
      if (strategyReturn > 0) activeWins += 1
    }
    dailyReturns.push(strategyReturn)
    equity.push(equity.at(-1)! * (1 + strategyReturn))
    previousPosition = position
  }

  const splitIndex = Math.max(1, Math.floor(dailyReturns.length * 0.7))
  const oosEquity = dailyReturns.slice(splitIndex).reduce((value, item) => value * (1 + item), 1)
  const average = mean(dailyReturns)
  const dailyVolatility = standardDeviation(dailyReturns)
  const annualizedVolatility = dailyVolatility * Math.sqrt(252)
  const sharpe = dailyVolatility === 0 ? 0 : average / dailyVolatility * Math.sqrt(252)

  return {
    id: definition.id,
    name: definition.name,
    status: 'testing',
    note: definition.note,
    returnPct: round((equity.at(-1)! - 1) * 100),
    drawdownPct: round(maxDrawdown(equity) * 100),
    sharpe: round(sharpe),
    winRate: round(activeDays ? activeWins / activeDays * 100 : 0),
    volatility: round(annualizedVolatility * 100),
    oosReturn: round((oosEquity - 1) * 100),
    trades,
    signal: definition.signal,
  }
}

function sma(bars: PriceBar[], index: number, window: number): number {
  if (index < window - 1) return bars[index].close
  let total = 0
  for (let cursor = index - window + 1; cursor <= index; cursor += 1) total += bars[cursor].close
  return total / window
}

function volatility(bars: PriceBar[], index: number, window: number): number {
  if (index < window) return Number.POSITIVE_INFINITY
  const returns: number[] = []
  for (let cursor = index - window + 1; cursor <= index; cursor += 1) {
    returns.push(bars[cursor].close / bars[cursor - 1].close - 1)
  }
  return standardDeviation(returns)
}

function maxDrawdown(equity: number[]): number {
  let peak = equity[0]
  let worst = 0
  for (const value of equity) {
    peak = Math.max(peak, value)
    worst = Math.max(worst, (peak - value) / peak)
  }
  return worst
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
}

function standardDeviation(values: number[]): number {
  const average = mean(values)
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)))
}

function round(value: number): number {
  return Number(value.toFixed(2))
}
