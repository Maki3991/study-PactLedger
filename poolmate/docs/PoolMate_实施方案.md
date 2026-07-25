# PoolMate Telegram Agent MVP 实施方案

**版本：** v3.0  
**实施假设：** 两名工程师并行  
**目标形态：** Telegram 群内拼单 Agent + Trusted Confirmation Surface + React 运营后台 + Merchant/Payment A2A 演示  
**交易模式：** Human Present  
**支付原则：** 最终报价、精确分摊、逐人确认、一次商户付款；正常主流程不执行交付后退差  
**协议范围：** 本阶段实现 A2A 外层协议、稳定 canonical 接口、Mock Merchant、Mock Payment Foundation 和可替换 Provider Adapter；不声明正式 AP2 兼容

---

## 1. 文档目标

本方案用于指导 PoolMate Human Present MVP 的两日开发与演示交付。

重点不是完成生产级钱包、链上支付或 AP2 密码学实现，而是交付一条可以稳定演示的完整垂直链路：

1. Telegram 群成员通过自然语言创建拼单；
2. 其他群成员认领并修改自己的商品份额；
3. 认领阶段只记录份额，不创建金额上限授权；
4. 份额满足后，PoolMate 通过 A2A 请求 Merchant Agent 生成最终 Checkout；
5. 确定性业务代码校验最终报价并计算每名参与人的精确应付金额；
6. 每名参与人在 Trusted Confirmation Surface 中查看并确认同一 Checkout 下的本人金额；
7. 任一参与人未确认时不得付款；
8. 全部确认后，PoolMate 通过 A2A 请求 Payment Agent 执行一次商户付款；
9. Payment Foundation 校验 Checkout、参与人确认、金额分配、收款方和幂等键；
10. Telegram 展示付款结果、履约状态、群总账和个人账单；
11. React 后台可查看订单、Checkout、确认记录、A2A Task、支付操作、失败任务和审计事件；
12. 未来升级 AP2 Human Present 时，可以增加 Merchant-signed Checkout、Mandate 和 Receipt，而不修改订单核心状态机和金额模型。

本方案优先保证：

- Human Present 用户流程完整；
- 最终 Checkout 不可变且可追踪；
- 用户确认与 Checkout hash、版本和本人金额绑定；
- 订单与支付状态由确定性代码控制；
- A2A 只承担外层协作，不成为资金事实来源；
- Payment Foundation 与 Provider 可替换；
- 不保留退差和批量结算的无效复杂度；
- 两日内可以完成演示。

---

## 2. 范围变化

相较于上一版实施方案，本版本进行以下调整。

### 2.1 删除能力

本阶段删除：

- 参与人预估金额授权；
- 安全缓冲和授权上限计算；
- `payment.create_authorization`；
- `payment.request_refund`；
- 交付后金额重算；
- 自动退差；
- 自动补差；
- Settlement Batch；
- Batch Payout；
- `SETTLING`、`REFUND_PENDING`、`REFUNDED` 等状态；
- 将 MCP 作为 Merchant/Payment 外层协议；
- 将认领行为解释为付款授权。

### 2.2 新增能力

本阶段新增：

- `QUOTE_PENDING`；
- `CONFIRMATION_PENDING`；
- `READY_FOR_PAYMENT`；
- 最终 Checkout Snapshot；
- Checkout version 和 Checkout hash；
- 精确 Payment Allocation；
- Trusted Confirmation Surface；
- 每名参与人的 User Confirmation Evidence；
- 确认集合锁定；
- A2A Merchant Agent Card；
- A2A Payment Agent Card；
- Merchant Checkout A2A Task；
- Payment Checkout A2A Task；
- A2A Task、Message、Artifact 和内部状态分离；
- AP2 演进字段预留。

---

## 3. 核心架构原则

### 3.1 Agent 与业务状态机分离

Agent 负责：

- 理解 Telegram 自然语言；
- 提取订单草稿字段；
- 识别缺失和歧义字段；
- 根据 Skill 选择工作方法；
- 解释 Merchant 和 Payment 返回结果；
- 生成面向用户的自然语言说明。

确定性业务代码负责：

- 群组和用户权限；
- 订单状态迁移；
- 参与人份额；
- 份额锁定；
- Checkout Schema 校验；
- Checkout hash 计算；
- 费用和个人金额计算；
- 确认记录验证；
- 确认集合锁定；
- 商户身份和收款方解析；
- 支付前置条件；
- 幂等键；
- 外部结果归一化；
- 失败恢复；
- 审计记录。

LLM 不能：

- 直接创建正式订单；
- 修改最终 Checkout；
- 计算可用于付款的最终金额；
- 指定真实收款地址；
- 把群聊中的地址写入付款请求；
- 将认领行为视为付款确认；
- 代表其他参与人确认；
- 直接迁移支付状态。

### 3.2 A2A 是外层协作协议

A2A 用于：

- Agent 能力发现；
- Merchant 和 Payment Skill 声明；
- 创建异步 Task；
- 传输结构化 Data；
- 返回 Artifact；
- 获取任务状态；
- 流式或推送状态；
- 保存跨 Agent Trace。

A2A 不负责：

- 订单业务状态；
- 金额计算；
- 多参与人分配；
- 用户确认规则；
- 商户白名单；
- Tenant 策略；
- 账本；
- 底层资金结算。

Domain 不得直接依赖 A2A SDK 类型。

以下类型禁止进入 Domain：

- `AgentCard`；
- `Task`；
- `TaskState`；
- `Message`；
- `Artifact`；
- `Part`；
- A2A JSON-RPC DTO。

A2A Adapter 必须把外部对象转换为稳定 canonical 对象后再调用 Application Service。

### 3.3 Human Present 确认是资金动作前置条件

认领只说明用户希望参加订单。

付款确认必须发生在：

- 最终 Checkout 已生成；
- 全部费用已经确定；
- 每人精确金额已经计算；
- Checkout 仍在有效期内；
- 用户本人正在 Trusted Confirmation Surface 中操作。

用户确认必须绑定：

- `orderId`；
- `checkoutId`；
- `checkoutVersion`；
- `checkoutHash`；
- `participantId`；
- `allocationId`；
- `amountAtomic`；
- `asset`；
- `merchantId`；
- `payeeRef`；
- `confirmationNonce`；
- `confirmedAt`。

任何绑定字段变化都必须使原确认失效。

### 3.4 最终 Checkout 不可原地修改

Merchant 返回的每个 Checkout 版本均为不可变快照。

禁止：

- 修改已有版本金额；
- 修改已有版本商户；
- 修改已有版本商品；
- 修改已有版本过期时间；
- 复用旧 hash 表示新内容。

报价变化必须创建：

```text
checkoutId 相同或新建
checkoutVersion + 1
新的 checkoutHash
新的 Payment Allocation
新的确认轮次
```

旧确认记录保留用于审计，但状态变为 `SUPERSEDED` 或 `INVALIDATED`。

### 3.5 支付请求只接受引用

Shopping Agent 对 Payment Agent 的高层请求只能提交：

```ts
payment.checkout.create({
  orderId,
  checkoutId,
  checkoutVersion,
  idempotencyKey
});
```

禁止提交由 Agent 自由构造的：

```ts
payment.transfer({
  amount,
  payee,
  allocations
});
```

Payment Application Service 必须根据引用从数据库加载：

- 最终 Checkout；
- Checkout hash；
- Merchant 映射；
- Payment Allocations；
- User Confirmations；
- Tenant 策略；
- 幂等记录。

