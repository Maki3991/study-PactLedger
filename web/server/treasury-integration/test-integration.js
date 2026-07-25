// 简单的JS测试脚本，验证集成功能
import 'dotenv/config';
import { createPublicClient, http, parseAbi } from 'viem';
import { injectiveTestnet } from 'viem/chains';

// 测试配置
const config = {
  rpcUrl: 'https://k8s.testnet.json-rpc.injective.network/',
  chainId: 1439,
  explorerBaseUrl: 'https://testnet.blockscout.injective.network',
  agentTreasuryAddress: '0x8E095A6B47D3883f647A1014a022729338A96bb9',
  usdcTokenAddress: '0xcbf90cf717BC05eBC2D601946cD03a518fFFED27',
  demoAgentAddress: '0x33C9c60503fDc3dE476cf9FC597ce6A2203e53bC',
};

async function testIntegration() {
  console.log('🧪 测试金库集成功能\n');

  const client = createPublicClient({
    chain: injectiveTestnet,
    transport: http(config.rpcUrl),
  });

  try {
    console.log('1️⃣ 测试Injective网络连接...');
    const blockNumber = await client.getBlockNumber();
    console.log(`✅ 连接成功，最新区块号: ${blockNumber}\n`);

    console.log('2️⃣ 测试金库合约读取...');
    const treasuryAbi = parseAbi([
      'function owner() view returns (address)',
      'function token() view returns (address)',
    ]);

    const [owner, token] = await Promise.all([
      client.readContract({
        address: config.agentTreasuryAddress,
        abi: treasuryAbi,
        functionName: 'owner',
      }),
      client.readContract({
        address: config.agentTreasuryAddress,
        abi: treasuryAbi,
        functionName: 'token',
      }),
    ]);

    console.log(`✅ 金库合约正常:`);
    console.log(`   所有者: ${owner}`);
    console.log(`   结算代币: ${token}\n`);

    console.log('3️⃣ 测试代币余额读取...');
    const erc20Abi = parseAbi([
      'function balanceOf(address account) view returns (uint256)',
      'function symbol() view returns (string)',
    ]);

    const [balance, symbol] = await Promise.all([
      client.readContract({
        address: config.usdcTokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [config.agentTreasuryAddress],
      }),
      client.readContract({
        address: config.usdcTokenAddress,
        abi: erc20Abi,
        functionName: 'symbol',
      }),
    ]);

    console.log(`✅ 代币信息正常:`);
    console.log(`   符号: ${symbol}`);
    console.log(`   金库余额: ${Number(balance) / 1e6} ${symbol}\n`);

    console.log('🎉 所有集成测试通过！功能完全正常。');
    console.log('\n🚀 集成完成，你可以：');
    console.log('   1. 按照 docs/TREASURY_MANUAL_INTEGRATION.md 添加2行代码到app.ts');
    console.log('   2. 启动后端服务，访问 /api/treasury/status 查看状态');
    console.log('   3. 配置私钥后即可进行真实链上支付');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

testIntegration();
