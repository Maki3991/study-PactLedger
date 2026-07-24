# PoolMate 补救方案

> 目的：将当前不可信的支付原型改造为可被 PoolMate 正确使用的通用资金基座。
> 依据：[`PoolMate_支付基座_A2A_AP2_审计与实施方案.md`](./PoolMate_支付基座_A2A_AP2_审计与实施方案.md)
> 方案状态：**待执行**（2026-07-25）。除文档事实更正外，PR-0 至 PR-9 均未实现；本文出现的类型、表和流程不得被当作已有能力。
> 边界：本方案只规定补救顺序、代码落点、迁移和验收门；所有实现继续进入 `web/server/`，不新建第二套后端。

## 1. 补救目标

补救完成后，必须同时成立：

1. PactLedger 核心不知道 PoolMate、KaleidoX、Telegram、股票、拼单或固定商户。
2. 任何资金动作都只有一个 `PaymentOperation`、一套会计分录和一组 Settlement Attempts。
3. Policy 基于真实账户、预留、累计消费和租户配置决策。
4. 跨实例并发、进程中断、网络超时和请求重放不会重复付款。
5. PoolMate 只有在最终 Checkout、精确 Allocation、逐人确认和资金预留都成立后才能请求付款。
6. A2A 只承担外层协作；AP2 只承担可验证授权；二者都不能改变资金事实。
7. Demo、Mock、Testnet 和未来 Live 在存储、类型、API 和 UI 上明确隔离。

## 2. 补救策略

采用“止损 -> 新内核旁路建设 -> 应用迁移 -> 受控切换 -> 删除旧路径”，不在当前表和当前 Service 上继续打补丁。

### 2.1 保留什么

- Fastify 唯一后端入口；
- PostgreSQL 基础设施；
- grammY 接入和 PoolMate Session/Member 的非资金代码；
- Injective SDK 构造、地址校验和广播调用素材；
- KaleidoX 任务和 PoolMate 界面中与支付无关的展示素材。

### 2.2 不保留什么

- `PactLedgerAppId = 'kaleidox' | 'poolmate'`；
- 基座内的业务 purpose union 和静态策略对象；
- `TreasuryService.AGENT_PLANS` 和四个 `record*Payment()`；
- `risk/execution/poolmateMerchant` 专用 Injective 配置；
- 全局 intent ID 幂等、进程 Map 正确性和可覆盖 JSON payload；
- `funded` 表示份额满员、商户付款后全员自动 `paid`；
- PoolMate `protocol: 'ap2'`；
- 匿名 Demo 与生产支付共用 Repository。

### 2.3 旧数据处理原则

当前支付相关数据不能直接迁移为新账户余额或新 Receipt：

- `treasury_accounts` 来自 KaleidoX 静态分配，不是通用资金来源；
- `treasury_transactions` 存在绕过 Policy/Settlement 的 completed 记录；
- `pactledger_payment_intents` 可被同 ID 覆盖且无 request hash；
- `settlement_receipts` 混合 Demo Mock 和生产命名空间；
- 仓库没有真实已确认 Testnet Receipt 需要保全迁移。

处理方式：

1. 对旧表做一次只读导出，记录 commit、导出时间、表行数和导出文件 SHA-256。
2. 在独立 snapshot manifest 中将旧数据集标记为 `legacy_untrusted`；不改写旧行，不把旧数据复制进新账本。
3. 新账户只能通过显式 provisioning 和 opening ledger entry 建立余额。
4. 新 Receipt 只能来自新 Payment Operation 的 Settlement Attempt。
5. PR-0 开始即在应用层停止写旧表，并用数据库权限/触发器拒绝运行账号的 `INSERT/UPDATE/DELETE`，不依赖“已经没有调用方”。
6. 经一个发布观察期后再单独审批删除旧表；本方案不自动删数据。

## 3. 立即止损包

这一包不实现新支付，只负责防止错误继续扩大。

### R0-1：关闭真实广播可能性

修改：

- `web/server/app.ts`：在新资金内核验收前不装配 Testnet Adapter；
- `web/server/config/injective.ts`：增加独立服务端 broadcast kill switch，默认关闭；
- `/api/public/base-status`：显示 `paymentCore=blocked_for_remediation`，不显示 ready。