### 3.6 A2A Task 状态与业务状态分离

A2A Task 状态表示一次协议任务的处理进度。

业务状态表示订单、Checkout 或付款操作的真实状态。

例如：

```text
A2A Task = COMPLETED
Payment Operation = FAILED
```

表示 Payment Agent 已完成请求处理并明确返回拒付结果。

不能将：

```text
A2A COMPLETED
```

直接解释为：

```text
PAYMENT CONFIRMED
```

### 3.7 AP2 兼容通过扩展字段实现

本阶段不实现正式 AP2，但 canonical 模型预留：

- Merchant Checkout JWT 引用；
- Checkout Mandate 引用；
- Payment Mandate 引用；
- Checkout Receipt 引用；
- Payment Receipt 引用；
- Evidence Bundle ID；
- Verification Result。

这些字段均为可选，不参与当前 MVP 的状态判断。

当前 User Confirmation Evidence 不能对外称为 AP2 Mandate。

---

## 4. 系统总体架构

```text
┌────────────────────────────┐
│ Telegram Group / Private   │
└──────────────┬─────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│ PoolMate Backend                                     │
│ Fastify + Telegraf                                   │
│                                                      │
│ ┌────────────────┐   ┌────────────────────────────┐  │
│ │ Telegram Bot   │   │ REST API + Swagger + SSE   │  │
│ └───────┬────────┘   └──────────────┬─────────────┘  │
│         │                           │                │
│         ▼                           ▼                │
│ ┌──────────────────────────────────────────────────┐ │
│ │ Application Services                             │ │
│ │ Order / Participant / Checkout / Confirmation    │ │
│ │ Payment / Fulfillment                            │ │
│ └──────────────┬───────────────────────────────────┘ │
│                │                                     │
│       ┌────────┼───────────────┐                     │
│       ▼        ▼               ▼                     │
│ ┌──────────┐ ┌──────────────┐ ┌──────────────────┐   │
│ │ Domain   │ │ Agent Runtime│ │ Durable Scheduler│   │
│ │ Core     │ │ + Skills     │ │ Outbox + Jobs    │   │
│ └────┬─────┘ └──────┬───────┘ └────────┬─────────┘   │
│      │              │                  │             │
│      ▼              ▼                  ▼             │
│ ┌──────────┐ ┌──────────────┐ ┌──────────────────┐   │
│ │ Drizzle  │ │ A2A Clients  │ │ Worker           │   │
│ │ ORM      │ │ + Gateways   │ │                  │   │
│ └──────────┘ └──────┬───────┘ └──────────────────┘   │
└─────────────────────┼────────────────────────────────┘
                      │
            ┌─────────┴──────────┐
            ▼                    ▼
┌─────────────────────┐  ┌────────────────────────────┐
│ Merchant Agent      │  │ Payment Agent/Foundation   │
│ A2A Server          │  │ A2A Server                 │
│ Mock Merchant Core  │  │ Compliance + Mock Provider │
└─────────────────────┘  └────────────────────────────┘

┌────────────────────────────┐
│ Web Applications           │
│                            │
│ Trusted Confirmation UI    │
│ React Admin Web            │
└────────────────────────────┘
```

---

## 5. 仓库结构

```text
/
├── src/
│   ├── agent/
│   │   ├── agentRuntime.ts
│   │   ├── skillRegistry.ts
│   │   └── agentRunService.ts
│   │
│   ├── a2a/
│   │   ├── client/
│   │   │   ├── a2aClient.ts
│   │   │   ├── agentDiscovery.ts
│   │   │   ├── taskClient.ts
│   │   │   └── pushSubscription.ts
│   │   ├── server/
│   │   │   ├── merchantA2aServer.ts
│   │   │   ├── paymentA2aServer.ts
│   │   │   └── agentCardRoutes.ts
│   │   ├── profiles/
│   │   │   ├── commerceProfile.ts
│   │   │   ├── paymentProfile.ts
│   │   │   └── commonProfile.ts
│   │   ├── mappers/
│   │   │   ├── merchantArtifactMapper.ts
│   │   │   ├── paymentArtifactMapper.ts
│   │   │   └── taskStateMapper.ts
│   │   └── trace/
│   │       ├── a2aTraceService.ts
│   │       └── a2aTaskRepository.ts
│   │
│   ├── api/
│   │   ├── server.ts
│   │   ├── openapi.ts
│   │   ├── adminEventStream.ts
│   │   └── routes/
│   │       ├── orders.ts
│   │       ├── confirmations.ts
│   │       ├── payments.ts
│   │       ├── a2a.ts
│   │       └── admin.ts
│   │
│   ├── bot/
│   │   ├── handlers/
│   │   │   ├── orderHandlers.ts
│   │   │   ├── participantHandlers.ts
│   │   │   ├── confirmationHandlers.ts
│   │   │   └── receiptHandlers.ts
│   │   ├── keyboards/
│   │   ├── formatter.ts
│   │   └── i18n.ts
│   │
│   ├── modules/
│   │   ├── groups/
│   │   ├── orders/
│   │   ├── participants/
│   │   ├── checkout/
│   │   │   ├── checkoutService.ts
│   │   │   ├── checkoutHasher.ts
│   │   │   ├── allocationCalculator.ts
│   │   │   └── checkoutPolicy.ts
│   │   ├── confirmations/
│   │   │   ├── confirmationService.ts
│   │   │   ├── confirmationTokenService.ts
│   │   │   └── confirmationPolicy.ts
│   │   ├── payments/
│   │   │   ├── paymentService.ts
│   │   │   ├── paymentPolicy.ts
│   │   │   └── paymentEventHandler.ts
│   │   └── fulfillment/
│   │       ├── fulfillmentService.ts
│   │       └── fulfillmentEventHandler.ts
│   │
│   ├── integrations/
│   │   ├── merchant/
│   │   │   ├── merchantGateway.ts
│   │   │   ├── a2aMerchantGateway.ts
│   │   │   └── mockMerchantCore.ts
│   │   └── payment/
│   │       ├── paymentGateway.ts
│   │       ├── a2aPaymentGateway.ts
│   │       ├── mockPaymentCore.ts
│   │       └── provider/
│   │           ├── paymentProvider.ts
│   │           ├── mockPaymentProvider.ts
│   │           ├── treasuryProviderAdapter.ts
│   │           ├── providerMapper.ts
│   │           ├── providerWebhook.ts
│   │           └── protocolTypes.ts
│   │
│   ├── persistence/
│   │   ├── db.ts
│   │   ├── schema/
│   │   └── repositories/
│   │
│   ├── scheduler/
│   │   ├── scheduler.ts
│   │   ├── worker.ts
│   │   └── jobHandlers.ts
│   │
│   ├── config.ts
│   └── main.ts
│
├── .agents/
│   └── skills/
│       ├── poolmate-core/
│       │   └── SKILL.md
│       ├── order-intake/
│       │   └── SKILL.md
│       ├── merchant-coordination/
│       │   └── SKILL.md
│       └── payment-coordination/
│           └── SKILL.md
│
├── web/
│   ├── confirmation/
│   │   ├── src/
│   │   └── package.json
│   └── admin/
│       ├── src/
│       └── package.json
│
├── packages/
│   ├── api-schema/
│   ├── a2a-profile-schema/
│   └── canonical-payment-schema/
│
└── tests/
```

### 5.1 共享包边界

`packages/api-schema` 只包含：

