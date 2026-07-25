# PoolMate 支付基座、A2A 与 AP2 严格审计及重建方案

> 审计日期：2026-07-25
> 审计提交：`46c1106da9aceaf865dc0dc9b88821945349f1c4`
> 审计范围：`web/server/`、`web/src/domain/`、`web/src/poolmate/`、`poolmate/docs/`、`docs/PRODUCT_SPEC.md`、`docs/INJECTIVE_AGENT_PAYMENT_HANDOFF.md`
> 权威后端边界：所有新实现必须进入 `web/server/`，不得恢复根目录第二套后端
> 协议基线：A2A v1.0.1；AP2 v0.2.0
> 执行文档：[`PoolMate_补救方案.md`](./PoolMate_补救方案.md)

## 0. 审计口径

本文档不以“仓库中有类、路由或测试”判定能力已实现，而以以下条件同时成立为验收依据：

1. 资金事实唯一，不存在可以互相矛盾的账户、预算或回执。
2. 所有资金动作都经过 `Intent -> PolicyDecision -> Approval(optional) -> Settlement -> Receipt`。
3. 通用基座不知道 PoolMate、KaleidoX、Telegram、股票、拼单或演示商户等业务语义。
4. 相同请求可重放且不重复付款；相同幂等键、不同请求必须冲突。
5. 服务重启、多实例并发、广播超时和回执落库失败后仍能恢复，不重复扣款。
6. Mock、Replay、Testnet 和 Live 是不同类型与证据等级，不靠文案区分。
7. A2A/AP2 能力需通过对应版本的 schema、签名、交互和失败路径验证，不能以字段枚举代替。

本文档只使用三种状态：

| 状态 | 含义 |
|---|---|
| 未实现 | 无法满足用户或协议验收条件 |
| 错误实现，不可作为完成证据 | 有代码，但它违反边界、资金不变量或产品流程 |
| 可拆出的代码素材 | 局部机制可在重新建模和测试后复用，不代表能力已完成 |

`docs/PRODUCT_SPEC.md` 和 `docs/INJECTIVE_AGENT_PAYMENT_HANDOFF.md` 中的“已实现”、“42/42”等是被审计对象，不是审计前提。

## 1. 结论先行

### 1.1 总结论

当前仓库没有形成通用支付基座，也没有完成 PoolMate 支付、PoolMate A2A 或 AP2。

当前实现是 KaleidoX 专用 Treasury、两个业务写死的 Policy 配置、一个业务写死的 Injective 适配器、PoolMate Mock 演示和 KaleidoX A2A 路由的混合体。它可以产生形似 `Intent / Decision / Receipt` 的对象，但不能证明账户、预算、授权、结算和协议闭环成立。

对现有完成度的更正如下：

| 能力 | 严格判定 | 核心原因 |
|---|---|---|
| 通用 Agent Treasury / Spend Control | 未实现 | 核心类型、策略、账户方案、payee 和装配均嵌入业务 |
| 唯一资金账本 | 错误实现，不可作为完成证据 | `TreasuryService` 与 PactLedger 保存两套不一致资金事实 |
| Account / Balance / Budget | 未实现 | 没有通用账户、冻结、预留、累计消费和资产维度 |
| Policy Engine | 错误实现，不可作为完成证据 | 只检查静态常量，预算每次被重置，审批是布尔值 |
| 支付幂等 | 未实现 | 全局 ID、无 request hash、无跨实例锁、无 tenant/caller 约束 |
| 支付失败恢复 | 未实现 | `settling` 被直接终结为失败，无 tx/memo 查询恢复 |
| Injective Testnet 结算 | 可拆出的代码素材 | 有 SDK 调用素材，但无真实交易证据，且资产/payee 映射业务化 |
| PoolMate Telegram 拼单 | 未实现 | 仅有认领和 Mock 付款原型，完全不符合最终报价与逐人确认流程 |
| PoolMate 成员出资 | 未实现 | 没有入金、可用余额、预留、扣款或外部支付凭证 |
| PoolMate A2A | 未实现 | 当前 A2A 只能创建 KaleidoX 股票任务 |
| A2A v1.0.1 基座 | 未实现 | 手写 v0.3 风格子集，无完整 schema、所有权、幂等和持久化 |
| AP2 v0.2.0 | 未实现 | 只有 `"ap2"` 枚举和展示文案，没有 Mandate、签名、验证或签名 Receipt |
| API 测试 | 可拆出的代码素材 | 断言了当前错误设计按代码运行，没有验证资金不变量和协议互操作 |

### 1.2 唯一可保留的判断

以下代码可作为重建素材，但不应保留“已实现”标签：

- `AgentPaymentIntent / PolicyDecision / SettlementReceipt` 的分层命名思路；
- PostgreSQL Repository 的基础连接与 JSON 序列化代码；
- Injective SDK `MsgSend` 构造、地址校验和 Explorer URL 组装代码；
- PoolMate 群、会话、成员和并发认领的局部代码；
- Fastify 和 grammY 的运行时接入代码。

这些素材只能在通用领域模型重新建立、安全约束补齐、旧测试不再被当作规格后按需复用。

## 2. P0 查找结果

### P0-1：所谓“通用基座”直接嵌入两个业务

这不是抽象不够漂亮，而是基座的决策结果依赖业务硬编码：