验收：即使环境中误配私钥和 `mode=testnet`，也不会调用广播。

### R0-2：停止 PoolMate 伪付款

修改：

- `web/server/poolmate/telegram.ts`：份额满员后停止自动调用 `checkoutSession()`；
- `web/server/poolmate/repository.ts`：用 `filled` 或 `quote_pending` 替代虚假 `funded`；
- `web/server/poolmate/repository.ts`：删除商户 Receipt 成功后全员自动 `paid`；
- `web/server/poolmate/service.ts`：移除固定 `merchant-demo / CNY-DEMO / protocol=ap2` Intent；
- `web/src/poolmate/`：只显示认领完成，不显示已出资或已付款。

验收：任何 Telegram 认领操作的 Settlement Adapter 调用数都为 0。

### R0-3：隔离 Demo

修改：

- `web/server/app.ts`：`/api/demo/poolmate/checkout` 使用独立内存 Repository 和独立 Mock Service；
- 禁止调用方传入 intent ID，ID 由 Demo Service 生成并使用 `DEMO-` namespace；
- Demo 返回 `evidenceLevel: 'demo_only'`；
- 限制请求频率、请求体和每个来源的未完成操作数。

验收：Demo 请求前后，生产支付表行数和最新真实 Receipt 不变。

### R0-4：停止双账本继续增长

修改：

- `web/server/app.ts`：停止为新任务调用旧 `treasury.allocate()`，生产运行时不再装配旧 Treasury/PactLedger 为资金服务；
- `web/server/orchestrator.ts`：删除 `TreasuryService` 和旧 `PactLedgerService` 依赖，停止四个 `record*Payment()` 调用以及 `risk_review/execution` 两条旧 Payment Intent；
- `web/server/treasury.ts`：所有写方法 fail closed，不再对新任务生成资金分录；
- `web/server/pactledger/service.ts`：旧 Service 的生产写入入口 fail closed，只允许独立 Demo 在内存 Repository 中运行；
- `web/server/migrations/0001_legacy_payment_read_only.sql`（新增）：对旧 Treasury/PactLedger 表建立运行时只读闸门；
- 界面如需保留 Agent 费用视觉效果，明确标记为“非资金运行时估算”，不写 Treasury 表。

验收：新 KaleidoX 任务完整运行但不写入旧 Treasury/PactLedger 表；直接使用运行时数据库账号写旧表也被拒绝。

### R0 总门

以下项全部成立才允许开始新内核：

- 真实广播有默认关闭的独立 kill switch；
- PoolMate 份额满员不触发付款；
- Demo 不写生产表；
- 旧 Treasury 和旧 PactLedger 不再生成新资金记录，数据库写入门也已关闭；
- lint/build/API tests 通过，并且新增上述止损回归测试。

## 4. 通用资金内核

### R1-1：重建领域契约

不继续扩展现有业务 union。目标契约至少包含：

```ts
interface PaymentRequest {
  tenantId: string
  applicationId: string
  idempotencyKey: string
  payerAccountId: string
  payeeId: string
  money: { assetId: string; amountAtomic: string }
  purposeCode: string
  authorizationEvidenceRef?: string
  sourceRef?: string
  expiresAt: string
}
```

`applicationId`、`purposeCode`、`payeeId` 是受注册表约束的不透明 ID，不是基座 TypeScript union。

Settlement Adapter 不再接收可伪造 `status='settling'` 的业务 Intent，而只接收核心内部生成的授权命令：

```ts
interface AuthorizedSettlementCommand {
  operationId: string
  attemptId: string
  payerAddress: string
  payeeAddress: string
  asset: { network: string; denom: string; decimals: number }
  amountAtomic: string
  memo: string
}
```

业务应用和 A2A 路由不能获得 Adapter 实例。

### R1-2：新建通用注册与账本表

使用新表，不原地重解释旧数据：

```text
pl_applications
pl_principals
pl_assets
pl_payees
pl_accounts
pl_ledger_entries
pl_budget_periods
pl_policy_sets
pl_policy_rules
pl_payment_requests
pl_approval_evidence
pl_reservations
pl_payment_operations
pl_settlement_attempts
pl_settlement_receipts
pl_outbox
```