- REST request schema；
- REST response schema；
- SSE event schema；
- OpenAPI 类型。

`packages/a2a-profile-schema` 只包含：

- Commerce Profile Data Schema；
- Payment Profile Data Schema；
- A2A Artifact payload schema；
- Profile 版本常量；
- 从 Zod Schema 推导的 TypeScript 类型。

`packages/canonical-payment-schema` 只包含：

- Merchant Checkout canonical schema；
- Payment Allocation schema；
- User Confirmation Evidence schema；
- Payment Operation normalized schema；
- AP2 预留引用字段。

禁止放入：

- Drizzle table；
- Repository 类型；
- Domain Aggregate；
- Agent Prompt；
- Provider 私有 DTO；
- 密钥；
- 钱包敏感信息。

---

## 6. CodexClaw 改造策略

### 6.1 保留或演进

保留或演进：

- `PtyManager` → `AgentRuntime`；
- Codex SDK/CLI session；
- PTY preflight；
- Runtime state 持久化；
- `SkillRegistry`；
- Telegram formatter；
- i18n；
- Telegraf 初始化；
- 配置加载；
- healthcheck；
- lint、format、test 和 CI 配置。

### 6.2 删除候选

删除或隔离：

- Git/GitHub 自动提交 handler；
- 编码助手 proactive summary；
- shell command handler；
- 项目切换和 coding command 路由；
- 旧工作流阶段展示；
- 与 PoolMate 无关的 Web 开发服务器控制；
- 旧 Payment Authorization 和 Settlement 代码；
- 旧 MCP Merchant/Payment transport；
- 退差、Batch Payout 和 Settlement 页面。

### 6.3 不建设通用平台

本阶段不实现：

- 通用 Agent Builder；
- Skill 市场；
- 通用 A2A Profile Registry；
- 动态上传 Agent Card；
- 通用工作流 DSL；
- 多租户 A2A Marketplace；
- 通用 AP2 Credential 平台；
- 通用 Capability Policy Engine。

---

## 7. Agent Runtime 与 Skill

### 7.1 Runtime Mode

保留：

```ts
type AgentRuntimeMode = "pty" | "exec" | "sdk";
```

MVP 不拆分多个 Runtime Backend。

### 7.2 Session Key

建议：

```text
conversation:{chatId}:{userId}
draft:{chatId}:{userId}
order:{orderId}
agent-run:{runId}
```

`chatId` 只表示消息目标，不作为唯一 Agent session key。

### 7.3 Agent Run

```ts
interface AgentRunInput {
  runId: string;
  sessionKey: string;
  mode?: AgentRuntimeMode;
  task: string;
  workdir: string;
  outputTarget: "telegram" | "admin" | "silent";
  resumeSessionId?: string;
}
```

### 7.4 MVP Skills

只实现四个 Skill：

1. `poolmate-core`  
   定义状态边界、不得虚构金额、不得代表用户确认等规则。

2. `order-intake`  
   提取订单草稿字段、识别缺失和歧义字段。

3. `merchant-coordination`  
   判断何时请求最终 Checkout，以及如何向用户解释报价。

4. `payment-coordination`  
   判断何时可以创建 Payment Task，以及如何解释 Payment Artifact。

Skill 不负责：

- Checkout hash；
- 分配金额；
- 确认验证；
- A2A Task 状态迁移；
- 支付策略；
- AP2 验证。

---

## 8. Structured Output 与外部调用

### 8.1 Structured Output 用于订单草稿

```ts
interface OrderDraftExtraction {
  fields: {
    productName?: string;
    targetQuantity?: string;
    unit?: string;
    estimatedUnitPrice?: string;
    estimatedShipping?: string;
    recognitionDeadlineAt?: string;
    merchantReference?: string;
    asset?: string;
    splitRule?: "BY_QUANTITY" | "EQUAL_SPLIT";
  };
  missingFields: string[];
  ambiguousFields: Array<{
    field: string;
    reason: string;
    candidates?: string[];
  }>;
}
```

模型输出只生成 Draft Patch。

应用收到结果后必须执行 Zod 校验。

### 8.2 外部 Agent 调用通过 Gateway

Domain 调用：

```ts
MerchantGateway.getFinalCheckout()
PaymentGateway.createCheckout()
```

Gateway 内部使用 A2A Client。

Agent Prompt 和 Skill 不直接构造：

- A2A JSON-RPC；
- Agent Card；
- Task；
- Artifact；
- Provider 请求。

### 8.3 Merchant A2A Skills

MVP Agent Card 声明：

```text
commerce.checkout.create
commerce.order.get
commerce.fulfillment.get
```

演示辅助能力可以放在认证后的扩展 Agent Card：

```text
commerce.demo.simulate_fulfillment
commerce.demo.simulate_failure
```

### 8.4 Payment A2A Skills

MVP Agent Card 声明：

```text
payment.checkout.create
payment.checkout.get
payment.receipt.get
```

演示辅助能力：

```text
payment.demo.simulate_confirmation
payment.demo.simulate_failure
payment.demo.simulate_unknown
```

### 8.5 A2A Profiles

定义两个项目内 Profile：

```text
urn:poolmate:a2a:commerce-profile:v1
urn:poolmate:a2a:payment-profile:v1
```

Profile 必须定义：

- Data payload type；
- Schema；
- 版本；
- 错误码；
- Artifact type；
- 幂等字段；
- 内部状态映射。

它们属于 PoolMate Profile，不宣称是 A2A 核心规范自带商业或支付语义。

---

## 9. Canonical Merchant Checkout

### 9.1 Checkout 类型

```ts
interface MerchantCheckoutSnapshot {
  checkoutId: string;
  checkoutVersion: number;
  orderId: string;

  merchant: {
    merchantId: string;
    displayName: string;
    payeeRef: string;
  };

  items: Array<{
    sku: string;
    name: string;
    quantity: bigint;
    unitAmountAtomic: bigint;
  }>;

  goodsAmountAtomic: bigint;
  shippingAmountAtomic: bigint;
  discountAmountAtomic: bigint;
  feeAmountAtomic: bigint;
  totalAmountAtomic: bigint;
  asset: string;

  expiresAt: string;
  checkoutHash: string;
  sourceProtocol: "A2A" | "MOCK";

  ap2?: {
    merchantCheckoutJwtRef?: string;
    checkoutReceiptRef?: string;
  };
}
```

### 9.2 Hash 规则

Checkout hash 必须覆盖：

- Checkout ID；
- 版本；
- Merchant ID；
- payeeRef；
- 商品 SKU、数量和单价；
- 商品总额；
- 运费；
- 折扣；
- 费用；
- 最终总额；
- 资产；
- 过期时间。

建议：

1. 将对象转换为 canonical JSON；
2. 字段排序固定；
3. bigint 转十进制字符串；
4. UTF-8 编码；
5. SHA-256；
6. 保存算法版本。

```ts
interface CheckoutHash {
  algorithm: "SHA-256";
  canonicalizationVersion: "poolmate-checkout-json-v1";
  value: string;
}
```

### 9.3 Checkout 不变量

必须满足：

```text
items 合计 = goodsAmountAtomic
goods + shipping + fee - discount = totalAmountAtomic
totalAmountAtomic > 0
expiresAt > receivedAt
payeeRef 可以解析为白名单商户
asset 属于允许列表
```

任一检查失败：

- 不进入 `CONFIRMATION_PENDING`；
- 不向参与人展示确认；
- A2A Task 结果记为业务失败；
- 订单进入可恢复错误或取消流程。

