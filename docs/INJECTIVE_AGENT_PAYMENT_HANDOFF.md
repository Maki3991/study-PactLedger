# PactLedger × Injective Agent 支付接入交接

> 面向链上开发队友。目标不是把股票搬到链上交易，而是让 Agent 的预算、服务采购、拼单结算与执行证据通过 Injective 完成可信结算。

## 1. 当前 MVP 到了哪里

当前生产服务：`http://129.226.91.246:8787`

- `/`：PactLedger 通用基座落地页。
- `/kaleidox.html`：股票量化产品实例，已跑通登录、Panda 数据 Provider、策略回测、Policy 纠偏、人工批准与 Mock Receipt。
- `/poolmate.html`：群聊拼单产品实例，展示同一组 Account / Policy / Intent / Receipt 原语如何映射到第二种业务。
- PostgreSQL 已持久化用户、会话、任务、Agent 账户和审计流水。
- Injective 当前为 `MockInjectiveAdapter`；配置、状态查询和 Adapter 接口已经预留。

现有边界：

```text
业务 Agent
  → Action Intent
  → PactLedger Policy
  → 人工批准
  → ExecutionAdapter.execute(intent)
  → Receipt
```

关键代码：

- `web/src/domain/trading.ts`：`ActionIntent`、状态机和前后端稳定领域模型。
- `web/server/orchestrator.ts`：Policy 纠偏、批准和执行编排。
- `web/server/adapters/execution.ts`：当前 Adapter 接口与 Mock 实现。
- `web/server/adapters/createExecutionAdapter.ts`：按环境选择 Adapter。
- `web/server/config/injective.ts`：服务端配置与脱敏状态。
- `web/server/treasury.ts`：Agent 账户和内部服务费流水。

## 2. 必须统一的产品口径

KaleidoX 只做股票量化，不做 ETH 或加密资产策略。

Injective 在本项目中的职责是：

1. Agent 间服务采购结算，例如 Strategy Agent 向 Research / Backtest / Risk Agent 付款。
2. 用户向 Agent 授权预算后的资金拨付与支出记录。
3. PoolMate 向商户付款、退款、退差等结算动作。
4. 为每次付款生成可验证的链上 Receipt。

Injective 暂不负责：

- 提供 A 股行情；行情来自 PandaAI。
- 在链上撮合或托管真实 A 股。
- 替代未来的证券 Broker Adapter。

演示时应说：

> PandaAI 给股票 Agent 提供研究数据，PactLedger 控制 Agent 能否花钱，Injective 结算 Agent 支付并留下 Receipt。

不要说“我们在 Injective 上买卖 A 股”。

## 3. 建议拆分：业务动作与链上支付

当前 `ActionIntent` 表达的是股票业务动作。不要直接把 `stock_trade` 当作链上转账参数。建议新增独立的支付模型：

```ts
export interface AgentPaymentIntent {
  id: string
  tenantId: string
  appId: 'kaleidox' | 'poolmate'
  payerAgentId: string
  payeeAddress: string
  amountAtomic: string
  denom: string
  purpose: 'research' | 'backtest' | 'risk_review' | 'execution' | 'merchant_pay' | 'refund'
  protocol: 'internal' | 'x402' | 'acp' | 'ap2'
  policyDecisionId: string
  expiresAt: string
  metadataHash: string
}

export interface SettlementReceipt {
  intentId: string
  network: 'Injective Testnet'
  chainId: string
  txHash: string
  height: string
  blockTime: string
  status: 'confirmed' | 'failed'
  feeAmount?: string
  feeDenom?: string
  contractAddress?: string
  explorerUrl: string
}
```

关联关系：

```text
股票 ActionIntent
  └─ 触发 Execution Agent 服务费 PaymentIntent
      └─ Injective SettlementReceipt

PoolMate group_purchase Intent
  └─ 触发 merchant_pay PaymentIntent
      └─ Injective SettlementReceipt
```

这样可以确保业务层未来接证券 Broker 时，不需要重写 Agent 支付层。

## 4. 链上队友需要交付的 Deployment Manifest

