import type { QuantEvidence, StrategyCandidate } from '../../src/domain/trading.js'

export interface PriceBar {
  date: string
  close: number
  volume: number
}

export interface MarketDataQuery {
  symbol: string
  startDate: string
  endDate: string
}

export interface MarketDataResult {
  bars: PriceBar[]
  provider: QuantEvidence['provider']
  configured: boolean
  note: string
}

export interface MarketDataProvider {
  fetchDaily(query: MarketDataQuery): Promise<MarketDataResult>
}

export interface QuantAnalysis {
  candidates: StrategyCandidate[]
  winner: StrategyCandidate
  evidence: QuantEvidence
  researchSummary: string
}
