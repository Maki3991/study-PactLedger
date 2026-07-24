# PactLedger × Injective Agent 支付接入交接

> 目标：让 PactLedger 已批准的 `AgentPaymentIntent` 在 Injective Testnet 完成真实结算，并产生可验证、可恢复、不可重复支付的 `SettlementReceipt`。
> 产品口径以 [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md) 为准。

## 1. 先统一正确边界

Injective 在本项目中负责：

- Agent 间服务采购，例如 Strategy 向 Risk 支付审核费。
- Agent 向白名单外部服务或商户付款。
- 退款、退差等后续结算。
- 提供交易哈希、区块高度和 Explorer 证据。

Injective 不负责：

- 提供 A 股行情；数据来自 PandaAI。
- 在 Injective 上买卖或托管真实 A 股。
- 替代未来证券 Broker。
- 接收 KaleidoX 的 `stock_trade ActionIntent` 直接下链上现货订单。

演示统一说法：

> PandaAI 提供股票数据，KaleidoX 生成研究与业务动作，PactLedger 控制 Agent 能否花钱，Injective 结算 Agent 支付并留下 Receipt。

## 2. 当前代码状态

已具备：

- 通用 `AgentPaymentIntent`、`PolicyDecision`、`SettlementReceipt` 领域模型。
- `SettlementAdapter` 接口。
- 可复现的 `MockInjectiveAdapter`。
- `testnet` 配置读取、私钥脱敏和未就绪阻断。
- PostgreSQL Intent / Decision / Receipt 三表持久化、幂等读取与最近 Testnet Receipt 查询。
- KaleidoX Risk 服务费与 PoolMate 商户付款均复用通用 `PactLedgerService` / `SettlementAdapter` 边界。
- `InjectiveTestnetSettlementAdapter` 已使用官方 SDK `MsgSend` 实现直接转账，包含白名单、denom/精度、原子金额、地址/签名一致性、区块确认 Receipt 与稳定错误码。
- 并发相同 Intent 只调用一次 Adapter；已确认或失败 Receipt 在重启后可恢复。
- lint、生产构建与 API tests `37/37` 已通过，其中包含 Injective Adapter、配置、幂等与中断状态测试。

尚未具备：

- 已确认的真实 Testnet Receipt。
- 可验证的 Treasury 合约部署 Manifest。
- 广播超时后的链上查询与恢复。
- 真实钱包、白名单收款地址、支付 denom/精度与测试币配置。

当前中断保护：如果服务重启后发现 Intent 停在 `settling`，系统会生成 `SETTLEMENT_RECOVERY_REQUIRED` 失败 Receipt 并停止自动重播，以优先避免双花。这是安全隔离，不是链上恢复；后续仍需通过交易哈希或 `PactLedger:<intentId>` memo 查询链上结果。

当前关键接口：

```ts
export interface SettlementAdapter {
  settle(intent: AgentPaymentIntent): Promise<SettlementReceipt>
}
```

位置：

```text
web/src/domain/pactledger.ts
web/server/adapters/execution.ts
web/server/adapters/createExecutionAdapter.ts
web/server/pactledger/
web/server/config/injective.ts
```

## 3. 第一笔真实交易

P0 只做一笔非常小的测试网付款：

```text
appId       = kaleidox
payer       = strategy
payee       = risk
purpose     = risk_review
protocol    = internal
amount      = 小额测试资产
```

理由：

- 业务语义最容易解释。
- 金额小，风险低。
- 正好位于风控否决的 Demo 转折。
- 可以证明“股票不用上链，Agent 服务费可以上链”。

第二笔再做：

```text
appId       = poolmate
payer       = poolmate-treasury
payee       = merchant-demo
purpose     = merchant_pay
```

两笔必须复用同一个 Adapter。

## 4. 推荐实现路线

### 路线 A：直接 Testnet 转账（当前已实现）

当前 `web/server/adapters/injectiveTestnet.ts` 已使用 Injective 官方 SDK 在服务端发送 `MsgSend`：

1. 从服务端环境读取私钥。
2. 校验 Intent 已由 PactLedger Policy 批准。
3. 将业务 `currency` 映射为链上 denom 与原子单位。
4. 构造转账消息。
5. 签名并广播。
6. 要求 SDK 返回 `code=0`、交易哈希与有效区块高度。
7. 生成并持久化 Receipt。

代码与单元测试已完成；尚未提供真实钱包/资产/测试币，因此没有真实广播与 Explorer Receipt。此时策略由 PactLedger 服务端强制，链负责结算与证据。不要宣称“Policy 已被合约锁死”。

### 路线 B：Treasury 合约（更强）

如果链上队友能及时交付，可调用支付合约：