请链上队友不要只发一个合约地址。交付以下完整信息：

```dotenv
INJECTIVE_EXECUTION_MODE=testnet
INJECTIVE_NETWORK=testnet
INJECTIVE_CHAIN_ID=injective-888
INJECTIVE_RPC_ENDPOINT=
INJECTIVE_REST_ENDPOINT=
INJECTIVE_GRPC_ENDPOINT=
INJECTIVE_WALLET_ADDRESS=
INJECTIVE_PRIVATE_KEY=
INJECTIVE_CONTRACT_ADDRESS=
INJECTIVE_FEE_DENOM=inj
INJECTIVE_GAS_PRICE=500000000
INJECTIVE_PAYMENT_DENOM=
INJECTIVE_EXPLORER_TX_BASE_URL=
```

还需要一份文字或 JSON 清单：

- 合约网络、部署高度、部署交易哈希。
- 合约地址和代码版本 / Git commit。
- 支付资产 denom、精度和测试币领取方式。
- execute 消息 schema。
- 成功事件 schema 与失败错误码。
- 重放 / 幂等策略。
- Explorer 交易链接格式。

私钥只能放在服务器 `web/.env`，权限保持 `600`；不能使用 `VITE_` 前缀，不能提交 Git。

## 5. 推荐的最小链上合约能力

如果时间紧，测试网 MVP 只做一个 Treasury 支付入口：

```json
{
  "execute_payment": {
    "intent_id": "PAY-...",
    "tenant_id_hash": "sha256:...",
    "payee": "inj...",
    "denom": "...",
    "amount": "2500000",
    "purpose_hash": "sha256:...",
    "policy_decision_id": "POL-...",
    "expires_at": 1780000000
  }
}
```

推荐在链上至少再次检查：

- `intent_id` 未执行过，避免重放。
- payee 在白名单。
- denom 在允许列表。
- amount 不超过单笔上限。
- Intent 未过期。
- 调用者具有 Treasury 执行权限。

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

不要把用户名、股票研究全文、手机号或群聊内容明文上链；只写 ID 和哈希。

## 6. 服务端 Adapter 的实施位置

新增：

```text
web/server/adapters/injectiveTestnet.ts
```

Adapter 应完成：

1. 接收已批准的 `AgentPaymentIntent`。
2. 再次校验网络、地址、denom、amount 和 expiry。
3. 使用服务端 signer 构造交易。
4. 广播到 Injective Testnet。
5. 等待确认，不要只拿到广播响应就返回成功。
6. 从交易事件生成 `SettlementReceipt`。
7. 同一个 `intentId` 重试时返回原 Receipt，不重复付款。

建议接口：

```ts
export interface SettlementAdapter {
  settle(intent: AgentPaymentIntent): Promise<SettlementReceipt>
}
```

随后修改 `createExecutionAdapter.ts`：

```text
mock     → MockSettlementAdapter
testnet  → InjectiveTestnetAdapter
```

不要删除 Mock。比赛现场网络不稳定时必须能降级，并在 UI 上清楚标为 Mock。

## 7. PostgreSQL 需要新增的 Receipt 表

当前任务快照会保存交易哈希，但链上接入后建议增加独立表，避免 Receipt 只存在 JSON 快照中：

```sql
CREATE TABLE settlement_receipts (
  intent_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  network TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  height TEXT,
  block_time TIMESTAMPTZ,
  status TEXT NOT NULL,
  fee_amount NUMERIC(30, 0),
  fee_denom TEXT,
  contract_address TEXT,
  explorer_url TEXT NOT NULL,
  raw_events JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX settlement_receipts_tenant_created_idx
  ON settlement_receipts (tenant_id, created_at DESC);
```

写库和状态更新应遵循：

```text
approved → broadcasting → confirmed
                       └→ failed
```

如果广播超时但链上可能已成功，必须先按 `intent_id` / tx hash 查询，再决定是否重试。

## 8. 两个产品的首批真实支付

优先顺序如下。

### P0：KaleidoX Risk 审核费

