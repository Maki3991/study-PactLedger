import { Router } from 'express'

export const agentCardRouter = Router()

/**
 * A2A Agent Card – required for PandaAI Remote Agent submission
 * Spec: https://google.github.io/A2A/specification/
 */
agentCardRouter.get('/', (req, res) => {
  const base = process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8787}`

  res.json({
    name: 'KaleidoX',
    description:
      'An AI investment team with independent wallets and market-driven evolution. ' +
      'Agents research, strategize, backtest, assess risk, and execute on Injective testnet. ' +
      'Backed by Agent Treasury – programmable spend controls enforced at the contract layer.',
    url: `${base}/a2a`,
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: [
      {
        id: 'market-research',
        name: 'Market Research',
        description: 'Research asset market conditions, identify opportunities and risks using PandaAI data skills.',
        tags: ['research', 'finance', 'market-analysis'],
        examples: [
          'Research ETH trading opportunities for the next week',
          '分析 ETH 市场机会，预算 1000 USDT',
        ],
      },
      {
        id: 'strategy-generation',
        name: 'Strategy Generation',
        description: 'Generate and backtest candidate trading strategies with Champion-Challenger comparison.',
        tags: ['strategy', 'backtest', 'quant'],
        examples: [
          'Generate a trading strategy for ETH with max 5% drawdown',
        ],
      },
      {
        id: 'risk-review',
        name: 'Independent Risk Review',
        description: 'Independent veto-powered risk assessment. Verifies strategies against user-defined constraints.',
        tags: ['risk', 'compliance', 'veto'],
      },
      {
        id: 'injective-execution',
        name: 'Injective Testnet Execution',
        description: 'Execute approved strategies on Injective testnet after Treasury and firewall checks.',
        tags: ['execution', 'injective', 'defi'],
      },
      {
        id: 'strategy-evolution',
        name: 'Strategy Evolution',
        description: 'Analyze failed trades, generate next-gen candidates, run Champion-Challenger competition.',
        tags: ['evolution', 'learning', 'optimization'],
      },
    ],
  })
})
