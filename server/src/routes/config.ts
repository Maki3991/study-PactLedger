import { Router } from 'express'

export const configRouter = Router()

// GET /api/config/injective – returns mock config status
configRouter.get('/injective', (_req, res) => {
  res.json({
    mode: 'mock',
    network: 'testnet',
    chainId: 'injective-888',
    adapter: 'mock',
    readyForExecution: true,
    credentialsConfigured: false,
    walletAddress: undefined,
    marketIdConfigured: true,
    subaccountIdConfigured: true,
    endpoints: {
      rpc: 'https://testnet.sentry.tm.injective.network:443',
      rest: 'https://testnet.sentry.lcd.injective.network',
      grpc: 'https://testnet.sentry.chain.grpc-web.injective.network',
    },
    missing: ['INJECTIVE_PRIVATE_KEY'],
  })
})
