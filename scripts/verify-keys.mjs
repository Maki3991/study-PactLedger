import { PrivateKey } from '@injectivelabs/sdk-ts';

const PRIVATE_KEY = process.argv[2] || '60e23f13f054b32b841be79ce348739eaeaeb0a2b29b557f8b270c116f10f227';

const pk = PrivateKey.fromHex(PRIVATE_KEY);
const injAddr = pk.toBech32();
const evmAddr = pk.toAddress();

console.log('=== 钱包验证 ===');
console.log('Injective Address:', injAddr);
console.log('EVM Address:      ', evmAddr);

// Verify against known addresses
const expectedInj = 'inj12wmqphtdx842945klj5e5m3vezpfkmpcys4nvu';
const expectedEvm = '0x53b600dd6d31eaa2d696fca99a6e2cc8829b6c38';

console.log('\nInj 匹配:', injAddr === expectedInj ? '✅' : '❌ 不匹配!');
console.log('EVM 匹配:', evmAddr.toLowerCase() === expectedEvm.toLowerCase() ? '✅' : '❌ 不匹配!');

// Also convert the payee EVM address to Injective format
console.log('\n=== 收款地址转换 ===');
const payeeEvm = '0x82475e5440493d19954f0710618F84e1a7cDdb8d';
try {
  const { EthereumAddress } = await import('@injectivelabs/sdk-ts');
  const payeeInj = EthereumAddress.fromEthereumAddress(payeeEvm);
  console.log('Payee EVM:', payeeEvm);
  console.log('Payee Inj:', payeeInj.toBech32());
} catch (e) {
  console.log('EthereumAddress.fromEthereumAddress 失败:', e.message);
  // Fallback
  console.log('Payee EVM:', payeeEvm);
}
