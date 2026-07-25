import { createPublicClient, createWalletClient, http, parseAbi, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { injectiveTestnet } from 'viem/chains';
import { injectiveConfig } from '../config/injective';

// AgentTreasury合约ABI（核心方法）
const treasuryAbi = parseAbi([
  'function owner() view returns (address)',
  'function token() view returns (address)',
  'function getBalance(address account) view returns (uint256)',
  'function spendingLimits(address account) view returns (uint256 limit, uint256 used, uint256 resetTime)',
  'function setSpendingLimit(address account, uint256 limit, uint256 period) external',
  'function spend(address recipient, uint256 amount, bytes calldata intentId) external returns (bytes32 receiptId)',
  'function getReceipt(bytes32 receiptId) view returns (tuple(address from, address to, uint256 amount, bytes32 intentId, uint256 timestamp, bool executed))',
]);

// SettlementGateway合约ABI
const gatewayAbi = parseAbi([
  'function owner() view returns (address)',
  'function signer() view returns (address)',
  'function supportedTokens(address token) view returns (bool)',
  'function settlePayment(address from, address to, uint256 amount, bytes32 intentId, bytes calldata signature) external returns (bytes32 settlementId)',
]);

// ERC20 ABI
const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

/**
 * 金库客户端 - 与Injective测试网上部署的AgentTreasury合约交互
 * 完全兼容现有PactLedger架构
 */
export class TreasuryClient {
  private publicClient: ReturnType<typeof createPublicClient>;
  private walletClient: ReturnType<typeof createWalletClient> | null = null;

  constructor() {
    this.publicClient = createPublicClient({
      chain: injectiveTestnet,
      transport: http(injectiveConfig.rpcUrl),
    });

    // 如果配置了私钥，初始化钱包客户端用于发送交易
    if (injectiveConfig.privateKey) {
      const account = privateKeyToAccount(injectiveConfig.privateKey as Address);
      this.walletClient = createWalletClient({
        account,
        chain: injectiveTestnet,
        transport: http(injectiveConfig.rpcUrl),
      });
    }
  }

  /**
   * 获取金库合约状态
   */
  async getTreasuryStatus() {
    const [owner, token, balance] = await Promise.all([
      this.publicClient.readContract({
        address: injectiveConfig.agentTreasuryAddress as Address,
        abi: treasuryAbi,
        functionName: 'owner',
      }),
      this.publicClient.readContract({
        address: injectiveConfig.agentTreasuryAddress as Address,
        abi: treasuryAbi,
        functionName: 'token',
      }),
      this.publicClient.readContract({
        address: injectiveConfig.usdcTokenAddress as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [injectiveConfig.agentTreasuryAddress as Address],
      }),
    ]);

    return {
      owner,
      token,
      balance: Number(balance) / 1e6,
      balanceUnit: 'USDC',
      network: 'Injective Testnet',
      explorerUrl: `${injectiveConfig.explorerBaseUrl}/address/${injectiveConfig.agentTreasuryAddress}`,
    };
  }

  /**
   * 获取Agent的消费限额信息
   */
  async getAgentSpendingLimit(agentAddress: Address) {
    const [limit, used, resetTime] = await this.publicClient.readContract({
      address: injectiveConfig.agentTreasuryAddress as Address,
      abi: treasuryAbi,
      functionName: 'spendingLimits',
      args: [agentAddress],
    });

    return {
      limit: Number(limit) / 1e6,
      used: Number(used) / 1e6,
      remaining: (Number(limit) - Number(used)) / 1e6,
      resetTime: new Date(Number(resetTime) * 1000),
      unit: 'USDC',
    };
  }

  /**
   * 获取代币信息
   */
  async getTokenInfo() {
    const [name, symbol, decimals, treasuryBalance, gatewayBalance] = await Promise.all([
      this.publicClient.readContract({
        address: injectiveConfig.usdcTokenAddress as Address,
        abi: erc20Abi,
        functionName: 'name',
      }),
      this.publicClient.readContract({
        address: injectiveConfig.usdcTokenAddress as Address,
        abi: erc20Abi,
        functionName: 'symbol',
      }),
      this.publicClient.readContract({
        address: injectiveConfig.usdcTokenAddress as Address,
        abi: erc20Abi,
        functionName: 'decimals',
      }),
      this.publicClient.readContract({
        address: injectiveConfig.usdcTokenAddress as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [injectiveConfig.agentTreasuryAddress as Address],
      }),
      this.publicClient.readContract({
        address: injectiveConfig.usdcTokenAddress as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [injectiveConfig.settlementGatewayAddress as Address],
      }),
    ]);

    return {
      name,
      symbol,
      decimals,
      treasuryBalance: Number(treasuryBalance) / 1e6,
      gatewayBalance: Number(gatewayBalance) / 1e6,
      unit: 'USDC',
    };
  }

  /**
   * 执行Agent支付（需要配置私钥）
   * 遵循 Intent -> Settlement -> Receipt 流程
   */
  async executeAgentPayment(
    agentAddress: Address,
    recipientAddress: Address,
    amount: number,
    intentId: string
  ) {
    if (!this.walletClient) {
      throw new Error('Private key not configured, cannot execute payment');
    }

    const amountWei = BigInt(Math.floor(amount * 1e6));
    
    // 1. 检查余额和限额
    const [balance, limitInfo] = await Promise.all([
      this.publicClient.readContract({
        address: injectiveConfig.usdcTokenAddress as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [agentAddress],
      }),
      this.getAgentSpendingLimit(agentAddress),
    ]);

    if (Number(balance) / 1e6 < amount) {
      throw new Error(`Insufficient balance: ${Number(balance) / 1e6} USDC < ${amount} USDC`);
    }

    if (limitInfo.remaining < amount) {
      throw new Error(`Spending limit exceeded: remaining ${limitInfo.remaining} USDC < ${amount} USDC`);
    }

    // 2. 执行支付
    const txHash = await this.walletClient.writeContract({
      address: injectiveConfig.agentTreasuryAddress as Address,
      abi: treasuryAbi,
      functionName: 'spend',
      args: [recipientAddress, amountWei, Buffer.from(intentId).toString('hex') as Address],
    });

    // 3. 等待交易确认
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    // 4. 返回可验证的支付结果
    return {
      success: receipt.status === 'success',
      txHash,
      explorerUrl: `${injectiveConfig.explorerBaseUrl}/tx/${txHash}`,
      blockNumber: receipt.blockNumber,
      intentId,
      amount,
      recipient: recipientAddress,
      from: agentAddress,
      timestamp: new Date(),
    };
  }

  /**
   * 获取交易收据
   */
  async getReceipt(receiptId: string) {
    const receipt = await this.publicClient.readContract({
      address: injectiveConfig.agentTreasuryAddress as Address,
      abi: treasuryAbi,
      functionName: 'getReceipt',
      args: [receiptId as Address],
    });

    return {
      from: receipt[0],
      to: receipt[1],
      amount: Number(receipt[2]) / 1e6,
      intentId: Buffer.from(receipt[3].slice(2), 'hex').toString(),
      timestamp: new Date(Number(receipt[4]) * 1000),
      executed: receipt[5],
    };
  }
}

// 单例实例
export const treasuryClient = new TreasuryClient();