```json
{
  "execute_payment": {
    "intent_id": "PAY-...",
    "tenant_id_hash": "sha256:...",
    "payee": "inj...",
    "denom": "...",
    "amount": "2500000",
    "purpose_hash": "sha256:...",
    "policy_decision_id": "PDEC-...",
    "expires_at": 1780000000
  }
}
```

合约至少检查：

- `intent_id` 未执行过。
- payee 在白名单。
- denom 被允许。
- amount 不超过单笔上限。
- Intent 未过期。
- 调用者有 Treasury 执行权限。

推荐事件：

```text
event: agent_payment
intent_id
tenant_id_hash
payer
payee
denom
amount
purpose_hash
policy_decision_id
```

## 5. 领域映射

业务模型使用易读金额，链上 Adapter 必须做显式映射：

```ts
interface PaymentAssetMapping {
  currency: string
  denom: string
  decimals: number
}
```

要求：

- 禁止使用浮点数直接计算原子单位。
- 链上 amount 使用字符串或 BigInt。
- 映射表必须由服务端配置维护。
- 未知币种直接拒绝，不能猜 denom。
- Intent 的 `payeeId` 先通过 Policy，再映射到受信地址；如果传入 `payeeAddress`，仍需校验与白名单一致。

## 6. 配置调整

目标环境变量：

```dotenv
INJECTIVE_EXECUTION_MODE=mock
INJECTIVE_NETWORK=testnet
INJECTIVE_CHAIN_ID=injective-888
INJECTIVE_RPC_ENDPOINT=https://testnet.sentry.tm.injective.network:443
INJECTIVE_REST_ENDPOINT=https://testnet.sentry.lcd.injective.network:443
INJECTIVE_GRPC_ENDPOINT=https://testnet.sentry.chain.grpc-web.injective.network:443
INJECTIVE_INDEXER_ENDPOINT=https://testnet.sentry.exchange.grpc-web.injective.network

INJECTIVE_WALLET_ADDRESS=
INJECTIVE_PRIVATE_KEY=
INJECTIVE_PAYMENT_DENOM=
INJECTIVE_PAYMENT_DECIMALS=
INJECTIVE_EXPLORER_TX_BASE_URL=https://testnet.explorer.injective.network/transaction/

INJECTIVE_RISK_PAYEE_ADDRESS=
INJECTIVE_EXECUTION_PAYEE_ADDRESS=
INJECTIVE_POOLMATE_MERCHANT_ADDRESS=

INJECTIVE_CONTRACT_ADDRESS=
INJECTIVE_FEE_DENOM=inj
INJECTIVE_GAS_PRICE=500000000
```

`INJECTIVE_MARKET_ID` 与 `INJECTIVE_SUBACCOUNT_ID` 面向早期现货交易草稿，当前 Agent 支付 Adapter 不读取它们，环境变量示例也已移除。当前规则：

```text
mock 模式：不要求 signer
testnet 直接转账：要求 wallet/private key/payment denom/decimals 和收款白名单地址
testnet 合约：额外要求 contract address
```

私钥规则：

- 只放服务器 `.env` / `.env.local`。
- 文件权限在 Linux 保持 `600`。
- 禁止 `VITE_` 前缀。
- 禁止写入日志、API、错误对象或 Git。
- `/api/config/injective` 只能返回脱敏地址和布尔状态。

## 7. Adapter 与 Service 的实际行为

当前实现位置：

```text
web/server/adapters/injectiveTestnet.ts   SDK MsgSend、输入校验、Receipt 映射
web/server/pactledger/service.ts          Policy 后结算、并发去重、重试与中断隔离
web/server/pactledger/repository.ts       Intent / Decision / Receipt PostgreSQL 持久化
```

已经做到：

1. 只接收通过 Policy、进入 `settling` 且未过期的 Payment Intent。
2. 再次校验 Testnet chain ID、payee 白名单、Injective 地址、denom、decimals、amount 与原子金额。
3. 校验私钥派生地址与配置钱包一致，signer 只存在于服务端实例。
4. 只有 SDK 返回 `code=0`、交易哈希和正区块高度时才生成 confirmed Receipt。
5. SDK/RPC 错误映射为稳定错误码，原始敏感错误与私钥不会外泄。
6. 进程内并发相同 Intent 只调用一次 Adapter；已有 confirmed/failed Receipt 的重试直接返回原 Trace。
7. Intent、Decision、Receipt 立即写入 PostgreSQL。

仍需补齐：

1. 用真实 Testnet 钱包完成第一次广播并打开 Explorer 验证。
2. 广播结果不确定或进程中断时，按已知 tx hash / memo 查询 Indexer，而不是只隔离状态。
3. 如需更强的跨实例并发保证，增加数据库锁或唯一执行租约。