```text
Strategy Agent → Risk Agent
purpose = risk_review
amount = 固定小额测试币
```

理由：金额小、业务语义明确，而且 Policy 否决发生在 Demo 核心转折点。

### P0：KaleidoX Execution 服务费

```text
Orchestrator → Execution Agent
purpose = execution
```

它证明“股票不必上链，Agent 为执行服务付费可以上链”。

### P1：PoolMate 商户付款

```text
PoolMate Treasury → 白名单测试商户
purpose = merchant_pay
```

它是第二个业务对同一支付 Adapter 的复用证明。

### P1：PoolMate 退款 / 退差

先实现单笔退款，再做批量 payout。比赛时间不足时，批量 payout 可以由多笔测试网交易组成，但 UI 必须如实显示。

## 9. 前端 Receipt 展示规则

只有满足以下条件才能显示“Injective Testnet”：

- 交易已经确认。
- `txHash` 来自真实广播结果。
- Explorer URL 可打开。
- Receipt 已写入 PostgreSQL。

否则必须显示：

- `Mock Receipt`：本地确定性哈希。
- `Broadcasting`：已广播、未确认。
- `Failed`：失败原因。

禁止用随机哈希或 Mock 哈希链接到 Explorer。

## 10. 测试清单

单元测试：

- 配置缺失时 `testnet` 模式拒绝启动执行。
- 私钥永远不出现在 `/api/config/injective`。
- amount、denom、payee、expiry 校验。
- 相同 `intentId` 不会重复广播。
- 链上失败会转换为稳定错误，不泄露私钥或完整 RPC 响应。

测试网联调：

- 成功支付一笔 Risk 审核费。
- Explorer 能查到事件。
- PostgreSQL Receipt 与链上事件一致。
- systemd 重启后 Receipt 仍能查询。
- 人为提交超限、非白名单、重复 intent，确认均被拒绝。

现场演示前：

- 预先准备一笔成功交易作为兜底。
- 现场再发一笔小额交易证明实时性。
- 同时保留 Mock 开关，网络失败时不影响量化主流程。

## 11. 下一步团队分工

链上队友：

1. 给出 Deployment Manifest。
2. 部署最小 Treasury 支付合约。
3. 提供 execute / event schema 和一笔 Explorer 示例。

后端队友：

1. 增加 `AgentPaymentIntent` 与 `SettlementReceipt`。
2. 实现 `InjectiveTestnetAdapter`。
3. 新增 Receipt 表、幂等处理和查询 API。

前端 / Demo：

1. 将现有 Mock Receipt 自动切换为真实 Explorer 链接。
2. 在 KaleidoX 展示 Risk 审核费与 Execution 服务费。
3. 在 PoolMate 展示相同 Adapter 产生的商户付款 Receipt。

PandaAI：

1. 将比赛账号写入服务器 `web/.env`：`PANDA_DATA_USERNAME`、`PANDA_DATA_PASSWORD`。
2. 保持 `PANDA_DATA_MODE=auto` 或改为 `panda`。
3. 重启后确认 `/api/health` 返回 `panda: live`。
4. 用 `000001.SZ` 跑一次真实 `get_stock_daily_pre`，核对条数、日期和页面 `PandaData Live` 标识。

## 12. 最终完成标准

- [ ] KaleidoX 使用真实 PandaData，或明确标为 Replay。
- [ ] 至少一笔 KaleidoX Agent 间支付在 Injective Testnet 确认。
- [ ] 至少一笔 PoolMate 商户付款复用同一 Adapter；来不及时可用预置测试网交易，但不能冒充现场交易。
- [ ] 两笔交易都有 PostgreSQL Receipt 和 Explorer 链接。
- [ ] 重复 intent、超限付款和非白名单收款人均被拒绝。
- [ ] Mock / Testnet / Live 三种状态在界面上无歧义。
- [ ] 服务器重启后登录、任务和 Receipt 都能恢复。

做到这些，PactLedger 的核心论证就成立：业务 Agent 只需要生成 Intent，账户、Policy、支付与 Receipt 都由同一基座复用。