- `web/src/domain/pactledger.ts:1` 把 `appId` 封闭为 `'kaleidox' | 'poolmate'`。
- `web/src/domain/pactledger.ts:3-11` 把研究、回测、风控、执行、商户付款和退款写成基座联合类型。
- `web/server/pactledger/policies.ts:3-22` 直接定义 KaleidoX 和 PoolMate 两套策略，并写死 `merchant-demo`。
- `web/server/config/injective.ts:19-23` 把 `risk`、`execution`、`poolmateMerchant` 定义为 Injective 基础配置字段。
- `web/server/config/injective.ts:118-122` 的 payee 映射主动识别 `merchant-demo`。
- `web/server/treasury.ts:27-35` 在所谓 Treasury 内硬编码七个 KaleidoX Agent 和分配金额。
- `web/server/app.ts:93-98` 为 PoolMate 特别装配第二个 Mock Ledger。

这些不是“示例配置放在了基座里”这么简单。它们直接决定哪个应用可用、哪个 payee 可付、预算多少和地址映射结果。第三个应用无法仅通过注册数据接入，必须修改基座源码。

**判定：通用支付基座未实现。**

### P0-2：存在两套互相矛盾的资金链

KaleidoX 编排器先直接调用 `TreasuryService` 记录资金完成：

- `web/server/orchestrator.ts:111`：研究服务 20 USDT；
- `web/server/orchestrator.ts:128`：回测服务 25 USDT；
- `web/server/orchestrator.ts:138`：风控服务 15 USDT；
- `web/server/orchestrator.ts:52`：执行服务 50 USDT。

`TreasuryService.transfer()` 在 `web/server/treasury.ts:165-177` 直接扣减余额、增加 spent/earned，然后把交易标记为 completed。这一路径没有调用 PactLedger Policy、Approval 或 Settlement Adapter。

紧接着编排器又创建另一笔 PactLedger 支付：

- `web/server/orchestrator.ts:139-154`：风控服务 0.0005 INJ；
- `web/server/orchestrator.ts:61-76`：执行服务 0.001 INJ。

同一业务服务因此同时存在不同金额、不同币种、不同状态和不同 Receipt 的两套账。内部 Treasury 已扣账后，链上结算失败也没有冲正或释放。研究和回测费更是完全绕过 PactLedger。

**判定：这不是“内部账本 + 链上回执”的双层模型，因为二者没有共享同一 Payment Operation、金额或会计分录。这是违反唯一资金链的错误实现。**

### P0-3：Policy 没有控制任何真实资金

`web/server/pactledger/policyEngine.ts:15-17` 在调用方不提供 `availableBudget` 时，把静态 `policy.budgetLimit` 当作每次请求的可用预算。当前 `PactLedgerService` 从不传入真实账户余额。

结果是：

- 没有 tenant/payer/asset 账户；
- 没有 balance、reserved、pending、spent 的可核对恒等式；
- 没有并发付款的原子预留；
- 任意多笔低于单笔上限的付款都能反复通过；
- `amount` 为 JavaScript `number`，Policy 数字没有绑定 asset/decimals；
- 已失败、未知、已确认支付都不会改变 Policy 的可用预算。

`humanApproved` 也只是一个函数参数（`web/server/pactledger/service.ts:16`），没有 approver principal、scope、Intent hash、nonce、有效期、撤销或审批记录。PoolMate 没有任何路由能将 `approval_required` 恢复到后续结算。

**判定：Account、Budget、Spend Control 和 Approval 未实现；静态检查器不能称为资金 Policy Engine。**

### P0-4：幂等、租户隔离和多实例并发均不成立

`PactLedgerService` 的幂等唯一依据是全局 `intent.id`：

- `web/server/pactledger/service.ts:17-23` 的 `inFlight` 只存在当前 Service 实例的内存中；
- `web/server/pactledger/service.ts:30-33` 找到任意同 ID Trace 就复用，不比较 payload；
- `web/server/pactledger/repository.ts:65-68` 对同 ID 直接 upsert 并覆盖 payload；
- `web/server/pactledger/repository.ts:116-146` 查 Trace 只使用 intent ID，没有 tenant、caller 或 payer 条件；
- `web/server/app.ts:88-98` 同一进程中已经有两个 `PactLedgerService` 共享一个 Repository，两个内存 Map 互不可见；
- 多进程或多机部署更没有 DB lease、row lock 或 advisory lock。

同一 ID 可以先后携带不同 tenant、payer、payee、amount 和 currency，当前不会返回 `IDEMPOTENCY_CONFLICT`。两个实例也可能在 Receipt 落库前同时广播。

**判定：支付幂等未实现。现有测试最多证明单 Service 实例内的 Promise 共享。**

### P0-5：匿名 Demo 和生产付款共用全局账本

`/api/demo/` 在 `web/server/app.ts:131-139` 被全局鉴权钩子豁免。`/api/demo/poolmate/checkout` 在 `web/server/app.ts:334-364` 允许匿名调用者自带 `intentId`。

该路由使用的 `poolMateDemoLedger` 与生产 `pactLedger` 共用同一 `PactLedgerRepository`（`web/server/app.ts:88-98`）。因此 Demo Trace 会进入真实 `pactledger_payment_intents`、`pactledger_policy_decisions` 和 `settlement_receipts`。

可见风险包括：

- 公开请求污染审计和 Base Status 数据；
- 调用方可抢占尚未使用的 PoolMate intent ID；
- 生产请求可因同 ID 的 Demo Receipt 而被错误当作已完成；
- Demo tenant 和真实 tenant 不在 Repository 层隔离；
- Mock Receipt 和 Testnet Receipt 处在同一终态查询空间。

**判定：这是账本边界缺失，不是演示环境的可接受简化。**

### P0-6：资产映射可以把业务币种错付成另一种链上资产

PoolMate 创建 `267 CNY-DEMO` Intent，但 `InjectiveTestnetSettlementAdapter` 在 `web/server/adapters/injectiveTestnet.ts:164-178` 直接把 `intent.amount` 按全局 `paymentDecimals` 转换，使用全局 `paymentDenom`。它不校验 `intent.currency` 是否与 denom 对应。

