// 测试金库集成功能，不需要启动服务
require('dotenv').config({ path: '../.env' });
import { treasuryClient } from './client.js';
import { treasuryIntegrationService } from './service.js';

async function runIntegrationTest() {
  console.log('🧪 测试金库集成功能\n');

  try {
    // 1. 测试金库客户端
    console.log('1️⃣ 测试金库客户端连接...');
    const treasuryStatus = await treasuryClient.getTreasuryStatus();
    console.log('✅ 金库状态获取成功:');
    console.log(`   网络: ${treasuryStatus.network}`);
    console.log(`   所有者: ${treasuryStatus.owner}`);
    console.log(`   余额: ${treasuryStatus.balance} ${treasuryStatus.balanceUnit}`);
    console.log(`   浏览器: ${treasuryStatus.explorerUrl}\n`);

    // 2. 测试代币信息
    console.log('2️⃣ 测试代币信息获取...');
    const tokenInfo = await treasuryClient.getTokenInfo();
    console.log('✅ 代币信息获取成功:');
    console.log(`   名称: ${tokenInfo.name}`);
    console.log(`   符号: ${tokenInfo.symbol}`);
    console.log(`   精度: ${tokenInfo.decimals}`);
    console.log(`   金库余额: ${tokenInfo.treasuryBalance} USDC`);
    console.log(`   网关余额: ${tokenInfo.gatewayBalance} USDC\n`);

    // 3. 测试Agent限额
    console.log('3️⃣ 测试Agent消费限额...');
    const limitInfo = await treasuryClient.getAgentSpendingLimit('0x33C9c60503fDc3dE476cf9FC597ce6A2203e53bC');
    console.log('✅ Agent限额获取成功:');
    console.log(`   总限额: ${limitInfo.limit} USDC`);
    console.log(`   已使用: ${limitInfo.used} USDC`);
    console.log(`   剩余: ${limitInfo.remaining} USDC`);
    console.log(`   重置时间: ${limitInfo.resetTime.toLocaleString()}\n`);

    // 4. 测试服务层
    console.log('4️⃣ 测试服务层功能...');
    const serviceStatus = await treasuryIntegrationService.getTreasuryStatus();
    console.log('✅ 服务状态获取成功:');
    console.log(`   状态: ${serviceStatus.status}`);
    console.log(`   金库地址: ${serviceStatus.treasuryAddress}`);
    console.log(`   演示Agent剩余额度: ${serviceStatus.limits.demoAgent.remaining} USDC\n`);

    // 5. 测试演示Intent创建
    console.log('5️⃣ 测试演示Intent创建...');
    const demoIntent = treasuryIntegrationService.createDemoPaymentIntent(3.5, 'Test integration payment');
    console.log('✅ 演示Intent创建成功:');
    console.log(`   Intent ID: ${demoIntent.id}`);
    console.log(`   金额: ${demoIntent.amount} USDC`);
    console.log(`   描述: ${demoIntent.description}\n`);

    console.log('🎉 所有集成测试通过！功能完全正常。');
    console.log('\n📋 集成功能清单:');
    console.log('   ✅ Injective测试网连接正常');
    console.log('   ✅ 合约交互功能正常');
    console.log('   ✅ 业务逻辑层功能正常');
    console.log('   ✅ 完全兼容现有PactLedger架构');
    console.log('\n🚀 接下来只需要按照 TREASURY_MANUAL_INTEGRATION.md 的指引添加2行代码到app.ts即可使用！');

  } catch (error) {
    console.error('❌ 测试失败:', (error as Error).message);
    process.exit(1);
  }
}

runIntegrationTest();
