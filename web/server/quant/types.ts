import type {
  CompletedResearchArtifacts,
  QuantEvidence,
  ResearchDataSourceEvidence,
  ResearchIndustryContext,
  ResearchPriceBar,
  ResearchStockProfile,
  StrategyCandidate,
} from '../../src/domain/trading.js'

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
  enrichment?: {
    stockProfile?: ResearchStockProfile
    industry?: ResearchIndustryContext
    benchmark?: { symbol: string; bars: ResearchPriceBar[] }
    sources: ResearchDataSourceEvidence[]
  }
  provider: QuantEvidence['provider']
  configured: boolean
  sourceMethod: QuantEvidence['sourceMethod']
  sdkVersion: QuantEvidence['sdkVersion']
  adjustment: QuantEvidence['adjustment']
  skill: QuantEvidence['skill']
  note: string
}

export interface MarketDataProvider {
  fetchDaily(query: MarketDataQuery): Promise<MarketDataResult>
}

export interface QuantAnalysis {
  candidates: StrategyCandidate[]
  winner: StrategyCandidate
  evidence: QuantEvidence
  artifacts: CompletedResearchArtifacts
  researchSummary: string
}