保留 Mock Adapter。比赛现场网络异常时允许降级，但 UI 必须明确标为 Mock。

## 8. Receipt 与数据库

最低字段：

```sql
CREATE TABLE IF NOT EXISTS settlement_receipts (
  intent_id TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_hash TEXT UNIQUE,
  explorer_url TEXT,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
```

建议逐步补全：

```text
chain_id
block_height
block_time
fee_amount
fee_denom
contract_address
raw_events
last_checked_at
```

当前写库顺序：

```text
Intent submitted
  -> PolicyDecision persisted
  -> Intent settling persisted
  -> SDK broadcast + confirmation response
  -> Intent confirmed / failed persisted
  -> confirmed / failed Receipt persisted
  -> Trace query returns all three objects
```

当前没有独立 `broadcasting` 状态或广播前 tx hash 持久化。如果进程在广播后、Receipt 写入前崩溃，重启会把残留 `settling` 隔离为 `SETTLEMENT_RECOVERY_REQUIRED`，不会自动重发。下一步必须增加链上查询恢复，确认原交易成功或失败后再更新 Receipt。

## 9. 前端真实性规则

只有同时满足以下条件才能显示 `Injective Testnet · Confirmed`：

- `receipt.mode === 'testnet'`
- `receipt.status === 'confirmed'`
- 交易哈希来自真实广播/查询结果
- Explorer URL 可打开
- Receipt 已写入 PostgreSQL

其他状态：

- `Mock Receipt`：确定性本地哈希，不链接 Explorer。
- `Broadcasting`：已广播、未确认。
- `Failed`：显示稳定错误和可重试状态。
- `Configuration required`：缺少 signer / denom / contract 等配置。

禁止随机生成交易哈希，禁止把 Mock 哈希拼接到 Explorer。

## 10. 安全与隐私

可以上链：

- Intent ID 或哈希。
- PolicyDecision ID。
- payer / payee 链上地址。
- denom、amount、用途哈希。

禁止上链：

- 用户名、手机号和群聊全文。
- 股票研究报告和模型 Prompt。
- PandaAI 账号、API Key、数据库密码。
- 任何不必要的个人信息。

## 11. 测试清单

### 单元测试

- [x] testnet 模式缺少 signer / 资产 / payee 配置时不可执行。
- [x] 私钥不出现在配置 API 或稳定错误中。
- [x] 易读金额到原子金额的映射不使用浮点乘法。
- [x] 非法地址、denom 不一致、精度错误、过期 Intent 被拒绝。
- [x] 非白名单 payee 不进入 Adapter。
- [x] 并发相同 Intent 只调用一次 Adapter；已有 Receipt 不再广播。
- [x] SDK/RPC 错误不会泄露私钥或完整敏感响应。
- [x] 残留 `settling` 状态会被隔离，不会自动重播。

### Testnet 联调

- [ ] 成功支付一笔 Risk 审核费。
- [ ] Explorer 能打开并核对金额/地址。
- [ ] Receipt 与链上结果一致。
- [ ] API 重启后 Receipt 仍能查询。
- [ ] 重放相同 Intent 返回相同交易哈希。
- [ ] 断网/超时后恢复查询，不重复付款。
- [ ] PoolMate 复用同一 Adapter 完成商户付款。

### 生产前

- 预置一笔已确认交易作为现场兜底。
- 现场钱包余额足够但金额极小。
- RPC、REST、Explorer 均可访问。
- Mock 降级开关可用，标签清楚。
- 日志无私钥、密码和完整签名消息。

## 12. 链上队友交付 Manifest

不要只交一个地址。必须提供：

- 网络、chain ID、RPC/REST/gRPC。
- 钱包或合约地址。
- 部署高度与部署交易哈希。
- 合约代码版本 / Git commit。
- denom、精度、测试币领取方式。
- execute message schema。
- 事件 schema 与错误码。
- 防重放和幂等策略。
- Explorer 交易链接格式。
- 一笔成功样例和一笔拒绝样例。

## 13. 最终验收

- [ ] 一笔 KaleidoX `risk_review` 在 Testnet 确认。
- [ ] 一笔 PoolMate `merchant_pay` 复用同一 Adapter。
- [ ] 两笔都有可打开的 Explorer 与 PostgreSQL Receipt。
- [ ] 相同 Intent 重试不会重复付款。
- [ ] 非白名单、超限、过期 Intent 不会广播。
- [ ] Mock / Testnet / Failed 状态无歧义。
- [ ] 私钥从未进入前端、Git、API 或日志。
- [ ] 网络故障时可恢复查询或明确降级。

完成这些，PactLedger 的核心论证才真正成立：业务 Agent 只负责提出 Intent，账户、Policy、批准、结算和 Receipt 由同一个基座统一接管。