`intent.denom` 也是可选的；如果未提供，Adapter 会默认采用全局 denom。这意味着错误装配后，`267 CNY-DEMO` 可被解释为 267 个某种链上资产。

另一方面，Intent 先使用 JavaScript 浮点 `number`，再调用 `.toString()` 转原子金额，不是端到端的精确金额模型。

**判定：资产目录和精确金额未实现；现有 Adapter 不能直接给 PoolMate 使用。**

### P0-7：失败与中断处理会丢失可恢复性

`web/server/pactledger/service.ts:34-49` 发现已持久化的 `settling` 后，立即写入不可重试的 failed Receipt。它没有：

- 在广播前保存 execution attempt；
- 保存 SDK 返回的 tx hash 后再等确认；
- 按 tx hash 查询链上结果；
- 按 `PactLedger:<intentId>` memo 查询；
- 区分“明确失败”和“结果未知”；
- 对已标 `retryable: true` 的 Receipt 创建新 attempt。

`web/server/pactledger/service.ts:30-31` 只要存在任意 Receipt，包括 `retryable: true` 的 failed Receipt，之后永久返回原结果。

**判定：广播后恢复、安全重试和未知状态未实现。**

## 3. PoolMate 专项审计

### 3.1 代码流程与产品定义相反

PoolMate 文档要求：

```text
认领份额
  -> 获取最终商户 Checkout
  -> 计算精确 Allocation
  -> 每名参与人看到同一 Checkout 并确认本人金额
  -> 锁定 ConfirmationSet
  -> 一次商户付款
```

当前代码实际上是：

```text
认领份额达到目标
  -> status = funded
  -> Telegram callback 立即 checkoutSession()
  -> 固定 merchant-demo / CNY-DEMO / protocol=ap2
  -> Mock Receipt
  -> 全部成员 status = paid
```

关键证据：

- `web/server/poolmate/repository.ts:255-266` 仅因份额数量满员就进入 `funded`；
- `web/server/poolmate/telegram.ts:159-164` 在 `funded` 后立即付款；
- `web/server/poolmate/service.ts:245-263` 写死商户、币种、AP2 标签和 Mock 模式；
- `web/server/poolmate/repository.ts:406-408` 付款标记完成后把所有成员直接标记为 `paid`。

代码中没有 Merchant Checkout、Checkout version/hash、运费/折扣/税费、Allocation 恒等式、可信确认页、逐人确认证据、ConfirmationSet、确认作废或商户身份验证。

**判定：“PoolMate Telegram 拼单：部分实现”是错误结论。正确状态是“未实现；仅有不可作为验收证据的交互原型”。**

### 3.2 `funded` 是虚假资金状态

成员加入时只提供 Telegram user ID、用户名和份数。系统没有任何成员资金动作：

- 无成员账户；
- 无入金 Receipt；
- 无钱包或支付凭证；
- 无预留/冻结；
- 无成员扣款分录；
- 无失败后释放或退回。

所以 `funded` 实际只表示 `filled`，`member.status = paid` 完全没有资金证据。

PoolMate 必须先明确资金模型，否则“不需任何人垫付”无法实现：

| 模型 | 真实含义 | 结论 |
|---|---|---|
| 参与人预充值并原子预留 | 每人有可验证余额，确认后预留，商户付款后结转 | 最符合产品语义，但需要账户、托管/合规边界 |
| 多个参与人分别外部支付 | 本质上是多笔入金，再汇总一笔商户付款 | 需完整 funding ledger 与中间账户 |
| 演示 Treasury 赞助付款 | 参与人没有出资，由固定 Testnet Treasury 支付 | 可用于比赛证据，必须标明“赞助演示”，不能验收产品付款 |

AP2 不会自动解决多人出资和汇总账本问题。

### 3.3 PoolMate 的审批分支是死路

PoolMate 单笔上限和审批阈值都是 300，但产品流程可以轻易达到或超过该金额。`PoolMateService.persistTrace()` 可把 Session 标记为 `approval_required`，但没有提交审批、校验审批人、继续原 Intent 或展示审批证据的 API/UI。

**判定：PoolMate 人工审批未实现。**

### 3.4 前端与当前代码、产品文档都不一致

- `web/src/poolmate/PoolMate.tsx:76` 请求受保护的 `/api/poolmate/bot-status`，后端实际是 `/api/public/poolmate/bot-status`。
- `web/src/poolmate/PoolMate.tsx:401` 宣称“自动分账退差”，而 PoolMate v2/v3 文档明确删除交付后退差。
- UI 的 Mock Trace 展示可以证明一个静态检查结果，不能证明拼单业务闭环。

## 4. A2A 专项审计

### 4.1 当前 A2A 是 KaleidoX 专用入站路由

`web/server/a2a.ts` 不是通用 A2A 层：

- `parseA2AInput()` 只解析 A 股代码、USDT 预算、回撤和仓位（`3-14`）；
- Task metadata 写死 `appId: 'kaleidox'`（`29-40`）；
- Agent Card 名称是 `KaleidoX on PactLedger`（`45-51`）；
- 输出 Artifact 是量化研究结果；
- 没有 PoolMate Shopping、Merchant 或 Payment Skill/Profile。

当前也没有 outbound A2A client。因此并不存在“PoolMate 通过 A2A 获取 Merchant Checkout”或“PoolMate 通过 A2A 请求 Payment Agent”的任何调用链。

**判定：PoolMate A2A 未实现；通用 A2A 基座也未实现。**

### 4.2 当前对 A2A v1.0.1 不兼容

