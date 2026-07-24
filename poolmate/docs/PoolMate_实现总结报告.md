# PoolMate 实现总结报告

> 完成时间：2026-07-25
>
> 范围：`poolmate/` 独立参考应用 G0、P0、P1、P2、P4
>
> 结论：本地实现和验收完成；P3 真实支付基座联调等待稳定远端契约、真实配置与外部证据

## 1. 交付结论

PoolMate 已作为 PactLedger 的独立参考应用落在顶层 `poolmate/`，拥有独立 Backend、grammY Bot、Frontend、SQLite、migration 与 Docker 部署入口。它不 import `web/`，不共享 PactLedger 数据库，也不调用 `/api/demo/poolmate/checkout`。

当前系统可完成群和订单创建、份额认领、可信商户报价、不可变 Checkout、原子金额精确分摊、Telegram WebApp 逐人确认、唯一 Payment Request、durable outbox、支付状态投影和按原 operation ID 恢复。未配置支付基座时会 fail closed，不生成伪 Receipt，也不显示已付款。

P3 没有被人为“做通”。仓库当前没有供独立进程使用的稳定 PactLedger 支付 HTTP/RPC 契约，因此真实基座调用、Telegram 外部群聊和 Injective Testnet/Live Receipt 仍是外部交付项。

## 2. 阶段与提交

| 阶段 | Commit | 结果 |
|---|---|---|
| G0 | `1924790` | 导入 CodexClaw 固定 commit，删除嵌套 `.git`，保存 `upstream.json` |
| P0 | `ad0659e` | 独立 Fastify / SQLite / React 运行时，Telegraf 迁移到 grammY，Docker 和健康状态 |
| P1 | `effc2ec` | Order / Participant / Checkout / Allocation / Confirmation 可信业务链 |
| P2 契约 | `f8b9314` | 冻结 Payment Request、projection、outbox、错误码与 settlement mode |
| P2 durable core | `e21ddf9` | operation ID、lease、单次提交 claim、UNKNOWN 隔离、持久化恢复和 Receipt 门 |
| P2/P4 集成 | `82f9385` | HTTP Payment Base 边界、Bot 真实文案、定时恢复、支付审计管理面板 |
| 验收修正 | `1b8f132` | Mock Receipt 可合法解析，但不会显示为 `Paid / verified` 或链上 Explorer 证据 |

最终文档更新另有独立提交。

## 3. CodexClaw 与 grammY

上游来源固定为：

```text
repository = https://github.com/MackDing/CodexClaw.git
branch     = main
commit     = 263be7c8281e90bf6604a65a4f327f385df60279
```

`poolmate/upstream.json` 保存导入时间、原始质量门和导入时未取得许可证文件的事实。导入后已删除 `poolmate/backend/.git`，根仓库没有新增 submodule。上游 `package.json` 声明 MIT，但固定 commit 未包含 `LICENSE` 文件，对外分发前仍需确认许可文本与归档要求。

CodexClaw 原 Telegraf runtime 已迁移为 grammY。grammY 类型仅存在于 `backend/src/bot/grammy/`；Domain、Application、shared DTO 和数据库不依赖 Telegram 框架。Bot 支持 `/start`、`/status`、`/pool_new`、`/pool_claim`、`/pool_leave`、`/pool_quote`、`/pool_remind`、`/pool_status` 和稳定 callback data，并覆盖 allowlist、重复 callback、群聊边界及 Telegram API 失败。

## 4. 架构与职责

```text
Telegram / Admin Console / Confirmation Surface
                     |
              PoolMate Backend
      OrderService + PaymentOrchestrationService
          |                         |
   PoolMate SQLite          PaymentBaseClient
   pm_* tables              external HTTPS only
                                    |
                             PactLedger boundary
```

- Frontend 只调用 PoolMate Backend，不持有 Telegram Token、管理员 Key 或 Payment Base Key。
- OrderService 是 Checkout、Allocation、Confirmation 和 Payment Request 的事实源。
- PaymentOrchestrationService 管理 claim、lease、projection、outbox、Receipt 门和恢复。
- PaymentBaseClient 是唯一外部支付边界，不知道 PactLedger Repository、Policy Engine 或 Settlement Adapter。
- `sponsored_demo` 是当前唯一可用资金模式；`prefunded_participants` 没有被本地布尔值伪造。

## 5. 业务与资金不变量

业务链按以下顺序推进：

```text
DRAFT -> COLLECTING -> QUOTE_PENDING -> CONFIRMATION_PENDING
      -> READY_FOR_PAYMENT -> PAYMENT_SUBMITTED
      -> PAID | DEMO_CONFIRMED | PAYMENT_FAILED | PAYMENT_UNKNOWN
```

关键约束：

