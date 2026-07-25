import type { InjectiveConfigStatus } from '../../src/domain/trading.js'

export type InjectiveExecutionMode = 'mock' | 'testnet'

export interface InjectiveConfig {
  mode: InjectiveExecutionMode
  network: 'testnet'
  chainId: string
  rpcEndpoint: string
  restEndpoint: string
  grpcEndpoint: string
  indexerEndpoint: string
  walletAddress?: string
  privateKey?: string
  paymentDenom?: string
  paymentDecimals?: number
  explorerTxBaseUrl: string
  contractAddress?: string
  payeeAddresses: {
    risk?: string
    execution?: string
    poolmateMerchant?: string
  }
  feeDenom: string
  gasPrice: string
}

const defaults = {
  chainId: 'injective-888',
  rpcEndpoint: 'https://testnet.sentry.tm.injective.network:443',
  restEndpoint: 'https://testnet.sentry.lcd.injective.network:443',
  grpcEndpoint: 'https://testnet.sentry.chain.grpc-web.injective.network:443',
  indexerEndpoint: 'https://testnet.sentry.exchange.grpc-web.injective.network',
  explorerTxBaseUrl: 'https://testnet.explorer.injective.network/transaction/',
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
    indexerEndpoint: environment.INJECTIVE_INDEXER_ENDPOINT || defaults.indexerEndpoint,
    walletAddress: emptyToUndefined(environment.INJECTIVE_WALLET_ADDRESS),
    privateKey: emptyToUndefined(environment.INJECTIVE_PRIVATE_KEY),
    paymentDenom: emptyToUndefined(environment.INJECTIVE_PAYMENT_DENOM),
    paymentDecimals: parseDecimals(environment.INJECTIVE_PAYMENT_DECIMALS),
    explorerTxBaseUrl: normalizeBaseUrl(
      environment.INJECTIVE_EXPLORER_TX_BASE_URL || defaults.explorerTxBaseUrl,
    ),
    contractAddress: emptyToUndefined(environment.INJECTIVE_CONTRACT_ADDRESS),
    payeeAddresses: {
      risk: emptyToUndefined(environment.INJECTIVE_RISK_PAYEE_ADDRESS),
      execution: emptyToUndefined(environment.INJECTIVE_EXECUTION_PAYEE_ADDRESS),
      poolmateMerchant: emptyToUndefined(environment.INJECTIVE_POOLMATE_MERCHANT_ADDRESS),
    },
    feeDenom: environment.INJECTIVE_FEE_DENOM || defaults.feeDenom,
    gasPrice: environment.INJECTIVE_GAS_PRICE || defaults.gasPrice,
  }
}

export function getInjectiveConfigStatus(config: InjectiveConfig): InjectiveConfigStatus {
  const signerRequired = [
    ['INJECTIVE_WALLET_ADDRESS', config.walletAddress],
    ['INJECTIVE_PRIVATE_KEY', config.privateKey],
  ] as const
  const paymentRequired = [
    ['INJECTIVE_PAYMENT_DENOM', config.paymentDenom],
    ['INJECTIVE_PAYMENT_DECIMALS', config.paymentDecimals],
    ['INJECTIVE_RISK_PAYEE_ADDRESS', config.payeeAddresses.risk],
    ['INJECTIVE_EXECUTION_PAYEE_ADDRESS', config.payeeAddresses.execution],
    ['INJECTIVE_POOLMATE_MERCHANT_ADDRESS', config.payeeAddresses.poolmateMerchant],
  ] as const
  const missing = [...signerRequired, ...paymentRequired]
    .filter(([, value]) => value === undefined || value === '')
    .map(([name]) => name)
  const credentialsConfigured = signerRequired.every(([, value]) => Boolean(value))
  const paymentAssetConfigured = Boolean(config.paymentDenom) && config.paymentDecimals !== undefined
  const payeesConfigured = Object.values(config.payeeAddresses).every(Boolean)
  const testnetReady = credentialsConfigured && paymentAssetConfigured && payeesConfigured

  return {
    mode: config.mode,
    network: config.network,
    chainId: config.chainId,
    adapter: config.mode === 'mock' ? 'mock' : 'injective-testnet',
    executionState: config.mode === 'mock'
      ? 'mock_ready'
      : testnetReady ? 'testnet_ready' : 'testnet_configuration_required',
    readyForExecution: config.mode === 'mock' || testnetReady,
    credentialsConfigured,
    paymentAssetConfigured,
    payeesConfigured,
    walletAddress: maskWalletAddress(config.walletAddress),
    paymentDenom: config.paymentDenom,
    paymentDecimals: config.paymentDecimals,
    explorerTxBaseUrl: config.explorerTxBaseUrl,
    payees: {
      risk: Boolean(config.payeeAddresses.risk),
      execution: Boolean(config.payeeAddresses.execution),
      poolmateMerchant: Boolean(config.payeeAddresses.poolmateMerchant),
    },
    endpoints: {
      rpc: config.rpcEndpoint,
      rest: config.restEndpoint,
      grpc: config.grpcEndpoint,
      indexer: config.indexerEndpoint,
    },
    missing,
  }
}

export function getInjectivePayeeAddress(config: InjectiveConfig, payeeId: string): string | undefined {
  if (payeeId === 'risk') return config.payeeAddresses.risk
  if (payeeId === 'execution') return config.payeeAddresses.execution
  if (payeeId === 'merchant-demo') return config.payeeAddresses.poolmateMerchant
  return undefined
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

function parseDecimals(value: string | undefined): number | undefined {
  const normalized = emptyToUndefined(value)
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 30 ? parsed : undefined
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}