---

## 10. Payment Allocation

### 10.1 数据类型

```ts
interface PaymentAllocation {
  allocationId: string;
  orderId: string;
  checkoutId: string;
  checkoutVersion: number;
  participantId: string;

  quantity: bigint;
  goodsAmountAtomic: bigint;
  shippingAmountAtomic: bigint;
  discountAmountAtomic: bigint;
  feeAmountAtomic: bigint;
  totalAmountAtomic: bigint;
  asset: string;

  status:
    | "CALCULATED"
    | "CONFIRMATION_PENDING"
    | "CONFIRMED"
    | "CAPTURED"
    | "FAILED"
    | "INVALIDATED";
}
```

### 10.2 计算规则

MVP 支持：

- `BY_QUANTITY`；
- `EQUAL_SPLIT`。

所有金额使用 `bigint`。

舍入策略必须确定：

1. 先计算基础分配；
2. 记录整除余数；
3. 根据稳定排序分配最小单位尾差；
4. 保证参与人合计严格等于 Checkout 总额。

稳定排序建议使用：

```text
participantId 升序
```

禁止：

- 使用浮点数；
- 把尾差留给 Payment Provider；
- 在确认后重新分配尾差。

### 10.3 分配版本

每个 Checkout 版本对应一组独立 Payment Allocation。

Checkout 变化后：

- 旧分配标记 `INVALIDATED`；
- 新建分配；
- 旧确认失效；
- 重新开始确认轮次。

---

## 11. Trusted Confirmation Surface

### 11.1 技术形态

MVP 使用独立 React Web 页面：

```text
web/confirmation
```

入口：

```http
GET /confirm/{token}
```

Token 只作为页面访问能力，不包含可信金额数据。

页面加载后通过后端读取：

```http
GET /api/confirmations/{token}
```

确认动作：

```http
POST /api/confirmations/{token}/confirm
POST /api/confirmations/{token}/decline
```

### 11.2 Token 要求

Confirmation token 必须：

- 高熵随机；
- 单参与人；
- 单 Checkout 版本；
- 有过期时间；
- 可撤销；
- 不在日志中输出完整值；
- 不包含金额或地址；
- 成功确认后不可重复用于新 Checkout。

数据库只保存 token hash。

### 11.3 页面数据

页面必须由服务端返回：

```ts
interface ConfirmationView {
  orderCode: string;
  checkoutId: string;
  checkoutVersion: number;
  checkoutHash: string;

  merchantName: string;
  productSummary: string;

  goodsAmountAtomic: string;
  shippingAmountAtomic: string;
  discountAmountAtomic: string;
  feeAmountAtomic: string;
  participantTotalAtomic: string;
  orderTotalAtomic: string;
  asset: string;

  expiresAt: string;
  paymentInstrumentLabel: string;
}
```

前端不得：

- 接受金额输入；
- 修改付款金额；
- 修改商户；
- 修改支付资产；
- 提交收款地址；
- 根据前端状态决定是否已确认。

### 11.4 Confirm API

服务端在确认时重新加载：

- Participant；
- Order；
- Checkout；
- Allocation；
- Token；
- Merchant；
- 当前时间。

不能信任前端回传的金额和 hash。

### 11.5 User Confirmation Evidence

```ts
interface UserConfirmationEvidence {
  confirmationId: string;
  confirmationRoundId: string;

  orderId: string;
  participantId: string;
  allocationId: string;

  checkoutId: string;
  checkoutVersion: number;
  checkoutHash: string;

  merchantId: string;
  payeeRef: string;
  amountAtomic: bigint;
  asset: string;

  confirmationNonce: string;
  confirmedAt: string;

  status:
    | "CONFIRMED"
    | "DECLINED"
    | "EXPIRED"
    | "INVALIDATED"
    | "CONSUMED";

  ap2?: {
    checkoutMandateRef?: string;
    paymentMandateRef?: string;
  };
}
```

### 11.6 确认集合

全部确认后创建：

```ts
interface ConfirmationSet {
  confirmationSetId: string;
  orderId: string;
  checkoutId: string;
  checkoutVersion: number;
  checkoutHash: string;
  confirmationIds: string[];
  totalAmountAtomic: bigint;
  lockedAt: string;
  status: "LOCKED" | "CONSUMED" | "INVALIDATED";
}
```

Payment Service 只接受 `LOCKED` 的确认集合。

---

## 12. Payment Gateway 与 Payment Foundation

### 12.1 稳定内部接口

```ts
interface CreatePaymentInput {
  operationId: string;
  orderId: string;

  checkoutId: string;
  checkoutVersion: number;
  checkoutHash: string;

  confirmationSetId: string;
  idempotencyKey: string;
}

interface PaymentResult {
  operationId: string;
  status:
    | "PENDING"
    | "CONFIRMED"
    | "FAILED"
    | "UNKNOWN";

  providerReference?: string;
  transactionReference?: string;
  receiptReference?: string;

  failureCode?: string;
  failureMessage?: string;

  ap2?: {
    paymentMandateRef?: string;
    paymentReceiptRef?: string;
    evidenceBundleId?: string;
  };
}

interface PaymentGateway {
  createCheckout(input: CreatePaymentInput): Promise<PaymentResult>;
  getCheckout(operationId: string): Promise<PaymentResult>;
  getReceipt(operationId: string): Promise<PaymentResult>;
}
```

### 12.2 Payment Agent A2A 请求

A2A Client 发送受控引用：

```json
{
  "type": "payment.checkout.create",
  "version": "1.0",
  "operationId": "payop_01",
  "orderId": "PM-7F3K",
  "checkoutId": "checkout_0188",
  "checkoutVersion": 1,
  "idempotencyKey": "checkout:PM-7F3K:v1"
}
```

Payment Agent 不信任客户端对金额和收款方的描述。

### 12.3 Payment Foundation 内部加载

Payment Application Service 根据引用加载：

- Checkout Snapshot；
- Checkout hash；
- Confirmation Set；
- User Confirmations；
- Payment Allocations；
- Merchant payee mapping；
- Tenant policy；
- Idempotency record。

### 12.4 Compliance Gate

付款前必须检查：

1. Tenant 未暂停；
2. Order 为 `PAYMENT_PENDING`；
3. Checkout ID、版本和 hash 一致；
4. Checkout 未过期；
5. Confirmation Set 为 `LOCKED`；
6. 所有参与人都有有效确认；
7. 所有确认绑定同一 Checkout；
8. 每个确认金额等于对应 Allocation；
9. Allocation 总额等于 Checkout 总额；
10. Merchant 和最终 payee 在白名单中；
11. Asset 允许；
12. 幂等键未成功执行；
13. 不存在来自 Telegram 或 Agent 文本的覆盖金额；
14. Provider 请求由 canonical 数据生成。

### 12.5 Provider Adapter

调用关系：

```text
Payment A2A Server
        ↓
Payment Application Service
        ↓
Compliance Gate
        ↓
PaymentProvider
        ↓
MockProvider / TreasuryProviderAdapter
```

Provider DTO 只能存在于：

```text
src/integrations/payment/provider
```

Domain 不导入 Provider types。

---

## 13. A2A Task 与 Artifact

### 13.1 Merchant Task

Task metadata：

```ts
interface MerchantTaskMetadata {
  orderId: string;
  checkoutRequestVersion: number;
  idempotencyKey: string;
}
```

成功 Artifact：