- 份额满员只进入报价阶段，不会自动付款。
- Checkout 使用版本化 canonical JSON 和 SHA-256 hash，修改后旧确认全部失效。
- 金额使用 `assetId + amountAtomic` 和 BigInt 分配，参与人合计必须等于 Checkout 总额。
- 确认 token 只通过 URL fragment 进入页面，数据库只保存 token hash。
- Telegram WebApp 身份校验覆盖签名、时效和参与人 user ID。
- 最后一人并发确认只能产生一条 Payment Request、一个稳定幂等键和一个稳定 operation ID。
- Mock confirmation 只能进入 `DEMO_CONFIRMED`。
- 只有 Testnet/Live confirmed、持久化 Receipt ID、非空 tx hash、HTTPS Explorer URL 和有效确认时间同时成立时才能进入 `PAID`。

## 6. 支付故障与恢复

`pm_payment_projections` 与 `pm_outbox` 保存支付执行事实。提交流程使用数据库 claim 和 lease，避免并发 Worker 重复提交。进程在提交中断时将操作隔离为 UNKNOWN；启动扫描和 30 秒恢复任务只查询原 operation ID，绝不重新构造或重播付款。

HTTP 适配器只有在 URL、服务端 API Key、settlement mode、submit path 和 recover path 都显式配置后才启用。URL 必须是无凭据的 HTTPS origin；路径拒绝 Demo、遍历、query 和 fragment。提交发送稳定 idempotency key；恢复是按编码 operation ID 的 GET，不发送付款 body。超时、传输失败、无效响应和 settlement mode 不一致全部 fail closed。

## 7. API 与运行配置

主要端点：

- `GET /health`、`/health/live`、`/health/ready`
- `GET /api/public/config-status`
- 管理员鉴权的 group、order、claim、checkout、payment submit/recover API
- Telegram WebApp 身份保护的 public confirmation GET/confirm/decline API

关键后端环境变量：

```text
POOLMATE_PUBLIC_BASE_URL
POOLMATE_ADMIN_API_KEY
POOLMATE_DATABASE_PATH
POOLMATE_SPONSORED_PAYER_REF
TELEGRAM_BOT_TOKEN
TELEGRAM_ALLOWED_USER_IDS
PAYMENT_BASE_URL
PAYMENT_BASE_API_KEY
PAYMENT_SETTLEMENT_MODE
PAYMENT_BASE_SUBMIT_PATH
PAYMENT_BASE_RECOVER_PATH
PAYMENT_BASE_TIMEOUT_MS
```

Token 和支付凭证均无 `VITE_` 前缀。启用 Telegram 时 `POOLMATE_PUBLIC_BASE_URL` 必须是外部 HTTPS Frontend origin。

## 8. 验收结果

| 验收项 | 结果 |
|---|---|
| Backend typecheck / lint / format | 通过 |
| Backend tests | `86/86` 通过 |
| Backend build / empty DB healthcheck | 通过，5 个 migration |
| Backend production dependency audit | 0 个 high/critical |
| Frontend lint / typecheck / tests / build | 通过，`28/28` |
| Shared typecheck / build | 通过 |
| Docker empty-volume cold start | Backend 与 Frontend healthy |
| 浏览器插件 | 当前 Codex 桌面会话无可控制浏览器实例，未执行真实浏览器 E2E 或截图 |
| 响应式替代检查 | CSS/DOM 状态、管理员 gate 与 jsdom 交互测试通过；发布前仍需真实桌面/移动浏览器 QA |
| Repository boundary | 无嵌套 `.git`、无 submodule、无 `web/` import、无 Telegraf production import |

容器 Smoke Test 使用的临时地址为：

- Frontend：`http://127.0.0.1:18080`
- Backend：`http://127.0.0.1:18788`

验收结束后临时容器会被关闭，这两个地址不是持续部署入口。

## 9. 未完成与下一步

1. PactLedger 发布并版本化稳定的远端支付提交和 operation 查询契约，明确鉴权、幂等、审批、原子金额、错误码与 Receipt schema。
2. 配置独立服务的 Payment Base URL、路径、服务端凭证和 Testnet mode，完成一次真实 `merchant_pay` 并保存 Explorer、Receipt JSON 和数据库证据。
3. 配置真实 Telegram Token、allowlist 和外部 HTTPS Mini App，使用至少三名真实用户完成群聊、私聊确认、重复 callback 与过期 Checkout smoke。
4. 在真实 Telegram Web/Desktop 容器中验证页面加载、安全响应头、键盘导航和移动端布局。
5. 在基座未提供成员入金和 Reservation 证据前，继续禁用 `prefunded_participants`。

上述事项完成前，不得宣称 PoolMate 已接入真实 A2A/AP2、已收到成员资金或已完成 Injective 链上付款。
