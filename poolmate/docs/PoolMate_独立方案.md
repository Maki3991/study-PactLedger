# PoolMate 独立方案

> 状态：G0 / P0 / P1 / P2 / P4、本地 Mock Payment Base、安全关闭拼单和自然语言草稿已实现并完成本地验收；P3 远程联调等待支付基座发布稳定契约
> 边界：新 PoolMate 是独立后端、独立 Telegram Bot、独立管理面板和独立数据库，全部放在顶层 `poolmate/`。
> 约束：不修改 `web/` 中现有支付基座的代码和接口，不导入其内部 Service，不共享数据库。
> 验收时间：2026-07-25

## 1. 结论

重新建设 PoolMate，不迁移或继续扩展 `web/server/poolmate/` 中的旧实现。

新 PoolMate 自己完成群组、订单、最终报价、精确分摊、逐人确认和付款编排。`PaymentBaseClient` 是唯一支付边界：本地 Mock 实现负责可验证的模拟闭环，远程 HTTP 实现负责未来 Testnet/Live 联调；PoolMate 不知道 PactLedger 的 Repository、Policy Engine 或 Settlement Adapter。

真实 Testnet/Live 仍有一个必须承认的阻塞：

- 现有可复用接口是进程内 `PactLedgerService.process()`；
- 当前没有供独立后端调用的通用支付 HTTP/RPC 端点；
- `/api/demo/poolmate/checkout` 只接受固定演示场景并返回 Mock Trace，不得作为新 PoolMate 的支付接口。

本地 Mock 不再受该远程接口阻塞。`PAYMENT_SETTLEMENT_MODE=mock` 会走独立 `PaymentBaseClient`，依次持久化 operation、PolicyDecision 与 Mock Receipt，并将订单推进到 `DEMO_CONFIRMED`。它不移动资金，不提供交易哈希或 Explorer，也不能进入 `PAID`。Testnet/Live 在远端契约发布前仍必须显示 `PAYMENT_BASE_UNAVAILABLE`，不得伪造链上确认。

## 2. 目录与部署

```text
poolmate/
  backend/
    src/api/                 管理面板 API
    src/bot/                 Telegram Bot
    src/domain/              Order / Checkout / Confirmation
    src/application/         用例与状态机
    src/infrastructure/db/   PoolMate Repository
    src/infrastructure/payment/ PaymentBaseClient
    tests/
  frontend/
    src/                     独立管理面板
  shared/
    src/                     前后端共享 DTO
  migrations/               PoolMate 独立数据库迁移
  deploy/                    Docker / service / env 模板
  docs/
```

独立性要求：

- `poolmate/backend` 和 `poolmate/frontend` 分别可构建、测试和部署；
- PoolMate 使用独立数据库/数据库账号，不读写 PactLedger 表；
- Telegram Token、数据库密码和基座凭证只进入后端环境变量；
- 前端只访问 PoolMate Backend，不直连支付基座。

### 2.1 CodexClaw 导入基线

PoolMate Backend 以下列上游作为初始源码基线：

```text
repository = https://github.com/MackDing/CodexClaw.git
branch     = main
commit     = 263be7c8281e90bf6604a65a4f327f385df60279
target     = poolmate/backend
```

CodexClaw 只用于减少骨架、配置、Telegram 适配和工程化代码的重复建设。PoolMate 不依赖 Codex CLI、Codex SDK、PTY session、Codex 工作目录或 Codex Agent Runtime；导入后允许在保留可复用结构的前提下删除不属于产品的运行时模块。

导入是全项目的串行 Gate 0，只由工程师 A 操作：

1. 将固定 commit clone 到 `poolmate/backend/`，不覆盖已有 `poolmate/docs/`。
2. clone 完成后立即删除 `poolmate/backend/.git`，再进行任何删改或分支分工。
3. 保存上游 URL、commit 和导入时间到非 Markdown 的 provenance 文件。
4. 在原始代码上先运行 typecheck、lint 和 test，记录删改前基线。
5. 删除上游的 Codex CLI/SDK/PTY Runtime、嵌套 Agent 指令、GitHub 自动化、编码助手文档和 PoolMate 不需要的模块，但保留来源记录。
6. 建立一个可追踪的 vendor baseline，三名工程师只能从该基线开始并行。