```json
{
  "type": "commerce.checkout.snapshot",
  "version": "1.0",
  "checkoutId": "checkout_0188",
  "checkoutVersion": 1,
  "merchant": {
    "id": "merchant:demo-001",
    "name": "Demo Merchant #001"
  },
  "items": [],
  "goodsAmountAtomic": "267000000",
  "shippingAmountAtomic": "18000000",
  "discountAmountAtomic": "0",
  "feeAmountAtomic": "0",
  "totalAmountAtomic": "285000000",
  "asset": "USDT",
  "payeeRef": "merchant:demo-001",
  "expiresAt": "2026-07-25T12:10:00Z"
}
```

### 13.2 Payment Task

成功 Artifact：

```json
{
  "type": "payment.checkout.result",
  "version": "1.0",
  "operationId": "payop_01",
  "orderId": "PM-7F3K",
  "status": "CONFIRMED",
  "amountAtomic": "285000000",
  "asset": "USDT",
  "merchantReference": "DM-20260725-0188",
  "transactionReference": "0x8f2...c91",
  "receiptReference": "receipt_payop_01"
}
```

失败 Artifact：

```json
{
  "type": "payment.checkout.result",
  "version": "1.0",
  "operationId": "payop_01",
  "status": "FAILED",
  "failureCode": "PAYEE_NOT_ALLOWED",
  "failureMessage": "Merchant payee is not allowed."
}
```

状态未知 Artifact：

```json
{
  "type": "payment.checkout.result",
  "version": "1.0",
  "operationId": "payop_01",
  "status": "UNKNOWN",
  "retryable": true
}
```

### 13.3 A2A Task 映射

```text
A2A submitted/working
→ 外部任务仍处理中

A2A completed + Artifact CONFIRMED
→ Payment CONFIRMED

A2A completed + Artifact FAILED
→ Payment FAILED

A2A completed + Artifact UNKNOWN
→ Payment UNKNOWN

A2A failed
→ 协议调用失败；根据是否已产生 operationId 决定重试或查询
```

---

## 14. 订单状态机

### 14.1 正常状态

```text
DRAFT
  ↓
COLLECTING
  ↓
QUOTE_PENDING
  ↓
CONFIRMATION_PENDING
  ↓
READY_FOR_PAYMENT
  ↓
PAYMENT_PENDING
  ↓
MERCHANT_PAID
  ↓
FULFILLMENT_PENDING
  ↓
COMPLETED
```

### 14.2 异常状态

```text
CANCEL_PENDING
CANCELED
EXPIRED
PAYMENT_FAILED
FAILED_REVIEW
```

### 14.3 状态规则

1. `COLLECTING → QUOTE_PENDING`  
   目标数量满足并原子锁定参与人份额。

2. `QUOTE_PENDING → CONFIRMATION_PENDING`  
   最终 Checkout 校验成功、hash 已保存、分配总额平衡。

3. `CONFIRMATION_PENDING → READY_FOR_PAYMENT`  
   全部有效参与人确认同一 Checkout，确认集合锁定。

4. `READY_FOR_PAYMENT → PAYMENT_PENDING`  
   创建 Payment Operation 和 A2A Payment Task。

5. `PAYMENT_PENDING → MERCHANT_PAID`  
   Provider 返回明确成功。

6. `PAYMENT_PENDING → PAYMENT_FAILED`  
   Provider 明确失败且未扣款。

7. `PAYMENT_PENDING → FAILED_REVIEW`  
   支付终态未知并超过自动恢复阈值。

8. `MERCHANT_PAID → FULFILLMENT_PENDING`  
   Merchant 接单或进入履约。

9. `FULFILLMENT_PENDING → COMPLETED`  
   Merchant 或发起人确认交付。

10. `COMPLETED` 不触发退差或二次资金结算。

### 14.4 禁止迁移

- Agent 输出直接改变状态；
- Telegram 消息发送失败改变业务状态；
- 后台直接从 `COLLECTING` 跳到 `PAYMENT_PENDING`；
- 未锁定确认集合进入付款；
- Payment Task `COMPLETED` 但 Artifact 不明确时进入 `MERCHANT_PAID`；
- 交付后进入 `SETTLING`。

---

## 15. 数据持久化

### 15.1 技术选择

```text
Drizzle ORM
+ better-sqlite3
+ drizzle-kit
```

规则：

- Repository 只使用 ORM；
- migration 从 schema 生成；
- 事务边界由 Application Service 控制；
- 金额使用 `bigint`；
- SQLite 保存十进制字符串；
- 时间统一保存 UTC；
- raw A2A payload 只用于审计和调试。

### 15.2 核心表

MVP 最少包含：

```text
telegram_groups
users
order_drafts
orders
order_participants
merchant_checkouts
payment_allocations
confirmation_rounds
user_confirmations
confirmation_tokens
confirmation_sets
payment_operations
fulfillment_events
a2a_agents
a2a_tasks
a2a_messages
a2a_artifacts
a2a_events
agent_runs
agent_events
domain_events
outbox_messages
jobs
telegram_updates
```

删除：

```text
settlement_batches
settlement_items
refund_operations
```

### 15.3 `merchant_checkouts`

保存：

- order ID；
- checkout ID；
- version；
- Merchant ID；
- normalized items；
- normalized amount fields；
- asset；
- payeeRef；
- expiresAt；
- hash algorithm；
- checkout hash；
- raw Artifact；
- source Agent；
- source Task；
- AP2 预留引用；
- status；
- timestamps。

### 15.4 `user_confirmations`

保存：

- confirmation ID；
- round ID；
- participant ID；
- allocation ID；
- Checkout ID、version、hash；
- Merchant ID；
- payeeRef；
- amount；
- asset；
- nonce；
- confirmedAt；
- status；
- AP2 Mandate 预留引用；
- timestamps。

### 15.5 `payment_operations`

保存：

- operation ID；
- order ID；
- Checkout 引用；
- Confirmation Set ID；
- normalized request；
- normalized result；
- A2A Task ID；
- Provider；
- Provider operation ID；
- raw request/response；
- idempotency key；
- transaction reference；
- receipt reference；
- failure code；
- AP2 Receipt 预留引用；
- timestamps。

### 15.6 A2A Trace

保存：

```ts
interface A2aTraceRecord {
  traceId: string;
  direction: "OUTBOUND" | "INBOUND";
  agentId: string;
  agentCardUrl?: string;
  skillId: string;
  taskId?: string;
  contextId?: string;
  profileUri: string;
  profileVersion: string;
  requestHash: string;
  responseHash?: string;
  taskState?: string;
  businessStatus?: string;
  startedAt: string;
  completedAt?: string;
}
```

---

## 16. Durable Scheduler 与恢复

### 16.1 即时任务

通过 Outbox + Worker 执行：

- Telegram 消息发送；
- Merchant A2A Task 创建；
- Payment A2A Task 创建；
- Admin SSE；
- 审计事件投影。

### 16.2 延迟任务

需要调度：

- 认领截止；
- Checkout 过期；
- 确认提醒；
- 确认截止；
- Payment UNKNOWN 查询；
- Merchant fulfillment 查询。

### 16.3 重启恢复

服务启动后查询：

- 未发送 Outbox；
- 未完成 A2A Task；
- `QUOTE_PENDING`；
- `CONFIRMATION_PENDING`；
- `PAYMENT_PENDING`；
- `FAILED_REVIEW` 前的可恢复任务；
- 未完成 Telegram 更新。