关键数据库约束：

- `UNIQUE(tenant_id, idempotency_key)`；
- Payment Request payload 不可更新，只保存 canonical JSON 与 request hash；
- Account/Payee/Asset 全部 tenant-scoped 或显式 global-scoped；
- amount 只存原子单位整数字符串/NUMERIC；
- 一个 Payment Operation 同时只有一个 active Settlement Attempt；
- tx hash 在 provider/network 维度唯一；
- Receipt 必须引用 Operation 和 Attempt；
- Ledger Entry 为 append-only，错账通过 reversal entry 冲正，不原地修改。

### R1-3：单一事务内决策与预留

`submitPayment()` 的数据库事务顺序固定为：

1. 从已鉴权 caller 获取 tenant/application/principal，不信任 body 中的对应字段。
2. canonicalize request 并计算 request hash。
3. 插入或锁定 `(tenant_id, idempotency_key)`。
4. 同 key/不同 hash 返回 `IDEMPOTENCY_CONFLICT`。
5. 锁定 payer account、budget period、policy set、asset 和 payee。
6. 校验 authorization evidence 引用与请求 hash。
7. 运行 Policy，持久化不可变 Decision 和 checks。
8. approved 时原子创建 Reservation；approval required 时创建 Approval Request；拒绝时不预留。
9. 创建 Payment Operation 和 outbox event。
10. 提交数据库事务；不在持有数据库事务时调用外部网络。

### R1-4：真实审批证据

Approval 必须保存：

- approver principal；
- tenant/application/account scope；
- operation/request hash；
- amount/asset/payee 上限或精确值；
- nonce；
- issuedAt/expiresAt；
- approval method 和证据引用；
- revokedAt/revokedBy；
- 消费状态。

调用方不能再通过 `{ humanApproved: true }` 继续付款。

### R1 总门

- 第三个 test application 仅通过数据 provisioning 接入；
- 基座 core 无 PoolMate/KaleidoX/Telegram/股票/拼单业务分支；
- 并发支付不超过 available balance/budget；
- 同 key/不同 hash 稳定冲突；
- 所有拒绝用例 Adapter 调用数为 0；
- Approval 的身份、hash、过期、撤销和重放测试通过。

## 5. Settlement 幂等和恢复

### R2-1：数据库执行租约

Worker 只能通过 PostgreSQL 原子抢占 Operation，租约包含 `owner_id / lease_until / attempt_no`。进程内 `Map` 可保留作为性能优化，但不参与正确性。

必测：

- 两个 Service 实例和两个 DB 连接并发抢占；
- worker 抢占后崩溃，租约过期后可恢复；
- 已有 active attempt 不得创建新 attempt；
- 已 confirmed/failed_final 的 Operation 不得再抢占。

### R2-2：区分广播与确认

状态至少包含：

```text
reserved
  -> settlement_queued
  -> broadcasting
  -> submitted
  -> confirmation_pending
  -> confirmed
  -> failed_final
  -> unknown -> reconciling -> confirmed | failed_final
```

要求：

- 广播前持久化 Attempt 与确定性 memo；
- SDK 返回 tx hash 后立即持久化，不等业务 Receipt；
- timeout、连接中断和进程消失都进入 unknown；
- unknown 保留 Reservation，不自动再广播；
- Reconciler 先按 tx hash，再按 memo/operation ID 查询；
- 只有链上明确不存在/明确拒绝且达到稳定终局后才进入 failed_final；
- confirmed 将 Reservation 结转为 spent；failed_final 释放 Reservation。

### R2-3：资产与 payee 解析

- Asset Registry 是 `assetId -> network/denom/decimals/enabled`的唯一映射；
- Payee Directory 是 `tenant/payeeId -> verified destination`的唯一映射；
- Adapter 不读取 business currency，只接收已解析 asset 和 atomic amount；
- unknown asset、disabled asset、精度不匹配、payee 未验证全部在建立 Attempt 前拒绝。

### R2 总门

必须通过真实 PostgreSQL 集成和故障注入：

- 两个实例并发只调用一次 Adapter；
- 广播前、广播后未得 hash、得到 hash 未落 Receipt、Receipt 落库失败四个中断点都可恢复；
- unknown 不重播；
- 账户预留与 spent 始终平衡；
- 同一 provider/network tx hash 不能属于两个 Operation。