当前 Agent Card 声明 `protocolVersion: '0.3.0'`，路由手写 `message/send`、`tasks/get` 和 v0.3 风格对象。仓库没有 A2A SDK/schema dependency。

对 v1.0.1 的最低重建要求是：

- 使用官方 SDK 或官方 schema 作为编译/测试门；
- Agent Card 按 v1 interface 声明 endpoint、binding、version、skills 和 security；
- 使用 v1 `SendMessage`、`GetTask` 等操作和 media type；
- 完整保存 caller、context、task、message、artifact、status history 和时间字段；
- 不支持的 binding/profile/extension 必须返回稳定协议错误；
- 如仍需兼容赛事 v0.3，必须以独立 Adapter 映射到内部 canonical model，不得继续把 v0.3 对象当内部模型。

### 4.3 A2A 鉴权、所有权和幂等不成立

`web/server/app.ts:162-176` 在 Mock 模式且无 API key 时允许匿名 A2A 调用。Testnet 模式也只有一个全局 Bearer key。

当前边界缺失包括：

- key 不对应 caller principal、tenant、app 或 skill scope；
- A2A 任务由 `createAndStartTask()` 以 `ownerId = undefined` 创建；
- `GET /a2a/tasks/:id` 和 `tasks/get` 按 UUID 直接查任务，不验证 owner；
- 持有全局 key 的任何调用者都可查询已知 UUID 的任务；
- 重放相同 Message 会创建新 Task；
- 没有 A2A request hash、idempotency key 或 business operation 绑定；
- 没有 caller 级限流、资源配额和数据保留策略；
- A2A Task 状态和付款业务状态没有稳定映射。

**判定：A2A 多租户安全、Task 所有权和幂等未实现。**

### 4.4 A2A 在目标架构中的正确边界

A2A 是 Agent 发现、请求、Task/Artifact 交换和跨 Agent Trace 协议，不是资金真相来源。

PoolMate Payment A2A 请求不应允许调用方直接提交可信 amount/payee，而应只提交服务端引用：

```json
{
  "operation": "poolmate.payment.execute",
  "profile": "urn:pactledger:poolmate:payment:v1",
  "orderId": "PM-7F3K",
  "checkoutId": "checkout_0188",
  "checkoutVersion": 1,
  "confirmationSetId": "confirmset_01",
  "idempotencyKey": "poolmate:PM-7F3K:checkout:1"
}
```

Payment Application Service 必须从服务端重载 Checkout、Allocation、ConfirmationSet、Merchant Directory 和 Funding Reservation，再创建 canonical Payment Intent。A2A payload 不能覆盖这些事实。

## 5. AP2 专项审计

### 5.1 `protocol: "ap2"` 是错误标注

仓库中与 AP2 相关的可执行代码只有：

- `AgentPaymentProtocol` 的 `'ap2'` 枚举；
- PoolMate Intent 的 `protocol: 'ap2'`；
- UI 对 `ap2` 的显示标签。

仓库不存在：

- AP2 A2A extension 声明与协商；
- AP2 v0.2.0 schema dependency 或版本锁定；
- merchant-signed Checkout JWT；
- Checkout Mandate；
- Payment Mandate；
- Trusted Surface 签名；
- Credential Provider 或受限 payment credential；
- Merchant / Merchant Payment Processor 验证；
- `vct`、issuer、audience、nonce、expiry、key ID、trust anchor 和撤销检查；
- 签名 Checkout Receipt 和 Payment Receipt；
- AP2 verification result 持久化。

**判定：AP2 未实现。当前 `protocol: "ap2"` 必须移除或改为 `authorizationScheme: "pactledger-native"`，否则它是虚假协议声明。**

### 5.2 AP2 Human Present 的最低验证链

按 AP2 v0.2.0，目标链路应至少包含：

```text
Merchant 创建并签名 Checkout JWT
  -> Shopping Agent 构造与 Checkout 绑定的 Mandate Content
  -> Trusted Surface 展示闭合内容并取得 payer 签名
  -> Credential Provider 验证 Payment Mandate 并产生受限凭证
  -> Merchant 验证 Checkout Mandate
  -> MPP 验证 Payment Mandate 与 Checkout JWT hash、payee、amount 和 instrument
  -> 返回可验证的签名 Payment Receipt / Checkout Receipt
```

仅在整条验证链成功且证据持久化后，才能将 `authorizationScheme` 标记为 `ap2`。

### 5.3 AP2 与 PoolMate 多人出资的关系

PoolMate 的三名成员确认同一拼单，不等于三人可以共同签出一份单一 payer 的 AP2 Payment Mandate。Mandate 签名人必须真正有权授权对应支付工具。

可行的单 payer 模型是：

```text
成员 A/B/C -> PoolMate UserConfirmationEvidence
对应资金 -> 已预留到 PoolMate Treasury
全部确认 -> ConfirmationSet
Treasury controller -> AP2 payer principal
Treasury Payment Mandate -> 一次商户付款
```

此时成员确认是 PoolMate 业务证据，不是 AP2 Payment Mandate。成员的资金如何进入或预留到 Treasury，仍需 funding ledger 解决。

如果每名成员分别作为 payer，就是多笔支付或自定义 multi-principal 扩展，不能宣称是 AP2 核心规范原生能力。

### 5.4 当前 `protocol` 字段混合了三个正交维度

`internal | x402 | acp | ap2` 同时被用来表示调用来源、授权协议和支付方式。应拆分为：

```ts
interface PaymentProtocolContext {
  sourceTransport: 'internal' | 'rest' | 'telegram' | 'a2a'
  authorizationScheme: 'pactledger-native' | 'ap2'
  settlementRail: 'mock' | 'injective-testnet'
  profileUri?: string
  authorizationEvidenceRef?: string
}
```

