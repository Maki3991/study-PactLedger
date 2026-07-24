# PactLedger Agent Instructions

本文件约束所有在本仓库工作的编程 Agent。开始改代码前，必须先阅读：

1. `docs/PRODUCT_SPEC.md`
2. 与任务相关的专项文档，例如 `docs/INJECTIVE_AGENT_PAYMENT_HANDOFF.md`
3. 涉及界面时再阅读 `.impeccable.md`

## 一、唯一产品口径

- 主产品名称固定为 **PactLedger**。
- 产品类别固定为 **Agent Treasury / Agent Spend Control**。
- KaleidoX 和 PoolMate 是参考应用，不是两个独立基座。
- PandaAI 提供股票数据与研究解释；Injective 负责 Agent 支付结算与可验证回执。
- 禁止宣称“在 Injective 上交易 A 股”。股票业务动作与 Agent 支付必须使用不同领域对象。

## 二、实现不变量

任何真实或模拟资金动作都必须遵循：

```text
Intent -> PolicyDecision -> Approval(optional) -> Settlement -> Receipt
```

- 业务应用不得绕过 Policy Engine 直接调用结算适配器。
- `ActionIntent` / `BrokerOrderIntent` 表达业务动作；`AgentPaymentIntent` 表达 Agent 支付，二者不得混用。
- 相同支付 Intent 必须幂等，重试不能重复付款。
- Mock、Replay、Testnet、Live 必须在类型、API 和 UI 中明确区分。
- 没有真实交易哈希、可打开的 Explorer 链接和已持久化 Receipt 时，不得显示“链上已确认”。
- 私钥、PandaAI 密码和数据库密码只能由服务端环境变量读取，禁止使用 `VITE_` 前缀，禁止提交 Git。
- 链上只写 ID、金额、地址和必要哈希，不写用户名、群聊内容、股票研究全文或手机号。

## 三、仓库边界

- 当前产品前端位于 `web/src/`。
- 当前部署入口与唯一权威后端位于 `web/server/`。
- 较早的根目录 Express `server/` 已删除；禁止重新创建第二套后端，所有 API、A2A、Telegram 与支付逻辑都必须进入 `web/server/`。
- 通用基座代码不得出现只属于股票或拼单的硬编码语义。
- `.qoder/repowiki/` 是自动生成参考资料，不是产品事实源，不要手工维护。

## 四、当前交付基线（2026-07-24）

- `web/server/` 已实现并通过本地验证：通用 Intent / Policy / Settlement / Receipt、PostgreSQL 持久化与幂等、PoolMate 合法/拒绝 Trace、Fastify A2A、Telegram Bot Mock 支付闭环、公开 Base Status、Injective 官方 SDK Testnet Adapter。
- 本地质量门已通过：lint、生产构建、API tests `42/42`。
- PandaData `get_stock_daily_pre` 与 DeepSeek V4 Pro 已分别完成真实调用验证；DeepSeek 是主模型，Ark 仅作后备。
- 尚无真实 Injective Testnet 确认交易；钱包、收款地址、denom/精度和测试币属于当前外部配置阻塞。
- 公网 `http://129.226.91.246:8787` 仍是旧部署。完成 redeploy/restart 和公网 Smoke Test 前，不得宣称 Agent Card 或新 Base Status 已上线。

## 五、变更要求

- 先检查当前代码和配置，再修改文档或声称能力已完成。
- 新增基座能力时，至少用 KaleidoX 和 PoolMate 两种 `appId` 中的一个真实用例与一个拒绝用例验证通用性。
- 新增 API 必须补稳定错误码、鉴权边界和测试。
- 涉及状态机、资金或链上广播的变更，必须补幂等、失败恢复和持久化验证。
- 更新产品完成度后，同步更新 `docs/PRODUCT_SPEC.md` 的状态表和下一步清单。

## 六、黑客松优先级

1. 配置真实钱包、白名单收款地址、支付资产与测试币，完成一笔可在 Explorer 打开的 Injective Testnet Agent 服务费。
2. 将当前 `main` 重新部署到生产 Fastify，确认 `/api/health`、`/api/public/base-status` 与 `/.well-known/agent-card.json` 公网可访问。
3. 固化 Explorer、Receipt JSON、Agent Card、3 个 A2A 示例任务和响应时长等提交证据。
4. 增加广播后链上查询恢复；当前中断的 `settling` 状态只会安全隔离，不会自动重播。
5. 最后再做协议连接器、Telegram 生产联调、更多策略、更多页面和高级合约。

任何时间冲突下，优先完成可被现场验证的端到端证据，不扩展无法证明的概念。