## 6. 迁移 KaleidoX

KaleidoX 的资金路径必须先于 PoolMate 付款切换，用来验证新核心对第一个业务也不需要特例。PoolMate 的“不付款业务链”可在新核心契约稳定后并行开发，但不得先切换付款。

### R3-1：价格与账户由应用层 provisioning

- KaleidoX 定义 Agent 账户、服务价格、purpose 和 payee，但只通过注册 API/数据创建；
- 价格必须只选择一个 asset/amount，不再同时记 15 USDT 和 0.0005 INJ；
- 演示价格不得写入基座源码；
- 没有真实资金时只显示非资金估算，不写 completed Payment。

### R3-2：编排器只提交支付请求

`web/server/orchestrator.ts` 不再 import `TreasuryService`，不能获得 Settlement Adapter。它只能：

1. 创建应用业务事件；
2. 通过 KaleidoX payment factory 构造 PaymentRequest；
3. 提交给 PactLedger；
4. 根据 Payment Operation 状态更新业务投影。

### R3 总门

- `web/server/orchestrator.ts` 不存在直接资金更新；
- 研究、回测、风控和执行费如属资金，全部经过新核心；
- 每笔服务只有一个 asset/amount/Operation；
- 一个真实通过用例和一个真实 Policy 拒绝用例通过；
- 任何支付失败都不会留下另一套 completed Treasury 记录。

## 7. 迁移 PoolMate

### R4-1：先完成不付款的业务链

```text
DRAFT
  -> COLLECTING
  -> QUOTE_PENDING
  -> CONFIRMATION_PENDING
  -> READY_FOR_PAYMENT
```

必须先实现：

- Merchant Directory；
- immutable Checkout Snapshot；
- Checkout version/hash/expiry；
- 商品、运费、折扣、税费和总额恒等式；
- `assetId + amountAtomic` Allocation；
- 参与人和 Allocation 一一对应；
- 一次性 confirmation token；
- 独立确认页和用户身份再校验；
- UserConfirmationEvidence；
- immutable ConfirmationSet；
- Checkout 改动后旧确认自动失效。

在 `READY_FOR_PAYMENT` 之前不创建 PaymentRequest。

### R4-2：明确出资模式

同一代码支持两种明确区分的模式：

#### `sponsored_testnet_demo`

- 付款账户是主办方/Testnet Treasury；
- 成员确认是购买意向证据，不是成员扣款证据；
- 成员状态只能显示 `confirmed`，不能显示 `paid`；
- UI 必须显示“Testnet 赞助演示，参与人未实际扣款”；
- 该模式不计入 PoolMate 真实出资完成度。

#### `prefunded_participant_accounts`

- 每名成员有通用基座账户和可验证 opening/funding entry；
- 用户确认后原子预留本人 Allocation；
- 全员预留成功后才锁定 ConfirmationSet；
- 商户付款确认后，成员 Reservation 结转为 spent；
- 明确失败时释放；unknown 时保留；
- 托管、合规、退款与争议必须在进入生产前另行评审。

不允许存在未标明的第三种“成员没扣款但显示已付”模式。

### R4-3：付款请求只由服务端重建

PoolMate Payment Application 接收的是引用，不是可信金额：

```ts
interface ExecutePoolMatePayment {
  orderId: string
  checkoutId: string
  checkoutVersion: number
  confirmationSetId: string
  fundingReservationSetId: string
}
```

服务端重载全部对象，校验后生成 PaymentRequest。用户、Telegram、A2A payload 和 LLM 均不能直接提交最终 amount/payee/address。

### R4 总门

- 少一个有效确认时 Adapter 调用 0 次；
- 少一笔资金预留时 Adapter 调用 0 次；
- Checkout 过期、hash/version 不匹配、Allocation 不平时 Adapter 调用 0 次；
- 最后一人并发确认只创建一个 Payment Operation；
- 商户付款不能伪造成员 funding 记录；
- sponsored 和 prefunded 在类型、数据、API 和 UI 中不可混淆；
- PoolMate 通过新基座的真实通过用例和真实拒绝用例均通过。