### 16.4 外部结果处理

外部结果优先通过：

1. A2A Push Notification；
2. A2A Task 查询；
3. Provider Webhook；
4. 受控状态查询。

不得依靠全局每秒数据库轮询。

### 16.5 Payment UNKNOWN

当 Provider 返回 UNKNOWN：

1. 保存原 operationId；
2. 订单保持 `PAYMENT_PENDING`；
3. 不创建第二个付款 operation；
4. Scheduler 使用原 operationId 查询；
5. 达到阈值仍未知时进入 `FAILED_REVIEW`；
6. 后台只能执行“查询/恢复”，不能创建新的付款。

---

## 17. Telegram 用户流程实现

### 17.1 创建订单

首次提示一次性列出：

- 商品；
- 目标数量；
- 单位；
- 参考单价；
- 参考运费；
- 认领截止；
- 商户；
- 资产；
- 分摊规则。

文案必须明确：

```text
参考价格不会直接用于付款。
数量凑齐后，商户给出最终价格；
每个人确认最终金额后才会付款。
```

### 17.2 认领

用户可以：

- 认领；
- 修改自己的份额；
- 在锁单前退出。

卡片只显示：

```text
已认领
```

不能显示：

```text
已授权
```

### 17.3 最终报价

Checkout 生成后群卡片显示：

- 商品总额；
- 运费；
- 折扣；
- 费用；
- 最终总额；
- 报价有效期；
- 每人应付；
- 确认进度。

### 17.4 确认入口

Bot 私聊发送一次性入口：

```text
[查看并确认]
```

不能在群内执行敏感确认。

### 17.5 付款进度

关键播报：

- 份额锁定；
- 最终报价请求中；
- 最终报价已生成；
- 确认进度；
- 全员确认；
- 付款处理中；
- 付款成功；
- 付款失败；
- 状态未知；
- Merchant 接单；
- 交付完成。

### 17.6 个人账单

付款成功后个人账单显示：

- 商品份额；
- 商品分摊；
- 运费分摊；
- 折扣分摊；
- 其他费用；
- 最终确认金额；
- 实际扣款；
- Merchant；
- Checkout ID 和版本；
- 交易凭证；
- 状态。

不显示：

- 授权上限；
- 安全缓冲；
- 退差；
- 退款交易；
- 完整钱包地址；
- 完整签名。

---

## 18. React Web

### 18.1 Trusted Confirmation Surface

页面：

```text
/confirm/:token
/confirm/:token/result
```

必须支持：

- Checkout 详情；
- 用户分配详情；
- 倒计时；
- 确认；
- 拒绝；
- 已确认状态；
- 已失效状态；
- Checkout 已变更提示；
- Token 过期提示。

不得出现管理入口。

### 18.2 Admin 页面

```text
/dashboard
/orders
/orders/:id
/checkouts/:id
/confirmations
/payments
/a2a/tasks
/a2a/agents
/agent-runs
/jobs
/audit
```

### 18.3 订单详情

展示：

- 状态时间线；
- 参与人；
- Checkout 版本；
- Checkout hash；
- Payment Allocation；
- 确认进度；
- 确认失效记录；
- Payment Operation；
- Merchant fulfillment；
- A2A Trace；
- Domain Event。

### 18.4 管理操作

允许：

- 重试可重试 Job；
- 重新查询 A2A Task；
- 查询 Payment Operation；
- 暂停新订单；
- 使过期确认轮次结束；
- 模拟 Merchant fulfillment；
- 模拟 Payment success/failure/unknown。

禁止：

- 直接修改最终金额；
- 直接修改 payee；
- 伪造用户确认；
- 直接把订单改成 `MERCHANT_PAID`；
- 创建第二笔 Payment Operation；
- 修改 Checkout hash；
- 绕过 Compliance Gate。

---

## 19. 幂等与并发

### 19.1 Telegram 幂等

保存：

```text
update_id
callback_query_id
```

同一事件重复到达只返回已有结果。

### 19.2 业务幂等键

```text
order-publish:{orderId}:{version}
merchant-checkout:{orderId}:{checkoutRequestVersion}
confirmation:{orderId}:{participantId}:{checkoutVersion}
confirmation-set:{orderId}:{checkoutVersion}
checkout:{orderId}:{checkoutVersion}
fulfillment:{orderId}:{merchantEventId}
```

### 19.3 A2A 幂等

A2A Task metadata 必须携带业务幂等键。

相同幂等键：

- 返回已有 Task 或 Artifact；
- 不创建第二个 Merchant Checkout；
- 不创建第二个 Payment Operation。

### 19.4 并发控制

需要防止：

- 最后一份份额被多人同时认领；
- 锁单过程中参与人退出；
- Checkout 到达时订单已经取消；
- 用户确认同时遇到 Checkout 过期；
- 最后一名确认触发两个付款作业；
- Payment Push 与查询结果重复处理；
- Telegram 和后台重复触发履约完成。

建议：

- Application Service 事务；
- 乐观版本号；
- 唯一索引；
- Outbox；
- 状态迁移 compare-and-set。

---

## 20. 安全边界

### 20.1 Agent 安全

Agent 不能：

- 访问数据库凭证；
- 访问支付密钥；
- 指定任意金额；
- 指定任意 payee；
- 创建用户确认；
- 代表用户点击确认；
- 解析前端提交的金额作为事实；
- 直接调用 Provider；
- 跳过 Checkout 校验。

### 20.2 Trusted Surface 安全

必须：

- HTTPS；
- 高熵 token；
- token hash 存储；
- 严格过期；
- CSRF/重放防护；
- 服务端重新加载 canonical 数据；
- 日志脱敏；
- 失败次数限制；
- 明确显示 Merchant 和金额；
- 防止 iframe 嵌入或点击劫持。

### 20.3 A2A 安全

MVP 至少实现：

- Agent Card URL 白名单；
- TLS；
- 服务端 API key 或 Bearer token；
- Agent ID 校验；
- profile version 校验；
- Schema 校验；
- Task ID 和 context ID 记录；
- raw payload hash；
- request timeout；
- body size limit；
- 日志脱敏。

生产升级时再接：

- OAuth/OIDC；
- mTLS；
- JWS；
- Agent 身份注册表；
- 密钥轮换。

### 20.4 Merchant payee

最终链上地址必须来自：

```text
merchantId
→ Merchant Directory
→ verified payee address
```

禁止从以下来源直接付款：

- Telegram 文本；
- LLM 输出；
- Merchant Artifact 中未经目录验证的裸地址；
- Admin 手工输入。

---

## 21. AP2 演进设计

### 21.1 当前对象到未来对象的映射

```text
MerchantCheckoutSnapshot
→ Merchant-signed Checkout JWT

UserConfirmationEvidence
→ Closed Checkout Mandate
  + Closed Payment Mandate

PaymentResult.receiptReference
→ Payment Receipt

Merchant Order Result
→ Checkout Receipt

A2aTraceRecord
→ AP2 Evidence Bundle Trace
```

### 21.2 必须预留的字段

Merchant Checkout：

```text
merchantCheckoutJwtRef
merchantSignatureKeyId
checkoutReceiptRef
```

User Confirmation：

```text
checkoutMandateRef
paymentMandateRef
trustedSurfaceRef
verificationResultRef
```

Payment Operation：

```text
paymentMandateRef
paymentReceiptRef
evidenceBundleId
credentialProviderRef
paymentProcessorRef
```

### 21.3 当前不实现

