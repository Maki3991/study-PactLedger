import type { InjectiveConfigStatus } from '../../src/domain/trading.js'

export type InjectiveExecutionMode = 'mock' | 'testnet'

export interface InjectiveConfig {
  mode: InjectiveExecutionMode
  network: 'testnet'
  chainId: string
  rpcEndpoint: string
  restEndpoint: string
  grpcEndpoint: string
  walletAddress?: string
  privateKey?: string
  marketId?: string
  subaccountId?: string
  feeDenom: string
  gasPrice: string
}

const defaults = {
  chainId: 'injective-888',
  rpcEndpoint: 'https://testnet.sentry.tm.injective.network:443',
  restEndpoint: 'https://testnet.sentry.lcd.injective.network:443',
  grpcEndpoint: 'https://testnet.sentry.chain.grpc-web.injective.network:443',
  feeDenom: 'inj',
  gasPrice: '500000000',
}

export function readInjectiveConfig(environment: NodeJS.ProcessEnv = process.env): InjectiveConfig {
  const mode = environment.INJECTIVE_EXECUTION_MODE === 'testnet' ? 'testnet' : 'mock'
  return {
    mode,
    network: 'testnet',
    chainId: environment.INJECTIVE_CHAIN_ID || defaults.chainId,
    rpcEndpoint: environment.INJECTIVE_RPC_ENDPOINT || defaults.rpcEndpoint,
    restEndpoint: environment.INJECTIVE_REST_ENDPOINT || defaults.restEndpoint,
    grpcEndpoint: environment.INJECTIVE_GRPC_ENDPOINT || defaults.grpcEndpoint,
    walletAddress: emptyToUndefined(environment.INJECTIVE_WALLET_ADDRESS),
    privateKey: emptyToUndefined(environment.INJECTIVE_PRIVATE_KEY),
    marketId: emptyToUndefined(environment.INJECTIVE_MARKET_ID),
    subaccountId: emptyToUndefined(environment.INJECTIVE_SUBACCOUNT_ID),
    feeDenom: environment.INJECTIVE_FEE_DENOM || defaults.feeDenom,
    gasPrice: environment.INJECTIVE_GAS_PRICE || defaults.gasPrice,
  }
}

export function getInjectiveConfigStatus(config: InjectiveConfig): InjectiveConfigStatus {
  const required = [
    ['INJECTIVE_WALLET_ADDRESS', config.walletAddress],
    ['INJECTIVE_PRIVATE_KEY', config.privateKey],
    ['INJECTIVE_MARKET_ID', config.marketId],
    ['INJECTIVE_SUBACCOUNT_ID', config.subaccountId],
  ] as const
  const missing = required.filter(([, value]) => !value).map(([name]) => name)

  return {
    mode: config.mode,
    network: config.network,
    chainId: config.chainId,
    adapter: config.mode === 'mock' ? 'mock' : 'testnet-pending',
    readyForExecution: config.mode === 'mock',
    credentialsConfigured: missing.length === 0,
    walletAddress: maskWalletAddress(config.walletAddress),
    marketIdConfigured: Boolean(config.marketId),
    subaccountIdConfigured: Boolean(config.subaccountId),
    endpoints: {
      rpc: config.rpcEndpoint,
      rest: config.restEndpoint,
      grpc: config.grpcEndpoint,
    },
    missing,
  }
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function maskWalletAddress(address?: string): string | undefined {
  if (!address) return undefined
  if (address.length <= 14) return `${address.slice(0, 4)}...${address.slice(-3)}`
  return `${address.slice(0, 10)}...${address.slice(-6)}`
}
