# PactLedger

> Agent 的可编程财务控制层：Agent 只能提交花钱意图，账户、预算、白名单、审批、结算与审计由 PactLedger 接管。

PactLedger 是本仓库唯一主产品。KaleidoX 与 PoolMate 是两个参考应用：前者用高风险的股票投研流程验证 Agent 不能越权花钱，后者用群聊拼单验证同一套财务基座可以跨业务复用。

## 当前交付状态（2026-07-24）

- 运行时基线 `ca13473` 已完成 lint、生产构建与 API tests `37/37`。
- 通用 PactLedger Trace、PostgreSQL Receipt/幂等、PoolMate 同基座 API、Fastify A2A 和 Injective 官方 SDK Testnet Adapter 已实现。
- PandaData 真实日线与 DeepSeek V4 Pro 已完成外部调用验证；Ark 保留为模型后备。
- 尚未完成真实 Injective Testnet 交易，原因是缺少正式配置的钱包、收款地址、denom/精度与测试币。
- 公网 `http://129.226.91.246:8787` 当前仍运行旧版本；必须重新部署并通过公网 Smoke Test 后，才能把新 Agent Card 和 Base Status 作为比赛证据。

## 先读这里

- [产品说明与黑客松交付指南](docs/PRODUCT_SPEC.md)：产品定位、核心逻辑、真实完成度、获奖演示、路线图和 Agent 接手任务。
- [开发、测试与部署](docs/DEVELOPMENT.md)：当前权威运行路径、环境变量、命令和 API。
- [Injective 支付接入交接](docs/INJECTIVE_AGENT_PAYMENT_HANDOFF.md)：链上队友的接口、数据、安全与验收清单。
- [文档索引](docs/README.md)：文档权威顺序与维护规则。
- [AGENTS.md](AGENTS.md)：所有编程 Agent 必须遵守的全局约束。

## 产品主线

```text
业务 Agent 提交 Intent
  -> PactLedger 检查账户、预算、用途、白名单和有效期
  -> 必要时要求人工批准
  -> Settlement Adapter 在 Injective 等结算层执行
  -> Receipt 与完整 Policy Trace 写入审计账本
```

黑客松期间所有功能都必须服务于这条主线。协议、Agent 数量、交易策略和页面动效都是第二层能力，不能掩盖最核心的证明：

> Agent 可以提出花钱，但不能绕过 PactLedger 直接花钱。

## 当前演示入口

- `/`：PactLedger 产品与共用基座说明。
- `/kaleidox.html`：KaleidoX 股票投研参考应用。
- `/poolmate.html`：PoolMate 群聊拼单参考应用。
- `/api/health`：后端依赖摘要；即使显示 `testnet_ready` 也不等于已经产生真实 Injective 链上交易。
- `/api/public/base-status`：无需登录的 PactLedger 基座与真实结算证据状态。
- `/.well-known/agent-card.json`：Fastify A2A Agent Card；Testnet 外部任务必须配置 `A2A_API_KEY`。

本地开发请从 `web/` 目录启动。根目录 `server/` 是旧 Express/A2A 实现，不是 Docker/生产入口。具体命令见 [开发文档](docs/DEVELOPMENT.md)。