- SD-JWT；
- Mandate disclosure；
- Merchant Checkout 签名；
- Credential Provider；
- Payment Processor Receipt；
- Checkout Receipt；
- AP2 Trust Anchor；
- Digital Credentials API；
- OpenID4VP；
- Human Not Present；
- Open Mandate；
- Multi-principal AP2 Extension。

### 21.4 升级原则

未来 AP2 接入只能修改或增加：

```text
A2A Profile payload
Merchant Adapter
Confirmation Evidence Adapter
Payment Foundation AP2 Verifier
Receipt Store
Evidence Bundle
```

不得要求重写：

- Order Aggregate；
- Participant Aggregate；
- Checkout version；
- Allocation calculation；
- Human Present 状态机；
- Payment idempotency；
- Telegram 主流程。

---

## 22. 两日实施计划

### Day 1：Domain、Checkout 和确认链路

#### 工程师 A：后端与 Domain

- 演进 `AgentRuntime`；
- 建立 Fastify API；
- 引入 Drizzle ORM；
- 建立订单和参与人 schema；
- 实现新订单状态机；
- 实现份额锁定；
- 实现 Merchant Checkout canonical schema；
- 实现 Checkout hash；
- 实现 Payment Allocation；
- 建立 Confirmation Round、Token 和 Evidence；
- 实现 Mock Merchant Core；
- 实现 Merchant A2A Server；
- 实现 A2A Merchant Gateway；
- 建立 Scheduler 和 Outbox 基础。

#### 工程师 B：Telegram、Agent 和 Web

- 改造 Telegram handlers；
- 删除预授权相关文案和按钮；
- 实现订单草稿和字段补全；
- 实现认领和修改份额；
- 建立四个 Skill；
- 接入 Structured Output；
- 实现 Merchant Agent Card；
- 创建 Trusted Confirmation Surface；
- 实现确认详情页、确认和拒绝；
- 创建 React Admin；
- 实现订单、Checkout 和确认详情；
- 接入 OpenAPI 和 SSE。

#### Day 1 结束标准

- 用户可以创建和发布订单；
- 多成员可以认领和修改份额；
- 达到目标后份额会锁定；
- PoolMate 可以通过 A2A 获取最终 Checkout；
- Checkout hash 和版本可以落库；
- 系统可以计算精确个人金额；
- Confirmation Surface 可以显示 canonical 数据；
- 用户确认可以落库；
- 后台可以查看订单、Checkout 和确认进度；
- Agent Run 和 Merchant A2A Trace 可查看。

### Day 2：Payment A2A、履约、恢复和验收

#### 工程师 A：Payment 与恢复

- 实现 Confirmation Set 锁定；
- 实现 Payment canonical interface；
- 实现 Mock Payment Core；
- 实现 Payment A2A Server；
- 实现 A2A Payment Gateway；
- 实现 Compliance Gate；
- 实现 Mock Provider；
- 实现 Payment success/failure/unknown；
- 实现 Payment Operation 幂等；
- 实现状态查询和恢复；
- 实现 Merchant fulfillment；
- 实现订单完成；
- 完成并发和边界测试。

#### 工程师 B：交互、Trace 和演示

- 实现 Payment Agent Card；
- 完成确认进度 Telegram 卡片；
- 完成付款成功、失败和未知文案；
- 完成个人账单；
- 完成 A2A Task/Artifact Trace 页面；
- 完成 Payment Operation 页面；
- 完成失败 Job 页面；
- 实现后台模拟操作；
- 实现 Merchant fulfillment 演示；
- 完善 README 和环境变量；
- 完成端到端演示脚本。

#### Day 2 结束标准

完整演示：

```text
群成员发起订单
→ Agent 解析并确认草稿
→ 多成员认领
→ 份额锁定
→ A2A Merchant Task
→ 最终 Checkout Artifact
→ 精确个人金额
→ 三人 Human Present 确认
→ 确认集合锁定
→ A2A Payment Task
→ Compliance Gate
→ Mock Payment Confirmed
→ 商户履约
→ 确认交付
→ 订单直接 Completed
→ 后台展示完整 Trace
```

---

## 23. 测试范围

### 23.1 Domain 单元测试

- 订单合法和非法状态迁移；
- 最后一份认领并发；
- 份额锁定；
- Checkout 金额恒等式；
- Checkout hash 稳定性；
- 不同 Checkout 内容产生不同 hash；
- `BY_QUANTITY` 分配；
- `EQUAL_SPLIT` 分配；
- 尾差分配；
- 分配合计严格等于 Checkout 总额；
- Checkout 变更使分配和确认失效；
- 全员确认判断；
- 确认集合锁定；
- 交付后不进入结算。

### 23.2 Confirmation 测试

- token 过期；
- token 重放；
- token 属于错误用户；
- Checkout 过期；
- Checkout version 不一致；
- Checkout hash 不一致；
- Allocation 变化；
- 用户重复确认；
- 用户拒绝；
- 最后一名确认并发；
- 旧确认不能用于新 Checkout。

### 23.3 A2A 测试

- Agent Card 发现；
- 未支持 Profile；
- Task 创建；
- Task 查询；
- Artifact Schema；
- Task COMPLETED + business FAILED；
- Task COMPLETED + business UNKNOWN；
- 重复幂等键；
- Push 重复；
- Task 超时；
- Agent 身份不匹配；
- raw payload 保存和脱敏。

### 23.4 Payment 测试

- 未全员确认拒付；
- Confirmation Set 未锁定拒付；
- 金额分配不一致拒付；
- Checkout hash 不一致拒付；
- Checkout 过期拒付；
- 非白名单 payee 拒付；
- Tenant 暂停拒付；
- 重复 Payment Task 不重复付款；
- Provider UNKNOWN 不重新付款；
- 成功结果生成凭证；
- Payment Task 完成但业务失败；
- Telegram 重试不重复付款。

### 23.5 集成测试

```text
Telegram Update
→ Draft
→ Order
→ Participant
→ Merchant A2A Task
→ Checkout
→ Allocation
→ Confirmation
→ Confirmation Set
→ Payment A2A Task
→ Provider
→ Payment Artifact
→ Telegram Receipt
```

### 23.6 故障注入

- Telegram API 429/5xx；
- Merchant A2A timeout；
- Merchant 返回无效 Checkout；
- Checkout 在确认中到期；
- Payment A2A timeout；
- Payment Push 重复和乱序；
- Provider 返回 UNKNOWN；
- 数据库事务冲突；
- 服务在付款提交后重启；
- Admin SSE 断线。

---

## 24. MVP 明确不做

本阶段不实现：

- 正式钱包连接；
- 正式链上资金托管；
- 正式 Treasury 协议兼容承诺；
- AP2 正式兼容声明；
- Merchant-signed Checkout JWT；
- Checkout Mandate；
- Payment Mandate；
- Checkout Receipt；
- Payment Receipt；
- SD-JWT；
- Digital Credentials；
- Human Not Present；
- 预估金额授权；
- 安全缓冲；
- 自动退差；
- 自动补差；
- Batch Payout；
- Settlement Batch；
- 退款主流程；
- 多商品购物车；
- 多 Merchant 拆单；
- 动态 Provider 路由；
- Agent Marketplace；
- Skill 市场；
- 通用 Agent Builder；
- 通用工作流编排器；
- Redis/BullMQ；
- PostgreSQL；
- 多实例 Scheduler；
- 复杂 RBAC；
- 多币种换汇；
- 税务系统。