A2A 只影响 transport/profile，AP2 只影响 authorization/evidence，Injective 只影响 settlement rail/receipt。

## 6. 通用支付基座的目标边界

### 6.1 基座可以看到的东西

基座只能看到不透明的资源 ID 和通用资金语义：

- `tenantId`、`applicationId`、`principalId`；
- `accountId`、`assetId`、`amountAtomic`；
- `payeeId`、`payeeAccountRef`；
- `purposeCode` 作为注册数据，而不是基座枚举；
- `policySetId`、`approvalPolicyId`；
- `authorizationEvidenceRef`；
- `idempotencyKey`、`requestHash`；
- `settlementProviderId`、`settlementRail`；
- Payment Operation、Attempt、Receipt 和会计分录。

### 6.2 基座不得看到的东西

- `poolmate`、`kaleidox` 的封闭 TypeScript union；
- Telegram chat/member/message；
- 商品、份额、Checkout 明细、运费和拼单状态；
- 股票代码、回测、仓位和风控 Agent；
- `merchant-demo`、`risk`、`execution` 等固定 payee；
- `INJECTIVE_POOLMATE_MERCHANT_ADDRESS` 等业务专用配置；
- AP2 已验证与否的猜测值。

### 6.3 正确的注册型能力

通用性不是把所有业务值改成 `string`，而是把它们放到有租户边界、有版本、可审计的注册数据中：

```text
Application Registry
Policy Set Registry
Purpose Registry
Account Registry
Asset Registry
Payee / Merchant Directory
Settlement Provider Registry
Authorization Verifier Registry
```

PoolMate 和 KaleidoX 只通过 provisioning 创建这些数据，不向 PactLedger 核心添加 `if (appId === ...)`。

### 6.4 唯一资金模型

必须删除当前两套资金真相。每笔支付只有一个 `PaymentOperation`，账户分录与结算 Receipt 都引用它：

```text
PaymentIntent accepted
  -> PolicyDecision
  -> Reserve(account, asset, amountAtomic)
  -> ApprovalEvidence(optional)
  -> PaymentOperation
  -> SettlementAttempt
  -> confirmed: reserve -> spent + Receipt
  -> definitively_failed: release reserve
  -> unknown: keep reserve + reconcile
```

会计恒等式必须在数据库约束和事务内维持：

```text
available = posted_balance - reserved
allocation = available + reserved + spent (within the budget period)
```

不得在 Settlement 成功前把付款标记为 completed；也不得在结果 unknown 时释放预留。

### 6.5 金额、资产和收款方

canonical Intent 只使用原子金额：

```ts
interface Money {
  assetId: string
  amountAtomic: string
}
```

Asset Registry 保存 network、denom、decimals、enabled 和精度。业务展示金额在进入 Intent 前就必须转换为精确原子单位。

Payee Directory 保存 tenant-scoped payee 和已验证地址。Settlement Adapter 只接收基座已解析的 destination，不识别 `merchant-demo`。

### 6.6 数据库幂等与恢复状态机

最少状态应为：

```text
received
  -> policy_rejected
  -> approval_pending -> approved
  -> reserved
  -> broadcasting
  -> submitted(txHash known)
  -> confirmed
  -> failed_final
  -> unknown -> reconciling -> confirmed | failed_final
```

必须做到：

- `UNIQUE(tenant_id, idempotency_key)`；
- canonical request hash 覆盖 payer、payee、asset、amount、purpose、authorization reference 和 expiresAt；
- 同 key/同 hash 返回原 Operation；
- 同 key/不同 hash 返回 `409 IDEMPOTENCY_CONFLICT`；
- 在数据库事务中抢占 execution lease，不依赖进程 Map；
- 广播 attempt 和 tx hash 先持久化，再等 Receipt；
- 超时进入 unknown，由 reconciler 查询，不自动再广播。

## 7. PoolMate 正确接入方案

### 7.1 职责分工

```text
web/server/poolmate/
  Telegram parsing, Order, Participant, Claim
  Merchant Checkout, Allocation, User Confirmation
  ConfirmationSet, Fulfillment, PoolMate projections
  Payment request construction from server-side references

web/server/pactledger/
  Account, Budget, Reservation, Policy, Approval
  PaymentOperation, Idempotency, Settlement, Recovery, Receipt

web/server/a2a/
  Generic A2A transport, auth, task/message/artifact persistence

web/server/poolmate/a2a/
  PoolMate profiles and Shopping/Merchant/Payment application gateways

web/server/adapters/
  Generic settlement provider adapters
```

PoolMate 可以知道 PactLedger API；PactLedger 不能反向 import PoolMate 类型或出现 PoolMate 分支。

### 7.2 PoolMate 业务状态机

```text
DRAFT
  -> COLLECTING
  -> QUOTE_PENDING
  -> CONFIRMATION_PENDING
  -> READY_FOR_PAYMENT
  -> PAYMENT_PROCESSING
  -> PAID
  -> FULFILLING
  -> COMPLETED

Any non-terminal state
  -> CANCELLED | EXPIRED | FAILED
```

不得使用 `FUNDED` 表示份额满员。只有所有对应资金已真实预留时才可使用 funding 语义。

### 7.3 付款前置条件

Payment Application Service 必须在一个可重复执行的事务内重载并校验：

1. Order 处于 `READY_FOR_PAYMENT`。
2. Checkout ID/version/hash 一致且未过期。
3. Checkout 金额恒等式成立。
4. Allocation 总额精确等于 Checkout 总额。
5. 每名有效参与人都确认同一 Checkout hash/version 和本人 Allocation。
6. ConfirmationSet 已锁定且未撤销。
7. 所需资金已真实预留，或明确使用“赞助 Testnet Treasury”模式。
8. Merchant Directory 解析到唯一、已验证的 payee account。
9. 由上述引用构造 canonical request hash 和 idempotency key。