## 8. A2A 补救

### R5-1：不再把 KaleidoX parser 当作 A2A 基座

目标目录：

```text
web/server/a2a/
  protocol/       A2A v1 transport, schema, media type, error mapping
  auth/           caller principal, tenant, skill/profile scope
  repository/     context, task, message, artifact, status history
  idempotency/    request hash and replay

web/server/kaleidox/a2a/
  stock research profile and parser

web/server/poolmate/a2a/
  shopping and merchant profiles/gateways

web/server/pactledger/a2a/
  generic authorized-payment skill
```

`web/server/a2a.ts` 当前的股票 parser、KaleidoX metadata 和 Artifact 迁移到 KaleidoX 应用层。

### R5-2：不为了“有 A2A”伪造内部调用

- 同一进程中的 PoolMate 和 PactLedger 使用直接 Application Service 调用；
- 只有真正跨 Agent/跨服务边界才使用 A2A；
- 如比赛需要展示 A2A，至少一条 Merchant Checkout 或 Payment Task 必须真正经过 v1 transport、鉴权、持久化和恢复；
- 如只调用同进程 Service，就明确声明“尚未使用 A2A”。

### R5-3：Payment Agent 保持通用

Payment Agent Card/Skill 只描述通用能力，例如 `submit_authorized_payment`、`get_payment_operation`，不出现 PoolMate 商品、份额和 Telegram 语义。

PoolMate Profile 在应用层将 Checkout/Confirmation/Funding 引用转换为已签名或受信的通用 PaymentRequest。Payment Agent 仍需自己执行鉴权、request hash、Policy、Reservation 和 Settlement，不信任 A2A Task 的 completed 状态。

### R5 总门

- Agent Card、Message、Task 和 Artifact 通过锁定的 A2A v1 schema/SDK；
- caller 绑定 principal/tenant/skill scope；
- Task 有 owner，不能跨 caller 查询；
- 同 request hash/idempotency key 返回原 Task/Artifact；
- Message 重放、push 重复、乱序、timeout 可恢复；
- A2A Task completed 不会自动把 Payment 标记 confirmed；
- Payment Agent core 无 PoolMate/KaleidoX 业务分支。

## 9. Testnet 受控切换

### R6-1：开启前置

第一笔 KaleidoX Testnet canary 只在 R0、R1、R2 和 R3 全部通过后才能申请开启 broadcast。PoolMate 业务链 R4 和 A2A R5 不是该 canary 的前置，但 PoolMate Testnet 付款必须额外通过 R4；A2A 路径发起的付款必须额外通过 R5。

开启前必须有：

- 独立 Testnet tenant/application/account；
- 极小单笔上限和期间上限；
- 唯一允许 asset；
- 唯一允许 payee；
- 可操作 kill switch；
- 一个实例的 canary worker；
- Reconciler 已运行；
- 广播前人工核对 request hash、asset、amount 和 payee；
- 数据库备份和回滚方案。

### R6-2：切换顺序

1. 新内核 + Mock Adapter，跑全部资金/并发/故障测试。
2. Testnet Adapter 使用假 broadcast dependency 跑合约测试。
3. 只读 shadow evaluation：新内核计算 Decision，不创建 Reservation、不广播。
4. 开启单一 canary account 的极小金额 Testnet 付款。
5. 主动在广播后、Receipt 前终止进程，验证重启恢复。
6. 重放同请求，验证返回原 Operation/Receipt。
7. 使用同 key 修改 amount/payee，验证冲突且无广播。
8. 保存 Explorer、Operation、Attempt、Receipt、Ledger Entries 和恢复日志。

### R6-3：回滚

发现以下任一情况立即关闭 broadcast kill switch：

- 出现两个 active attempts；
- 账户恒等式不平；
- tx hash 无法归属唯一 Operation；
- unknown 状态自动重播；
- currency/asset/payee 映射不明确；
- Demo 记录进入生产表；
- Explorer 与 Receipt 不一致。

回滚只停止新广播，不删除 Operation/Attempt/Receipt。已经 unknown/submitted 的 Attempt 继续由 Reconciler 处理。

## 10. AP2 后置处理

AP2 不在补救主路径中，不阻塞通用资金内核、PoolMate-native Human Present 和 Testnet 证据。