Gate 0 验收：

- `find poolmate -type d -name .git` 无输出；
- 根仓库没有新增 submodule；
- `poolmate/docs/` 原文件未被覆盖；
- vendor baseline 可独立安装并通过导入前质量门。

GitHub 元数据当前未声明该上游的开源许可证。执行导入前，项目负责人必须确认团队拥有使用和分发该代码的权利。

### 2.2 Telegram Framework 基线

CodexClaw 上游使用 Telegraf，新 PoolMate 不继续使用 Telegraf。P0 必须完成到 [grammY](https://grammy.dev/) 的一次性迁移，之后才能开始写 PoolMate Telegram 业务 Handler。

目标目录：

```text
poolmate/backend/src/bot/
  botAdapter.ts             应用内部 Telegram 端口
  grammy/
    createBot.ts            grammY Bot 创建和启停
    context.ts              PoolMate Context 扩展
    middleware.ts           访问控制、幂等和错误处理
    keyboards.ts            InlineKeyboard 构造
    handlers/               grammY command/message/callback handlers
  formatter.ts              无框架的文本格式化
  i18n.ts                   无框架的文案选择
```

迁移范围：

1. 将 `telegraf` 直接依赖替换为 `grammy`，版本由 lockfile 固定。
2. `new Telegraf()` 替换为 grammY `Bot`，保留 Token 缺失时不启动的行为。
3. Telegraf `Markup` 替换为 grammY `InlineKeyboard`，callback data 继续使用后端定义的稳定格式。
4. Telegraf `Context` / `MiddlewareFn` 替换为 grammY 类型，但 grammY 类型只能出现在 `src/bot/grammy/` 内。
5. 保留 allowed user/chat 访问控制、代理配置、超时、限流、脱敏日志和统一错误处理。
6. Domain 和 Application Service 只依赖框架无关端口，不接收 grammY `Context` 或 Telegram Update 作为业务输入。
7. 旧 Telegraf 测试迁移为 grammY update fixture 测试，覆盖 command、message、callback query、重复 update 和 Bot API 失败。

grammY 迁移验收：

- `backend/package.json` 不再直接依赖 `telegraf`；
- `backend/src/` 不存在来自 `telegraf` 的 production import；
- grammY 类型不进入 Domain、Application、shared DTO 或数据库 schema；
- Bot 在 Token 缺失、Token 存在和 Telegram API 不可用三种状态下都可被健康检查如实表达；
- grammY 的 command、message、callback query 和访问控制测试通过。

### 2.3 自然语言草稿边界

自然语言能力是可选的订单草稿提取器，不是独立 Agent Runtime：

```text
Telegram 群消息明确 @mention Bot
  -> grammY Handler
  -> Responses-compatible HTTPS Adapter
  -> strict Structured Output
  -> Zod 校验
  -> 持久化 DRAFT
  -> 发起人点击 Confirm & publish
  -> 确定性 publishOrder()
```

约束：

- 默认 `POOLMATE_LLM_ENABLED=false`，命令流程始终可用；
- 启用时必须配置 HTTPS origin、服务端 API Key 和模型名；
- 模型只返回 `title`、`targetUnits`、`missingFields`、`ambiguousFields`；
- 缺失、歧义、拒绝、超时或 schema 不合法时不得创建订单；
- 模型不得产生商户、收款方、资产、金额、Checkout、确认、付款或订单状态；
- 草稿必须由订单发起人显式发布，丢弃草稿只进入持久化 `CANCELED`，不创建 Checkout、确认或付款。

## 3. PoolMate 自有领域

最少保存：

```text
pm_groups
pm_orders
pm_participants
pm_checkout_snapshots
pm_allocations
pm_user_confirmations
pm_confirmation_sets
pm_funding_evidence
pm_reservations
pm_payment_requests
pm_payment_projections
pm_outbox
```

业务主流程：

```text
DRAFT
  -> COLLECTING
  -> QUOTE_PENDING
  -> CONFIRMATION_PENDING
  -> READY_FOR_PAYMENT
  -> PAYMENT_SUBMITTED
  -> PAID | DEMO_CONFIRMED | PAYMENT_FAILED | PAYMENT_UNKNOWN
```

约束：

1. 份额满员只进入 `QUOTE_PENDING`，不付款。
2. Checkout 必须有版本、hash、过期时间和已验证商户。
3. Allocation 使用 `assetId + amountAtomic`，总额必须等于 Checkout 总额。
4. 每名参与人只能确认同一 Checkout 版本中本人的精确金额。
5. Checkout 改动后旧确认全部失效。
6. 最后一人并发确认只能生成一条 `pm_payment_requests`。
7. 只有当前部署允许的 Testnet/Live confirmed Receipt 才能将订单标记为 `PAID`；Mock 只能进入隔离的 `DEMO_CONFIRMED`。

资金模式必须显式选择：

- `sponsored_demo`：由演示 Treasury 付款；参与人只是 `confirmed`，不是已出资；
- `prefunded_participants`：每名参与人必须有可验证 funding entry 和对应 Reservation。

现有基座没有成员入金/预留接口，因此首期只能启用 `sponsored_demo`。`prefunded_participants` 保持不可用，不得用本地布尔状态伪造成员出资。

## 4. 支付兼容层

PoolMate 内部先产生精确且不受基座旧类型限制的请求：

```ts
interface PoolMatePaymentRequest {
  orderId: string
  checkoutId: string
  checkoutVersion: number
  checkoutHash: string
  confirmationSetId: string
  idempotencyKey: string
  payerRef: string
  payeeId: string
  money: { assetId: string; amountAtomic: string }
  expiresAt: string
}
```

`PaymentBaseClient` 负责将它映射到现有基座契约。所有旧字段只能出现在该层：

```text
appId        = poolmate
purpose      = merchant_pay
protocol     = internal
intentId     = 由 orderId + checkoutVersion 确定性生成
tenantId     = 服务端配置，不信任 Telegram/前端输入
payeeId      = 只来自 PoolMate Merchant Directory
amount       = 只在可无损转换时填入旧 number 字段
```

当前基座未改动时还有以下硬限制：

- PoolMate Policy 只允许 `merchant-demo` 和 `member-refund`；
- 单笔上限为 300，预算常量为 500；
- `amount: number` 不能作为 PoolMate 内部会计真相；
- 基座没有成员入金、预留或汇总账本；
- 基座不能证明跨实例只广播一次；
- `approval_required` 没有可供独立 PoolMate 继续的远程审批接口。

因此首期兼容层必须 fail closed：未知商户、超限金额、不可无损转换的资产、需审批或基座结果不确定时，都不得标记付款成功。

## 5. 分阶段交付

| 阶段 | 交付 | 验收 | 并行方式 |
|---|---|---|---|
| G0 导入基线 | 已完成 | 固定 CodexClaw commit、删除嵌套 `.git`、`upstream.json` 记录来源和原始质量门 | `1924790` |
| P0 独立骨架 | 已完成 | 独立 Fastify / SQLite / React / grammY，可在不启动 `web/` 时构建和运行 | `ad0659e` |
| P1 业务链 | 已完成 | Order、Checkout、Allocation、ConfirmationSet 稳定进入 `READY_FOR_PAYMENT` | `effc2ec` |
| P2 契约冻结 | 已完成 | 共享支付请求、projection、outbox、settlement mode 和错误契约 | `f8b9314` |
| P2 持久化编排 | 已完成 | 稳定 operation ID、单次 claim、lease、UNKNOWN 隔离、只读恢复和持久化 Receipt 门 | `e21ddf9` |
| P2 外部边界 | 已完成 | HTTPS PaymentBaseClient、服务端鉴权、超时/错误归一化、真实 Bot 文案和恢复定时器 | `82f9385` |
| P2 本地 Mock Base | 已完成 | Policy 白名单/资产/金额/有效期/幂等校验、追加写 operation/decision/receipt、重试与重启恢复、`DEMO_CONFIRMED` 证据隔离 | 当前阶段提交 |
| P3 基座联调 | 外部阻塞 | 仍无可从独立进程调用的稳定支付接口；未调用 Demo 端点、未修改 `web/`、未宣称真实付款 | 待基座发布契约 |
| P4 管理面板 | 已完成 | 展示订单、确认、payment projection、outbox、恢复入口和 Receipt 证据；Mock 证据边界由 `1b8f132` 加固 | `82f9385`、`1b8f132` |
| P5 安全关闭拼单 | 已完成 | Owner-only Telegram/API/UI 关闭、append-only cancellation evidence、确认失效、付款 claim 竞态和重启恢复 | `e7a43c5` |
| P6 自然语言草稿 | 已完成 | 移除 Codex CLI/SDK/PTY Runtime，grammY mention gate、直接 HTTPS Structured Output、`DRAFT -> Confirm & publish`、默认关闭配置 | `13ddaf5` |

P3 的进入条件是支付基座已经存在可从独立进程调用的稳定接口。本方案不通过修改 `web/`、共享数据库、导入基座源码或调用 Demo 端点创造该条件。

## 6. 验收门

- [x] 代码和运行配置全部位于 `poolmate/`。
- [x] PoolMate 不 import `web/` 内部模块，不读写其数据库表。
- [x] Backend（含 Bot）与 Frontend 可分别构建与部署。
- [x] Checkout 不完整、Allocation 不平或少一人确认时，PaymentBaseClient 调用数为 0。
- [x] 支付基座不可用时，订单保持 `READY_FOR_PAYMENT/PAYMENT_UNKNOWN`，不自动重复付款。
- [x] 相同 order/checkout version 只生成一个本地 Payment Request 和一个稳定幂等键。
- [x] 没有可接受的 Testnet/Live confirmed Receipt 时，Bot、API 和管理面板都不显示“已付款”。
- [x] Mock、Testnet 和真实成员出资在数据和 UI 中不混淆。
- [x] 首期不声明已使用 A2A 或 AP2。
- [x] 发起人可以在付款提交前安全关闭拼单，并留下持久化取消证据。
- [x] 自然语言只创建待确认草稿；LLM 关闭或不可用时命令流程不受影响。
- [x] PoolMate 生产依赖不包含 Codex CLI 或 Codex SDK。

### 6.1 2026-07-25 验收证据

- Backend CI：typecheck、lint、format、`114/114` tests、build 和空库 healthcheck 通过；production dependency audit 为 0 个 high/critical。
- Frontend：lint、typecheck、`31/31` tests 和 build 全部通过；shared typecheck/build 通过。
- Docker 从独立 volume 升级到 8 个 migration；Mock 模式在没有远程 URL/Key/path 时报告 `configured`，disabled 模式仍如实报告未配置。
- 真实浏览器检查覆盖桌面 `1440 x 900` 与移动 `390 x 844`：运行时页和管理员 gate 无横向溢出或控件重叠，浏览器控制台无 warning/error；未生成持久化截图文件。
- 静态边界检查无嵌套 `.git`、无 submodule、无 Telegraf production import、无 `web/` import；grammY 类型未进入 Domain、Application、shared DTO 或数据库 schema。
- Telegram user allowlist 由 `TELEGRAM_USER_ALLOWLIST_ENABLED` 显式控制，默认关闭；只有开启时空名单才会让 Bot fail closed。
- 自然语言草稿由 `POOLMATE_LLM_ENABLED` 显式控制，默认关闭；启用后使用直接 HTTPS Adapter，不启动 Codex CLI/SDK/PTY session。
- 本地 Mock API 集成测试证明只能返回 `DEMO_CONFIRMED`；Mock Receipt DTO 使用 `kind=mock`，不包含交易哈希或 Explorer 字段，管理页单独显示其 receipt ID 与记录时间。
- 未执行真实 Telegram 群聊、外部 HTTPS Mini App 或 Injective Testnet/Live 付款，这些不属于已完成证据。

## 7. 首个实现包：P0 三工程师版

P0 不接 A2A、AP2、Testnet，也不调用现有 Demo 支付端点。P0 不是从第一分钟就三路同时写代码，而是先完成两个短串行 Gate，再进入稳定的三路并行。

### 7.1 Gate 0：串行导入

由工程师 A 完成第 2.1 节的 CodexClaw 导入、`.git` 删除、原始质量门和 vendor baseline。在基线完成前，B/C 不在 `poolmate/backend/` 中写代码。

### 7.2 Gate 1：契约冻结

三人共同评审，由工程师 A 落地第一版共享契约：

- Backend health 响应；
- config status 脱敏响应；
- Bot `disabled/configured` 状态；
- 稳定错误结构和错误码；
- Frontend API base URL 和超时规则；
- P0 环境变量清单；
- 数据库连接和迁移状态表达。

契约写入 `poolmate/shared/`。并行窗口内不得单方修改；必须由 A 更新契约和版本，B/C 再同步。

### 7.3 Window 1：P0 三路并行

| 工程师 | 负责范围 | 主要输出 | 禁止越界 |
|---|---|---|---|
| A：Backend / Contract | `backend/src/api/`、`backend/src/domain/`、`backend/src/application/`、`backend/src/infrastructure/db/`、`shared/`、`migrations/` | Fastify 组装、health/config status、独立 DB、首个 migration、API 测试 | 不修改 Bot 文案和 Frontend |
| B：Bot / LLM Adapter | `backend/src/bot/`、`backend/src/infrastructure/llm/` 及对应测试 | CodexClaw 删改、Telegraf 到 grammY 迁移、`BotAdapter`、轻量 HTTP 草稿提取、Bot/LLM 状态 | 不修改 shared 契约、DB schema 和 API 路由 |
| C：Frontend / Delivery | `frontend/`、`deploy/`、前端与 E2E 测试 | 真实状态面板、错误/加载/空状态、Docker/service/env 模板 | 不制作演示付款数据，不直连基座或 DB |

Window 1 期间可以同时开工，因为三路只通过 Gate 1 冻结的 DTO 交互，不共同修改同一业务文件。

### 7.4 Gate 2：P0 汇合

合并顺序固定为：

```text
shared contract / backend skeleton
  -> runtime and bot
  -> frontend and deploy
  -> integrated verification
```

Gate 2 必须同时通过：

1. Backend 在不启动 `web/` 时可运行。
2. Bot 未配置 Token 时为 `disabled`，配置完整时为 `configured`，不回传 Token。
3. Frontend 只展示 Backend 真实响应，Backend 不可用时显示明确错误。
4. Backend、Frontend 分别通过 lint、typecheck、test 和 build。
5. migration 可在空数据库执行，重复执行不损坏现有状态。
6. Docker 验收通过，且无 `web/` import、无嵌套 `.git`、无前端秘密。
7. Telegram 运行时只使用 grammY，生产代码无 Telegraf import，业务代码无 grammY 类型泄漏。

## 8. P1-P2 三工程师并行方案

### 8.1 固定所有权

P0 之后继续使用相同所有权：

- A 是 Domain、Application Service、API contract、DB schema、migration 编号和 `shared/` 的唯一所有者。
- B 是 grammY Telegram Adapter、自然语言草稿 Adapter、Merchant/Payment 外部 Adapter 和 Bot 文案的唯一所有者。
- C 是 Frontend、浏览器 E2E、容器与部署模板的唯一所有者。
- `backend/package.json` 和后端锁文件只由 A 修改；B 如需依赖，提交明确的依赖需求由 A 统一落地。
- `frontend/package.json` 和前端锁文件只由 C 修改。

### 8.2 Window 2：P1 业务链并行

进入条件：Gate 2 通过，Order/Checkout/Confirmation DTO 已冻结。

| 工程师 | 并行任务 | 交付证据 |
|---|---|---|
| A | Order/Participant 状态机、份额锁定、不可变 Checkout、canonical hash、atomic Allocation、Confirmation Round/Set、事务与并发测试 | 从 `DRAFT` 稳定到 `READY_FOR_PAYMENT`；少一人确认时 payment request 为 0 |
| B | 基于 grammY 实现 Telegram 创建/发布/认领/修改/退出，Structured Output 只生成 Draft Patch，固定 Mock Merchant Adapter，确认链接私聊发送 | 重复 update/callback 幂等；LLM 无法修改金额、payee 或状态；grammY `Context` 不越过 Bot Adapter |
| C | Trusted Confirmation Surface、订单/Checkout/确认管理页、倒计时、过期/失效/拒绝状态 | 页面不接受金额和 payee 输入；服务端 canonical 数据是唯一事实源 |

P1 汇合 Gate：三名参与人可完成认领和逐人确认，最后一人并发确认只生成一个 `ConfirmationSet` 和一个稳定 payment request，订单停在 `READY_FOR_PAYMENT`。

### 8.3 Window 3：P2 支付边界并行

进入条件：P1 汇合 Gate 通过，`PoolMatePaymentRequest` 和 payment projection DTO 已冻结。

| 工程师 | 并行任务 | 交付证据 |
|---|---|---|
| A | Payment Request、outbox、稳定幂等键、projection 状态机、UNKNOWN 隔离、重启恢复 | 最后一人确认、Worker 重试和进程重启均不产生第二条付款请求 |
| B | `PaymentBaseClient` 边界、鉴权/超时/错误归一化、Bot 付款不可用/失败/未知文案 | 基座不可用、需审批、超限、资产无法无损转换时全部 fail closed |
| C | Payment/Audit/Outbox 管理页、失败恢复可视化、Mock/Testnet/Live 标识、端到端浏览器测试 | 没有可接受 Receipt 时绝不显示“已付款”；UI 不推测资金终态 |

P2 汇合 Gate：基座不可用时，订单保持 `READY_FOR_PAYMENT` 或受控进入 `PAYMENT_UNKNOWN`，本地请求不丢失、不自动换幂等键、不伪造 Receipt。

### 8.4 Window 4：三路验收

功能合并后再次三路并行，此时三人不再增加功能：

- A：状态机、事务、幂等、故障注入、migration 和重启恢复。
- B：grammY update fixture、三名 Telegram 测试用户、重复 callback、过期 Checkout、非白名单收款方和 Bot 文案真实性。
- C：桌面/移动端浏览器 E2E、可访问性、容器冷启动、秘密扫描和无 `web/` 依赖检查。

任一路失败都不得对外宣称完成 P2。

## 9. 并行开发规则

1. 三名工程师使用独立 worktree 和分支，从同一个 Gate baseline 开始；不在同一 worktree 相互覆盖。
2. 分支建议为 `codex/poolmate-domain`、`codex/poolmate-bot`、`codex/poolmate-web`；每个并行窗口结束后重新从最新 Gate baseline 切分支。
3. 每个任务在开始前必须写明输入契约、输出契约、所属目录、测试命令和阻塞条件。
4. 禁止在并行窗口中跨所有权“顺手重构”；跨目录变更必须先由对应所有者接受。
5. shared DTO、错误码、DB schema 和 migration 是合并前契约，不得以前端 mock、Bot 文案或外部 payload 反向改写业务事实。
6. migration 只能追加，编号由 A 预留；已进入共享 Gate baseline 的 migration 不得原地重写。
7. 合并前每路先跑自己的局部质量门；Gate 负责人再跑全量 lint、typecheck、test、build、migration smoke 和 Docker 验收。
8. P3 不因三人空闲而提前开始。没有稳定远程支付接口时，三路都不得通过共享 DB、导入 `web/` Service 或调用 Demo 端点绕过阻塞。