任一条失败，Settlement Adapter 调用次数必须为 0。

### 7.4 公开 Demo 的正确做法

公开 Trace Lab 可以保留，但必须：

- 使用独立内存 Repository 或独立 database schema/namespace；
- 不能写入生产 Intent/Decision/Receipt 表；
- 不允许调用方提供可与生产冲突的 ID；
- 永远使用 Mock Adapter；
- 有限流和资源上限；
- UI/API 返回 `evidenceLevel: demo_only`，不纳入 Base Status 真实证据。

## 8. 分阶段重建计划

### 阶段 0：停止错误声明并隔离演示数据

1. 把 PRODUCT_SPEC、Injective 交接、Base Status 和 UI 中对基座、PoolMate、A2A、AP2 的完成声明改为未实现。
2. 移除 PoolMate `protocol: 'ap2'` 和 AP2 已接入的显示含义。
3. 隔离匿名 Demo Repository，停止写入生产支付表。
4. 修正 Bot Status 路径和“自动退差”等与产品定义相反的文案。
5. 修复 lint/build，但不将质量门通过解释为支付完成。

验收：产品不再误报能力；匿名请求不能影响任何真实账本或证据状态。

### 阶段 1：拆除业务污染和第二套账本

1. 将 `PactLedgerAppId` 改为不透明注册 ID，删除基座业务 union。
2. 删除 `pactledger/policies.ts` 中两个业务对象，建立 tenant-scoped Policy Registry。
3. 将 Injective payee 配置改为通用 Asset/Payee Directory，Adapter 不再识别业务 ID。
4. 删除 `TreasuryService.AGENT_PLANS` 与绕过 PactLedger 的 `record*Payment()`。
5. 为 KaleidoX 和 PoolMate 分别创建应用层 provisioning/intent factory，只调用通用 API。

验收：`rg` 扫描 PactLedger core、Settlement Adapter 和通用配置不再出现 PoolMate、KaleidoX、Telegram、股票、`merchant-demo`、`risk`、`execution` 业务分支。新增第三个 test application 不修改核心源码即可 provisioning。

### 阶段 2：建立真正的 Account / Policy / Payment Operation

1. 使用 `assetId + amountAtomic` 重建 Money 类型。
2. 建立 Account、LedgerEntry、BudgetPeriod、Reservation 和会计恒等式。
3. Policy 读取真实 available/reserved/spent，在同一 DB 事务原子预留。
4. 建立带 principal、scope、requestHash、nonce、expiry 的 ApprovalEvidence。
5. 建立 tenant-scoped idempotency key、canonical hash 和 DB execution lease。
6. 建立 PaymentOperation / SettlementAttempt / Receipt，分开业务状态和 provider 状态。
7. 建立 unknown/reconcile 路径，按 tx hash 或 memo 恢复。

验收：在两个 Service 实例上并发提交同一请求只有一次 Adapter 调用；同 key 不同 hash 稳定冲突；失败/未知/成功后账户恒等式始终成立。

### 阶段 3：完成 PoolMate-native Human Present

1. 将份额满员状态改为 `QUOTE_PENDING`，不付款。
2. 实现 Merchant Directory 和 immutable Checkout Snapshot/version/hash/expiry。
3. 使用原子金额实现 Allocation，保证总额恒等。
4. 实现一次性 confirmation token、独立确认页、身份绑定和服务端再校验。
5. 锁定 ConfirmationSet，Checkout 变更必须生成新版本并作废旧确认。
6. 确定并实现成员出资模型。黑客松可先用赞助 Testnet Treasury，但不计入产品出资完成度。
7. Payment Application 只用服务端引用构造 Intent，调用唯一 PactLedger Service。

验收：少一个有效确认、少一笔资金预留、Checkout 过期或任一 hash 不一致时，Adapter 调用次数为 0。商户付款成功不会自动伪造成员已扣款。

### 阶段 4：建立 A2A v1 通用传输层并接入 PoolMate

本阶段依赖阶段 3 的 PoolMate-native 付款前置，但不阻塞 KaleidoX Testnet canary；同进程服务调用不计为 A2A 实现。

1. 锁定 A2A v1.0.1 SDK/schema。
2. 在 `web/server/a2a/` 建立与业务无关的 transport、auth、persistence、idempotency 和 error mapping。
3. 为 caller principal 绑定 tenant、skill/profile scope 和 Task owner。
4. 在 `web/server/poolmate/a2a/` 定义 Shopping、Merchant、Payment Profile 和应用网关。
5. Merchant A2A Task 返回 immutable Checkout Artifact。
6. Payment A2A Task 只接收 order/checkout/confirmation/idempotency 引用。
7. 持久化 Task、Message、Artifact、status history、request/response hash 和 business operation reference。
8. 将 A2A Task terminal state 与 payment terminal state 分开。

验收：Agent Card 与消息通过官方 v1 schema/SDK；caller 不能查询他人 Task；相同请求重放返回原 Task/Artifact；A2A 任何路径都不能越过 PactLedger。

### 阶段 5：完成一笔可恢复的 Injective Testnet 证据

本阶段不依赖阶段 4。在通用资金内核、Settlement 恢复和 KaleidoX 单一资金链验收后，可与 PoolMate/A2A 分支并行执行。

1. 通过 Asset Registry 配置资产，通过 Payee Directory 配置 KaleidoX 服务 payee，不增加业务环境变量。
2. 先使用极小金额 Testnet Treasury 完成一笔 KaleidoX Agent 服务费；PoolMate Testnet 付款必须另外等待阶段 3。
3. 保存 Intent、request hash、Decision、Approval reference、Reservation、Attempt、tx hash、Explorer 和 Receipt。
4. 在广播成功、Receipt 落库前中断进程，启动后查询原交易并恢复 confirmed，Adapter 不得再次广播。