### R7-1：先提供通用 Verifier 接口

```ts
interface AuthorizationVerifier {
  scheme: string
  verify(input: AuthorizationEvidence): Promise<VerifiedAuthorizationGrant>
}
```

新内核先实现 `pactledger-native` Verifier。AP2 以独立 Adapter 实现该接口，不向 Payment Core 添加 PoolMate 条件分支。

### R7-2：只有完整验证后才启用 `ap2`

必须同时完成：

- 锁定 AP2 v0.2.0 schema/commit；
- A2A extension/profile 协商；
- merchant-signed Checkout JWT；
- Checkout Mandate 和 Payment Mandate；
- Trusted Surface 签名；
- Credential Provider/MPP 验证；
- `vct`、issuer、audience、nonce、expiry、key ID、trust anchor、撤销校验；
- Checkout hash、payer、payee、amount、asset、instrument 绑定；
- 签名 Checkout/Payment Receipt；
- verification result 持久化；
- 正反例互操作测试。

在此之前，类型、API、数据和 UI 均不允许显示 `AP2 Verified`。

## 11. 交付拆分

每个变更包必须独立可验收、可回滚，不将所有补救合并成一次大改动。

| 变更包 | 范围 | 主要代码落点 | 进入条件 | 退出条件 |
|---|---|---|---|---|
| PR-0 止损 | 关广播、停伪付款、隔离 Demo、锁死旧账本 | `web/server/app.ts`、`config/injective.ts`、`orchestrator.ts`、`treasury.ts`、`pactledger/service.ts`、`poolmate/{telegram,repository,service}.ts`、`web/src/poolmate/`、`web/server/migrations/0001_legacy_payment_read_only.sql` | 立即 | R0 总门通过 |
| PR-1 契约与 schema | 通用 ID、Money、新表、数据库约束 | `web/src/domain/pactledger.ts`、`web/server/pactledger/{canonicalize,registry,repository}.ts`、`web/server/migrations/0002_pactledger_core.sql` | PR-0 | schema/contract tests 通过 |
| PR-2 Policy 与账户 | Account、Budget、Reservation、Approval、Decision | `web/server/pactledger/{accounts,approval,policyEngine,service}.ts`及 PostgreSQL 集成测试 | PR-1 | R1 资金与审批门通过 |
| PR-3 Settlement | lease、Attempt、outbox、unknown、reconcile | `web/server/pactledger/{operations,worker,reconciler,repository}.ts`、`web/server/adapters/`及故障注入测试 | PR-2 | R2 故障注入门通过 |
| PR-4 KaleidoX 迁移 | 删除 Treasury 直连，单一资金链 | `web/server/kaleidox/payments.ts`（新增）、`web/server/orchestrator.ts`、`web/server/treasury.ts` | PR-3 | R3 总门通过 |
| PR-5 PoolMate 业务 | Checkout、Allocation、Confirmation、Funding | `web/server/poolmate/{types,repository,checkout,confirmation,funding,service}.ts`、`web/src/poolmate/` | PR-3 | R4 不付款前置门通过 |
| PR-6 PoolMate 付款 | 服务端重建请求、接入新核心 | `web/server/poolmate/payment.ts`（新增）、`web/server/poolmate/service.ts`、`web/server/app.ts` | PR-4/PR-5 | R4 总门通过 |
| PR-7 A2A v1 | 通用 transport/auth/repository + 应用 Profile | `web/server/a2a/`、`web/server/kaleidox/a2a/`、`web/server/poolmate/a2a/`、`web/server/pactledger/a2a/`；移除旧 `web/server/a2a.ts` 的通用名义 | PR-6 | R5 总门通过 |
| PR-8 Testnet | 受控 canary、中断恢复、证据包 | `web/server/adapters/injectiveTestnet.ts`、`web/server/config/injective.ts`、`web/server/pactledger/{worker,reconciler}.ts`及 Testnet 集成测试 | PR-3/PR-4 | R6 门通过 |
| PR-9 AP2 | 独立 Authorization Verifier | `web/server/pactledger/authorization/`、`web/server/ap2/`、`web/server/poolmate/a2a/`及 AP2 互操作测试 | PR-7/PR-8 | R7 全部互操作门通过 |

