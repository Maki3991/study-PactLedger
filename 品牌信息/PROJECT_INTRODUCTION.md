# PactLedger

> **让 Agent 提出付款，让规则决定付款，让 Injective 证明付款。**

## 项目简介

AI Agent 已经能够研究、规划、调用工具并购买外部服务，但“拥有钱包”不等于“具备可控的资金权限”。当 Agent 开始代表个人或团队花钱时，系统必须明确回答：

- 它可以花多少钱？
- 这笔钱可以用于什么目的？
- 收款方是否可信？
- 哪些操作必须经过人工批准？
- 如何证明付款确实发生，而不是生成了一段虚假的交易哈希？

**PactLedger 是构建在 Agent 与 Injective 之间的可编程资金控制与审计基座。**

Agent 无法直接操作结算账户，只能提交结构化付款意图；PactLedger 负责检查预算、用途、收款白名单、有效期和审批条件，通过后再调用结算适配器，并将交易结果保存为可追溯的 Receipt。

完整执行链为：

```text
Payment Intent
-> Policy Decision
-> Human Approval（可选）
-> Injective Settlement
-> Verifiable Receipt
```

## Injective 在项目中的作用

Injective 不是装饰性的“上链标签”，而是 PactLedger 的结算与公开验证层，用于：

- 结算 Agent 之间的服务采购费用；
- 结算 Agent 向白名单商户发起的付款；
- 提供真实交易哈希、区块高度和确认状态；
- 通过 Explorer 向用户和评委提供可独立核验的链上证据；
- 将链上结果与原始 Intent、PolicyDecision 和审批记录关联，形成完整审计链。

项目已实现基于 **Injective 官方 SDK** 的 Testnet Settlement Adapter，包括地址白名单、资产精度、原子金额转换、交易广播、区块确认和 Receipt 持久化。当前尚未完成首笔可由 Explorer 验证的真实 Injective Testnet 付款，因此不会将 Mock Receipt 或模拟哈希描述为链上确认。

PactLedger 严格区分 **Mock、Replay、Testnet 与 Live**。只有交易获得真实链上确认，并具有可打开的 Explorer 链接和已持久化 Receipt 时，系统才会显示“链上已确认”。

## 核心能力

### 1. 可编程资金策略

每笔付款都必须经过 Policy Engine。系统可以检查：

- Agent 与任务预算；
- 单笔及累计金额上限；
- 付款用途；
- 收款地址白名单；
- Intent 有效期；
- 调用者权限；
- 是否需要人工审批。

不符合规则的请求不会进入结算流程，同时会留下明确的拒绝原因和审计记录。

### 2. 人工审批与权限隔离

对于大额付款或高风险操作，Agent 只能发起请求，不能替用户批准自己的请求。只有获得有效人工授权后，结算流程才会继续。

### 3. 幂等支付

相同 Payment Intent 即使因网络异常或客户端重试被多次提交，也只能产生一次付款。系统会返回已经存在的 Receipt，避免重复广播和重复扣款。

### 4. 可审计 Receipt

PactLedger 将以下证据关联为一条完整 Trace：

```text
Intent
-> PolicyDecision
-> Approval
-> Settlement
-> Receipt
```

Receipt 可以包含交易哈希、付款地址、收款地址、资产、金额、区块高度、确认时间和 Explorer 链接，使每一次成功、失败或拒绝都可以被复查。

## 两个参考应用

### KaleidoX：股票投研 Agent 团队

KaleidoX 由 Research、Strategy、Backtest 和 Risk 等 Agent 协作完成股票研究与策略评估。PandaAI 提供股票数据和研究解释，PactLedger 管理 Agent 采购研究、回测和风控服务时产生的费用。

需要特别说明：**KaleidoX 的 A 股研究与 Injective 上的 Agent 服务费结算是两个不同领域。** 项目不会把 A 股订单伪装成 Injective 交易，也不会宣称“在 Injective 上交易 A 股”。

### PoolMate：群聊拼单 Agent

PoolMate 从群聊中提取商品、份额、截止时间和商户信息，生成标准 Payment Intent。

PactLedger 随后检查商户白名单、付款金额和审批阈值：合法商户付款可以进入结算流程，陌生收款人或越权请求则会被直接拒绝并留下审计 Trace。

两个应用的业务完全不同，却共享同一套账户、Intent、Policy、Approval、Settlement 和 Receipt 能力，证明 PactLedger 是可复用的 Agent 财务基座，而不是某个应用内部的支付功能。

## 技术实现

- React、TypeScript 与 Vite；
- Fastify 权威后端；
- PostgreSQL 持久化与幂等控制；
- Injective 官方 SDK Testnet Settlement Adapter；
- PandaData 股票数据与模型研究解释；
- A2A Agent Card、REST 与 JSON-RPC；
- Telegram 群聊拼单流程。

## 项目价值

PactLedger 不要求用户无条件相信 Agent，而是通过不可绕过的规则限制 Agent 的资金权限，再通过 Injective 提供可公开验证的结算证据。

> **业务可以变化，Agent 可以进化，但它永远不能进化自己的资金权限。**