验收：Explorer 可打开、tx 可查、Receipt 已持久化且重启后可恢复。该证据只证明 KaleidoX Testnet Treasury 服务费结算，不证明 PoolMate 付款或成员真实出资。

### 阶段 6：接入 AP2 v0.2.0 授权适配器

本阶段同时等待阶段 4 和阶段 5，永远最后进入。

1. 锁定 AP2 v0.2.0 规范 commit 和 schema。
2. 在 A2A Agent Card 声明对应 AP2 extension/profile。
3. 实现商户签名 Checkout JWT 与 trust anchor 验证。
4. Trusted Surface 使用确定性数据生成并签名闭合 Mandate。
5. 实现 Credential Provider/MPP 测试端或明确外部 Provider Adapter。
6. 验证 `vct`、issuer、subject、audience、expiry、nonce、key ID、撤销、Checkout hash、payee、amount 和 instrument。
7. 持久化原始签名对象、验证结果和签名 Receipt。
8. 明确 Treasury 单一 payer principal 与 PoolMate 多成员 evidence 的区别。

验收：签名、信任链、Mandate 绑定和 Receipt 均经过正反例互操作测试。只有验证成功的 Operation 可显示 `AP2 Verified`。

## 9. 必补验收测试

### 9.1 通用基座

- 第三个 application 只通过 provisioning 接入，核心无代码修改。
- 相同 idempotency key/相同 hash 返回同一 Operation。
- 相同 key/不同 payer、payee、asset、amount、purpose 或 authorization ref 返回 `IDEMPOTENCY_CONFLICT`。
- 两个 Service 实例、两个数据库连接并发只广播一次。
- tenant A 不能读取、重放或抢占 tenant B 的 Operation。
- 并发付款不得超过 available balance/budget。
- confirmed 结转 reserved -> spent；failed_final 释放；unknown 继续预留。
- 未知 asset/currency、精度超限、denom 不匹配和未验证 payee 在 Adapter 调用前被拒绝。
- ApprovalEvidence 与 request hash、principal、scope 或 expiry 不匹配时拒绝。
- 广播后中断可查询原交易恢复，不重播。
- Demo 的任何请求都不能出现在生产账本和最新真实 Receipt 查询中。

### 9.2 PoolMate

- 最后一份被认领后只进入 `QUOTE_PENDING`，Adapter 调用 0 次。
- 无最终 Checkout、Checkout 过期或金额恒等式失败时不得确认或付款。
- Checkout 任一字段变更生成新 version/hash，旧确认全部作废。
- Allocation 使用原子单位，总额严格等于 Checkout 总额。
- confirmation token 过期、重放、串用户、串 Checkout 和串 version 均拒绝。
- 任一有效参与人未确认时 Adapter 调用 0 次。
- 最后一人并发确认只创建一个 Payment Operation。
- 未实现成员资金时，状态不得显示 `funded/paid`。
- 商户付款成功不会篡改成员 funding ledger。

### 9.3 A2A

- v1 Agent Card、Message、Task 和 Artifact 通过官方 schema/SDK。
- 不支持的 binding/profile/extension 返回稳定错误。
- caller 只能创建授权 skill 的 Task，且只能查自己的 Task。
- 相同 A2A idempotency key 和 request hash 返回原 Task/Artifact。
- Message 重放、push 重复、乱序和 timeout 均可恢复。
- Merchant Checkout Artifact 经 profile/schema 校验后才进入 PoolMate。
- Payment Task 中伪造 amount/payee 无法覆盖服务端事实。
- A2A Task completed 但 Payment unknown/failed 时，PoolMate 不得标记已付款。

### 9.4 AP2

- 未协商 extension/profile 的请求不能标记 AP2。
- 错误 `vct`、签名、issuer、audience、expiry、nonce、key ID 均拒绝。
- 非受信或已撤销 key 拒绝。
- Checkout JWT hash 与 Mandate 不一致时拒绝。
- Payment Mandate 的 payer、payee、amount、asset 或 instrument 不一致时拒绝。
- 无签名 Receipt 时不得标记 AP2 completed/verified。
- PoolMate 多参与人 confirmation evidence 不能冒充 Treasury payer 的 AP2 Payment Mandate。

## 10. 当前质量门与证据限制

本轮审计已经实际观察到：

| 检查 | 实际结果 | 能证明什么 |
|---|---|---|
| `npm ci` | 通过 | 依赖可安装 |
| API tests | `41/41` 通过 | 当前单元/内存 Mock 行为符合现有断言 |
| lint | 失败，9 项 | 当前不符合声明的质量基线 |
| build | 失败 | `KnowledgeBase.tsx` 缺少 `ArrowRight` 定义 |
| 真实 Injective Testnet | 无已确认交易 | 不能证明 Testnet 支付 |
| 公网 | 仍为旧 `kaleidox-api` | 不能证明新 Agent Card/Base Status 已上线 |

现有测试没有覆盖：

- 两个 PactLedger Service 实例的真实 PostgreSQL 并发；
- 同 ID 不同 payload/tenant 冲突；
- 真实账户和累计预算；
- 会计分录与 Settlement 的一致性；
- 广播后中断恢复；
- PoolMate Checkout/Allocation/Confirmation/funding；
- PoolMate A2A 和 A2A v1.0.1；
- AP2 schema、签名和互操作；
- 一笔真实 Testnet Receipt。

因此“测试通过”不能抵消上述架构问题。在错误模型上通过的测试，只会固化错误行为。