PR-4 和 PR-5 可在 PR-3 契约稳定后并行；PR-6 必须等待两者。PR-7 不阻塞 PR-8 的 KaleidoX Testnet 证据，但 A2A 发起的资金动作不得先于 PR-7 验收。PR-9 同时等待 PR-7 与 PR-8，AP2 永远最后。

## 12. 测试与证据要求

### 12.1 必须使用真实 PostgreSQL 的测试

- idempotency 冲突；
- 多实例 lease；
- Account/Reservation 并发；
- outbox 接管；
- Settlement Attempt 唯一性；
- 进程中断恢复；
- Ledger append-only 和 reversal；
- tenant/caller 隔离；
- Demo 与生产 schema 隔离。

内存 Repository 测试不能代替上述验收。

### 12.2 故障注入点

- Policy Decision 前/后崩溃；
- Reservation 写入后崩溃；
- outbox 提交前/后崩溃；
- Adapter 调用前崩溃；
- Adapter 已广播但客户端超时；
- tx hash 落库前/后崩溃；
- Receipt 落库失败；
- Ledger 结转前/后崩溃；
- Reconciler 重复运行；
- 同一 A2A Message 重放/乱序。

每个故障点都必须有“Adapter 调用次数、Operation 终态、Reservation 状态、Ledger 恒等式”四项断言。

### 12.3 发布证据包

每个金钱相关发布保存：

- commit SHA 与 migration version；
- lint/build/test 结果；
- 注册的 application/asset/payee/policy 脱敏快照；
- request canonical JSON 和 hash；
- Policy Decision 和 checks；
- Approval/Confirmation/Funding references；
- Reservation 和 Ledger Entries；
- Operation 和 Attempts；
- tx hash、block height、Explorer URL；
- Receipt JSON；
- 重放结果和故障恢复日志；
- Mock/Testnet/evidenceLevel 标识。

## 13. 完成定义

补救不以“所有 PR 已合并”结束，而以以下结果结束：

- [ ] 公开 Demo 不能读写生产支付数据。
- [ ] 旧 Treasury 和旧 PactLedger 不再接受新写入。
- [ ] 基座 core 不包含 PoolMate/KaleidoX 业务语义。
- [ ] 第三个 application 可仅通过 provisioning 接入。
- [ ] 账户、预算、预留、会计分录、Settlement 和 Receipt 共享一个 Payment Operation。
- [ ] 同 key/同 hash 可重放，同 key/不同 hash 冲突。
- [ ] 跨实例并发只广播一次。
- [ ] 广播后中断可恢复，unknown 不重播。
- [ ] KaleidoX 和 PoolMate 各有一个真实通过用例和一个真实拒绝用例。
- [ ] PoolMate 付款只能由最终 Checkout、Allocation、ConfirmationSet 和 Funding Reservation 触发。
- [ ] sponsored 模式不伪装成员已扣款。
- [ ] A2A 若被宣称已使用，必须有真实 v1 transport 和持久化 Task/Artifact 证据。
- [ ] AP2 在完整 Mandate/签名/Verifier/Receipt 前不出现已验证标记。
- [ ] lint、build、单元、真实 PostgreSQL 集成、故障注入和协议合约测试全部通过。

## 14. 立即执行顺序

下一个实现回合只做 PR-0，不同时开发 A2A、AP2 或真实 Testnet。

PR-0 通过后，按以下依赖推进：

```text
PR-1 契约/schema
  -> PR-2 Policy/账户
  -> PR-3 Settlement/恢复
      |-> PR-4 KaleidoX 迁移 -> PR-8 KaleidoX Testnet canary --|
      |                                                     |-> PR-9 AP2
      |-> PR-5 PoolMate 不付款业务链                            |
              + PR-4 -> PR-6 PoolMate 付款 -> PR-7 A2A v1 --------|
```

第一笔 Testnet canary 不需要伪造 A2A 前置；它验证的是通用资金内核、KaleidoX 单一资金链和 Settlement 恢复。PoolMate A2A 只在 PoolMate-native 付款闭环成立后接入。所有顺序都不得因为已有页面、路由、Mock Receipt 或 SDK 代码而跳过。