---

## 25. 主要风险与降级策略

### 25.1 两日内 A2A SDK 接入不稳定

降级：

- 保持相同 Agent Card、Task 和 Artifact Schema；
- 使用本地 JSON-RPC/HTTP bridge；
- 完整保存 A2A-like Trace；
- 不改变 Gateway 和 Domain；
- README 明确标注 transport 降级。

不得降级为：

- Domain 直接调用 Mock Core；
- Agent 自由传递金额；
- 跳过 Task/Artifact 边界。

### 25.2 Trusted Confirmation Surface 未完成

降级：

- 使用后端服务端渲染页面；
- Telegram 私聊发送一次性链接；
- 使用测试身份；
- 保持 canonical 数据服务端加载；
- 保持确认 nonce 和幂等。

不得使用：

- 群内普通文本“回复确认”；
- LLM 判断用户是否确认；
- 由前端回传金额。

### 25.3 Checkout 生成不稳定

降级：

- 使用固定 Mock Merchant；
- 固定商品目录；
- 固定最终报价；
- 保存真实 A2A Task 和 Artifact；
- 不允许手工在后台改金额。

### 25.4 Payment Provider 不稳定

降级：

- 使用 Mock Provider；
- 支持成功、失败和未知三种结果；
- 保持 Payment Operation 和幂等；
- 保持 Payment A2A Task；
- 保持恢复逻辑。

### 25.5 Checkout 有效期过短

降级：

- Demo 设置 15 分钟有效期；
- Telegram 主动提醒；
- 管理后台展示倒计时；
- 过期后重新获取新版本；
- 所有旧确认失效。

### 25.6 两日范围过大

必须优先保证：

1. 创建订单；
2. 多人认领；
3. A2A Merchant Checkout；
4. 精确分配；
5. Human Present 确认；
6. A2A Payment Task；
7. Mock Payment；
8. A2A/Payment Trace。

可以降级：

- Fulfillment 使用后台模拟；
- Admin 视觉简化；
- Agent Card 只实现必要字段；
- Push Notification 改为受控查询；
- 只支持一个 Merchant；
- 只支持一种资产；
- 只支持 `BY_QUANTITY`；
- AP2 预留字段只建 schema，不做页面。

---

## 26. 验收标准

### Telegram

- 任意允许的群成员可以发起订单；
- 首次提示一次性列出全部字段；
- 参考价格明确标记为非付款金额；
- 任意群成员可认领；
- 用户只能修改自己的份额；
- 认领不显示“已授权”；
- 份额满足后自动请求最终报价；
- 群卡片显示最终报价和确认进度；
- 任一参与人未确认时不显示“正在付款”；
- 付款和履约状态持续更新。

### Checkout

- Merchant Checkout 通过 A2A Task 获取；
- Checkout 有唯一 ID、版本和 hash；
- 已锁定版本不可原地修改；
- Checkout Schema 校验；
- Checkout 金额恒等式成立；
- payeeRef 可以映射到白名单 Merchant；
- Checkout 变化会创建新版本；
- 旧确认自动失效。

### Human Present

- 每名参与人有独立确认入口；
- 页面由服务端 canonical 数据渲染；
- 页面显示 Merchant、商品、费用和本人金额；
- 用户只能确认本人分配；
- 确认绑定 Checkout hash 和版本；
- token 过期和重放被拒绝；
- 拒绝不会触发付款；
- 全员确认后才锁定 Confirmation Set。

### Payment

- PoolMate 通过 A2A 创建 Payment Task；
- 高层请求只提交引用；
- Payment Foundation 重新加载 canonical 数据；
- 每人实际金额等于确认金额；
- 分配总额等于 Checkout 总额；
- 非白名单 payee 被拒绝；
- 重复任务不重复付款；
- UNKNOWN 状态不重新付款；
- 成功结果有 transaction/receipt reference；
- 交付后不执行退差。

### Agent

- 使用 Codex 原生 Skill；
- Structured Output 只用于草稿数据；
- Agent Run 可追踪；
- Agent 无法指定任意金额和 payee；
- Agent 无法生成确认记录；
- Agent 无法直接修改订单状态。

### A2A

- Merchant 和 Payment Agent Card 可访问；
- Profile URI 和版本明确；
- A2A Task、Artifact 和业务状态分离；
- raw request/response 可审计；
- 幂等键可追踪；
- Admin 可查看 Task 时间线；
- 外部协议对象不进入 Domain。

### 后端与后台

- 使用 ORM；
- 无业务手写 SQL；
- API 和 Web 分离；
- Swagger/OpenAPI 可访问；
- Scheduler 不进行每秒全局轮询；
- 重启后可恢复未完成任务；
- 后台不能伪造确认、金额和付款成功；
- AP2 预留引用可查询。

---

## 27. Demo 脚本

1. 主持人在 Telegram 群发送：

   ```text
   @PoolMate 拼三箱杨梅，一箱大约 89 USDT，5 分钟截止
   ```

2. Bot 提示价格只是参考，并发布认领卡片。
3. Alice、Bob、Carol 分别认领一箱。
4. 份额锁定，大屏显示 Merchant Agent Card 和 A2A Task。
5. Merchant Agent 返回最终 Checkout：

   ```text
   商品 267 USDT
   运费 18 USDT
   总额 285 USDT
   ```

6. PoolMate 计算三人各 95 USDT。
7. 三人分别打开 Trusted Confirmation Surface。
8. 大屏展示确认进度 `0/3 → 1/3 → 2/3 → 3/3`。
9. 最后一人确认后，订单进入 `READY_FOR_PAYMENT`。
10. PoolMate 创建 Payment A2A Task。
11. 大屏展示 Compliance Gate：

    ```text
    Checkout hash matched
    Confirmations matched
    Allocations balanced
    Merchant allowed
    Idempotency passed
    ```

12. Mock Provider 返回付款成功。
13. Telegram 显示商户付款凭证。
14. 彩蛋：Dave 要求把钱转给个人地址，Payment Foundation 返回 `PAYEE_NOT_ALLOWED`。
15. 后台模拟商户已交付。
16. Alice 确认收货，订单直接进入 `COMPLETED`。
17. 群总账显示三人各支付 95 USDT，没有退差阶段。
18. 收束文案：

    > PoolMate 不是先拿到一笔模糊授权再决定怎么花，而是在每个人看到最终商品和精确金额并确认后，才执行与该 Checkout 完全一致的付款。

---

## 28. 最终实施基线

PoolMate Human Present MVP 的最终技术定位为：

> 一个运行在 Telegram 群内的拼单与支付确认 Agent。它使用 Structured Output 解析订单草稿，使用确定性 Domain Core 管理份额、最终 Checkout、精确分配、逐人确认、付款前置条件和幂等性；使用 A2A 与 Merchant Agent 和 Payment Agent 协作；使用 Trusted Confirmation Surface 取得每名参与人对同一 Checkout 和本人精确金额的明确确认；所有确认完成后，Payment Foundation 执行一次商户付款。正常主流程不进行交付后金额重算和退差。

本方案为未来 AP2 Human Present 保留 Merchant Checkout、Checkout hash、User Confirmation Evidence、Mandate reference、Receipt reference 和 Evidence Bundle 边界，但当前版本不声明 AP2 兼容。

正式 AP2 接入时，应在 Merchant、Confirmation 和 Payment Adapter 层增加签名、Mandate 验证和 Receipt，不应重写订单核心状态机。
