import { treasuryClient } from './client';
import type { ActionIntent, AgentPaymentIntent } from '../../pactledger/intents';
import { policyEngine } from '../../pactledger/policyEngine';

/**
 * 整合后的金库服务，完全兼容现有PactLedger架构
 * 遵循 Intent -> PolicyDecision -> Settlement -> Receipt 流程
 */
export class TreasuryIntegrationService {
  /**
   * 处理Agent支付Intent
   * 这是与现有架构集成的主入口
   */
  async processPaymentIntent(intent: AgentPaymentIntent) {
    // 1. 验证Intent格式
    this.validateIntent(intent);

    // 2. 执行策略校验（复用现有PactLedger的策略引擎）
    const policyDecision = await policyEngine.evaluate(intent);
    if (!policyDecision.approved) {
      return {
        success: false,
        error: `Policy rejected: ${policyDecision.reason}`,
        decision: policyDecision,
        intent,
      };
    }

    // 3. 执行链上结算
    try {
      const settlementResult = await treasuryClient.executeAgentPayment(
        intent.agentAddress as `0x${string}`,
        intent.recipientAddress as `0x${string}`,
        intent.amount,
        intent.id
      );

      // 4. 返回标准化的Receipt，兼容现有Receipt格式
      return {
        success: true,
        intent,
        policyDecision,
        settlement: {
          id: settlementResult.txHash,
          txHash: settlementResult.txHash,
          explorerUrl: settlementResult.explorerUrl,
          blockNumber: settlementResult.blockNumber.toString(),
          chainId: 'injective-testnet-1439',
          timestamp: settlementResult.timestamp,
        },
        receipt: {
          id: `receipt_${intent.id}`,
          intentId: intent.id,
          amount: intent.amount,
          currency: intent.currency,
          status: 'confirmed',
          confirmedAt: settlementResult.timestamp,
          explorerUrl: settlementResult.explorerUrl,
          metadata: {
            from: settlementResult.from,
            to: settlementResult.recipient,
            blockNumber: settlementResult.blockNumber,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Settlement failed: ${(error as Error).message}`,
        intent,
        policyDecision,
      };
    }
  }

  /**
   * 获取金库状态，用于健康检查和仪表盘
   */
  async getTreasuryStatus() {
    const [treasuryStatus, tokenInfo, demoAgentLimit] = await Promise.all([
      treasuryClient.getTreasuryStatus(),
      treasuryClient.getTokenInfo(),
      treasuryClient.getAgentSpendingLimit(process.env.INJECTIVE_DEMO_AGENT as `0x${string}` || '0x33C9c60503fDc3dE476cf9FC597ce6A2203e53bC'),
    ]);

    return {
      network: treasuryStatus.network,
      treasuryAddress: process.env.INJECTIVE_AGENT_TREASURY,
      gatewayAddress: process.env.INJECTIVE_SETTLEMENT_GATEWAY,
      token: {
        symbol: tokenInfo.symbol,
        name: tokenInfo.name,
        decimals: tokenInfo.decimals,
      },
      balances: {
        treasury: tokenInfo.treasuryBalance,
        gateway: tokenInfo.gatewayBalance,
        demoAgentRemaining: demoAgentLimit.remaining,
      },
      limits: {
        demoAgent: {
          total: demoAgentLimit.limit,
          used: demoAgentLimit.used,
          remaining: demoAgentLimit.remaining,
          resetTime: demoAgentLimit.resetTime,
        },
      },
      explorer: {
        treasuryUrl: treasuryStatus.explorerUrl,
        baseUrl: process.env.INJECTIVE_EXPLORER_URL,
      },
      status: 'operational',
    };
  }

  /**
   * 验证支付Intent格式
   */
  private validateIntent(intent: AgentPaymentIntent) {
    if (!intent.id) throw new Error('Intent ID is required');
    if (!intent.agentAddress) throw new Error('Agent address is required');
    if (!intent.recipientAddress) throw new Error('Recipient address is required');
    if (!intent.amount || intent.amount <= 0) throw new Error('Valid amount is required');
    if (!intent.currency || intent.currency !== 'USDC') throw new Error('Only USDC payments are supported');
    
    // 验证地址格式
    if (!/^0x[a-fA-F0-9]{40}$/.test(intent.agentAddress)) {
      throw new Error('Invalid agent address format');
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(intent.recipientAddress)) {
      throw new Error('Invalid recipient address format');
    }
  }

  /**
   * 创建演示用的支付Intent，用于快速测试
   */
  createDemoPaymentIntent(amount: number = 5.0, description: string = 'Demo AI service payment'): AgentPaymentIntent {
    return {
      id: `intent_demo_${Date.now()}`,
      type: 'agent_payment',
      appId: 'poolmate',
      agentId: 'demo_agent_001',
      agentAddress: process.env.INJECTIVE_DEMO_AGENT || '0x33C9c60503fDc3dE476cf9FC597ce6A2203e53bC',
      recipientAddress: process.env.INJECTIVE_MERCHANT_TREASURY || '0xAA213Af5D85bC34e6F0639cF963b961AF0ab90E5',
      amount,
      currency: 'USDC',
      description,
      metadata: {
        demo: true,
        timestamp: new Date().toISOString(),
      },
      createdAt: new Date(),
    };
  }
}

// 单例实例
export const treasuryIntegrationService = new TreasuryIntegrationService();