## 11. 需要删除、迁移与保留的现有代码

| 对象 | 处理 | 原因 |
|---|---|---|
| `PactLedgerAppId` / `AgentPaymentPurpose` 业务 union | 删除 | 改为注册型不透明 ID |
| `pactledger/policies.ts` 静态业务策略 | 删除 | 改为 tenant-scoped Policy Registry |
| `TreasuryService.AGENT_PLANS` 与 `record*Payment` | 删除/迁移 | 业务 provisioning 移到 KaleidoX，资金动作改走唯一基座 |
| Injective `risk/execution/poolmateMerchant` 配置 | 删除 | 改用通用 Payee/Asset Registry |
| `PactLedgerService.inFlight` | 可保留作为性能优化 | 不再承担正确性，正确性来自 DB lease/constraint |
| Repository JSON 持久化代码 | 可拆出素材 | 必须增加 tenant key、request hash、immutable payload 和状态约束 |
| Injective SDK broadcast 代码 | 可拆出素材 | 必须脱离业务 payee，加入资产目录、attempt 和 recovery |
| PoolMate Session/Member Repository | 可拆出素材 | 保留认领并发思路，替换虚假 `funded/paid` 状态 |
| PoolMate 固定 Checkout Intent | 删除 | 改为从服务端 Checkout/Confirmation/Funding refs 构造 |
| 当前 KaleidoX `a2a.ts` | 移到 KaleidoX 应用层 | 不能继续占用通用 A2A 模块名义 |
| PoolMate `protocol: ap2` | 立即移除 | 无任何 AP2 验证证据 |

## 12. 最终声明门槛

### 可以声明“通用支付基座已实现”之前

必须同时满足：

- 基座核心无任何 PoolMate/KaleidoX 业务分支；
- 第三个 application 可仅通过 provisioning 接入；
- 账户、预算、预留、分录、Settlement 和 Receipt 共享一个 Payment Operation；
- 跨实例幂等、冲突检测和中断恢复通过 PostgreSQL 验收；
- Mock/Testnet/Live 在类型、表、API 和证据级别上无混淆。

### 可以声明“PoolMate 正常使用支付基座”之前

必须同时满足：

- Intent 只从已持久化的 Checkout、Allocation、ConfirmationSet、Funding Reservation 构造；
- 成员资金来源真实、可核对，或清晰标记为赞助 Testnet Demo；
- 任一前置不成立时结算调用为 0；
- 付款成功与成员出资状态分别由对应账本证据驱动；
- 不再存在固定 Demo 商户、CNY-DEMO 错误映射和全员伪 `paid`。

### 可以声明“PoolMate 已使用 A2A”之前

必须同时满足：

- Shopping/Merchant/Payment Agent Card 和 Skill/Profile 可验证；
- 至少一条 Merchant Checkout Task 和 Payment Task 走真实 A2A transport；
- Task/Message/Artifact/caller/owner/hash 已持久化；
- v1 schema、鉴权 scope、幂等、timeout 和错误路径通过验收；
- A2A 不能覆盖服务端资金事实或越过 PactLedger。

### 可以声明“PoolMate AP2 Verified”之前

必须同时满足：

- AP2 extension/profile 已协商且版本/schema 已锁定；
- Checkout JWT、Checkout Mandate、Payment Mandate 均有可验证签名；
- Trusted Surface、Credential Provider、Merchant/MPP 验证链完整；
- Mandate 与 Checkout、payer、payee、amount、asset、instrument 和 Receipt 绑定；
- 签名 Receipt 与 verification result 已持久化；
- PoolMate 多参与人 evidence 和 AP2 payer principal 的关系被准确表述。

在上述门槛前，对外最准确的说法是：

> 当前仓库包含支付对象、Mock Trace、Injective SDK 调用、Telegram 会话和 KaleidoX A2A 的实验代码，但通用支付基座、PoolMate 支付闭环、PoolMate A2A、A2A v1.0.1 和 AP2 v0.2.0 均未实现。

## 13. 提交来源备注

与此次审计相关的主要代码来源为：

- PactLedger domain、静态 Policy、Repository、Service、A2A 和 PoolMate Demo 主要在 `ca13473ebd18d72badfd04a3893f855b35ecc916` 提交，时间为 2026-07-24 11:09:47 +0800，提交说明 `feat: ship PactLedger competition runtime`。
- 当前 `web/server/poolmate/` Telegram 代码在 `340b188de1072a8b6e43c84690b0a447538796a0` 提交，时间为 2026-07-24 18:04:29 +0800，提交说明 `feat: consolidate backend and migrate PoolMate Telegram`。

提交时间只用于定位问题来源，不影响严格完成度判定。

## 14. 参考资料

- [PactLedger 产品说明](../../docs/PRODUCT_SPEC.md)
- [Injective Agent 支付交接](../../docs/INJECTIVE_AGENT_PAYMENT_HANDOFF.md)
- [PoolMate 产品定义](./PoolMate_产品定义.md)
- [PoolMate 实施方案](./PoolMate_实施方案.md)
- [PoolMate 补救方案](./PoolMate_补救方案.md)
- [PoolMate 具体用户流程](./PoolMate_具体用户流程.md)
- [A2A v1.0.1 Release](https://github.com/a2aproject/A2A/releases/tag/v1.0.1)
- [A2A v1 Migration Notes](https://github.com/a2aproject/A2A/blob/v1.0.1/docs/whats-new-v1.md)
- [AP2 v0.2.0 Changelog](https://github.com/google-agentic-commerce/AP2/blob/main/CHANGELOG.md)
- [AP2 Specification](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md)
- [AP2 Human Present Flow](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/flows.md#human-present)
