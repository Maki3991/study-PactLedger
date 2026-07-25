import type { FastifyInstance } from 'fastify';
import { treasuryIntegrationService } from './service';
import { z } from 'zod';

/**
 * 金库集成API路由
 * 遵循现有API风格，添加到app.ts中即可使用
 */
export async function registerTreasuryRoutes(fastify: FastifyInstance) {
  // 获取金库状态（公开接口，用于健康检查和仪表盘）
  fastify.get('/api/treasury/status', async (request, reply) => {
    try {
      const status = await treasuryIntegrationService.getTreasuryStatus();
      return {
        success: true,
        data: status,
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: (error as Error).message,
      });
    }
  });

  // 处理支付Intent（私有接口，需要鉴权）
  const paymentIntentSchema = z.object({
    intent: z.object({
      id: z.string(),
      type: z.literal('agent_payment'),
      appId: z.string(),
      agentId: z.string(),
      agentAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      recipientAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      amount: z.number().positive(),
      currency: z.literal('USDC'),
      description: z.string().optional(),
      metadata: z.record(z.any()).optional(),
    }),
  });

  fastify.post('/api/treasury/pay', async (request, reply) => {
    try {
      const { intent } = paymentIntentSchema.parse(request.body);
      
      // 这里可以添加现有鉴权逻辑
      // const auth = await request.validateAuth();
      // if (!auth.hasPermission('treasury:pay')) {
      //   return reply.status(403).send({ success: false, error: 'Permission denied' });
      // }

      const result = await treasuryIntegrationService.processPaymentIntent(intent as any);
      
      if (!result.success) {
        return reply.status(400).send(result);
      }

      return result;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid request format',
          details: error.errors,
        });
      }
      
      return reply.status(500).send({
        success: false,
        error: (error as Error).message,
      });
    }
  });

  // 创建演示支付Intent（用于测试）
  fastify.post('/api/treasury/demo/pay', async (request, reply) => {
    try {
      const { amount = 5.0, description = 'Demo payment' } = request.body as any;
      
      const intent = treasuryIntegrationService.createDemoPaymentIntent(amount, description);
      const result = await treasuryIntegrationService.processPaymentIntent(intent);
      
      return result;
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: (error as Error).message,
      });
    }
  });

  // 健康检查接口
  fastify.get('/api/treasury/health', async (request, reply) => {
    try {
      const status = await treasuryIntegrationService.getTreasuryStatus();
      return {
        success: true,
        status: 'healthy',
        network: status.network,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return reply.status(503).send({
        success: false,
        status: 'unhealthy',
        error: (error as Error).message,
      });
    }
  });

  console.log('✅ Treasury integration routes registered');
}
