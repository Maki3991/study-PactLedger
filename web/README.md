# KaleidoX Command Center

KaleidoX 的前端演示框架，用于展示 Multi-Agent 投研、Champion-Challenger 策略进化、独立风控和 Injective 测试网执行闭环。

## 本地运行

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动：

- Web：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8787`

## Injective 测试网配置

实际填写位置为 `.env.local`，字段模板位于 `.env.example`。默认使用安全的 Mock 模式：

```dotenv
INJECTIVE_EXECUTION_MODE=mock
INJECTIVE_WALLET_ADDRESS=
INJECTIVE_PRIVATE_KEY=
INJECTIVE_MARKET_ID=
INJECTIVE_SUBACCOUNT_ID=
```

填写完成后可将 `INJECTIVE_EXECUTION_MODE` 改为 `testnet`。私钥只由 API 进程读取，不要使用 `VITE_` 前缀，也不要把 `.env.local` 提交到仓库。

当前 `testnet` 模式已经具备配置校验和执行阻断，但签名广播适配器仍标记为 `testnet-pending`；在接入 Injective SDK 前，即使配置完整也不会发起链上交易。脱敏状态可通过 `GET /api/config/injective` 查看。

生产构建与校验：

```bash
npm run lint
npm run build
npm run test:api
```

## 目录边界

```text
src/
├── components/     # 任务链、策略实验、资金防火墙等界面模块
├── domain/         # Agent、策略、风控规则的领域类型
├── services/       # 当前 Demo 数据；后续替换为 A2A/PandaAI/Injective 适配器
├── App.tsx         # 页面编排与演示状态机
└── styles.css      # 视觉系统和响应式布局
server/
├── adapters/       # 外部执行层接口与 Injective Mock
├── app.ts          # Fastify 路由和 SSE 端点
├── orchestrator.ts # 可控的 Agent 演示状态机
└── repository.ts   # SQLite 任务快照持久化
```

## API

```text
POST /api/tasks
GET  /api/tasks/:id
GET  /api/tasks/:id/events   # Server-Sent Events
POST /api/tasks/:id/approve
POST /api/tasks/:id/execute
GET  /api/health
```

任务只能按以下状态推进：

```text
created → researching → strategizing → backtesting → risk_review
→ awaiting_approval → approved → executing → executed
```

越过审批直接执行会返回 `409 Conflict`。任务快照默认保存在 `server/data/kaleidox.db`，可通过 `KALEIDOX_DB_PATH` 修改；API 端口可通过 `KALEIDOX_API_PORT` 修改。

## 后续接入点

- `services/taskClient.ts`：已实现任务提交、SSE 订阅、批准和执行；
- `services/pandaClient.ts`：行情、研究 Skill 与回测结果；
- `server/adapters/execution.ts`：将 `MockInjectiveAdapter` 替换为真实钱包授权、Capital Firewall 校验、测试网广播与回执；
- 服务返回值应转换为 `domain/trading.ts` 中的稳定领域模型，避免 API 结构渗透到组件。

当前 Agent 编排和交易哈希由可控 Mock 生成，不会发起真实链上交易；任务状态、拒绝记录和执行回执会真实写入本地 SQLite。
