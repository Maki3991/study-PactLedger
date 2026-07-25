# PactLedger 开发、测试与部署

> 本文只描述当前权威运行路径。产品定位与功能优先级见 [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md)。

## 1. 当前运行边界

```text
web/src/       React + TypeScript 前端
web/server/    Fastify API、任务编排、量化、Treasury、Policy 与 Adapter
PostgreSQL     用户、会话、任务、账户、流水与 Receipt
```

`Dockerfile` 只复制并构建 `web/`，生产 systemd 服务也从 `web/server/index.ts` 启动。A2A、Agent Card、Telegram Bot 和 PactLedger Trace 已收敛到 Fastify。较早的根目录 Express `server/` 已删除；禁止重新创建第二套后端。

## 2. 本地准备

要求：

- Node.js 22（至少使用当前锁文件可支持的现代 Node 版本）。
- Python 3.10+。
- PostgreSQL 16 或兼容版本。

PowerShell 示例：

```powershell
Set-Location .\web
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-panda.txt
Copy-Item .env.example .env.local
```

编辑 `.env.local`，至少填写 PostgreSQL。PandaAI 与 Injective 可以先保持 Replay / Mock：

```dotenv
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=agent_treasury
POSTGRES_USER=agent_treasury
POSTGRES_PASSWORD=change-me

PANDA_DATA_MODE=auto
PANDA_DATA_USERNAME=
PANDA_DATA_PASSWORD=
PANDA_PYTHON_BIN=.venv/Scripts/python.exe

DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_BASE_URL=https://api.deepseek.com

INJECTIVE_EXECUTION_MODE=mock
```

启动：

```powershell
npm run dev
```

- Web：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8787`

推荐在 `web/` 目录执行开发、构建和测试命令；根目录同名 npm 脚本只代理到 `web/`，仓库没有第二套后端运行路径。

## 3. 页面入口

- `/` 与 `/landing.html`：PactLedger 基座落地页。
- `/kaleidox.html`：需要登录的 KaleidoX 控制台。
- `/poolmate.html`：PoolMate 参考应用演示。

生产模式由 Fastify 从 `web/dist/` 同端口托管静态文件。

## 4. 配置原则

### PostgreSQL

开发与生产 API 必须配置 PostgreSQL；测试可使用进程内仓库。支持：

- `DATABASE_URL`
- 或 `POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`

### PandaAI

- 无账号时：`PANDA_DATA_MODE=auto` 自动选择确定性 Replay。
- 有账号时：服务端 Python bridge 调用 `panda_data==0.0.12` 的 `get_stock_daily_pre`、`get_stock_detail`、`get_stock_industry` 与 `get_index_daily`；后三个增强接口独立容错，不会让已成功的真实个股日线降级为 Replay。
- `POST /api/stocks/recommendations` 使用 `get_index_weights` 构建沪深 300 有界候选池，再批量调用 `get_stock_detail`、`get_stock_daily_pre` 与 `get_index_daily` 计算相对收益、区间 Beta 和流动性；PandaData 不可用时返回稳定错误，不允许用 Replay 伪装推荐。
- 官方目录中的 `get_stock_pv_indicator` 与 `get_stock_recommendation_consensus` 在 `panda-data==0.0.12` 实测只接受港股代码格式，因此 A 股候选雷达不依赖这两个接口。
- 纯大陆手机号用户名会自动规范化为 `86 + 手机号`；已带国家码的用户名保持不变。
- `DEEPSEEK_API_KEY` 存在时，DeepSeek V4 Pro 是主模型；未配置时才使用 `ARK_API_KEY` 对应的 Ark endpoint，最后回退模板。
- 模型只生成基于回测证据的解释文本，不负责决定交易。
- UI 必须显示 `PandaData Live` 或 `Panda Replay`。

### Telegram

- `TELEGRAM_BOT_TOKEN` 只由 Fastify 服务端读取；禁止使用 `VITE_` 前缀。
- 未配置 Token 时 Bot 不启动，公开状态端点返回 `BOT_NOT_CONFIGURED`。
- Telegram 拼单会话持久化到 PostgreSQL；付款使用确定性 Intent ID 进入同一个 PactLedger Policy / Receipt 流程。
- 当前 Telegram checkout 固定使用 Mock Adapter，消息与页面必须显示 `Mock Receipt · No Chain`。迁移到 Testnet 前不得自动操作真实资金。

### Injective

- 默认 `INJECTIVE_EXECUTION_MODE=mock`。
- 私钥只放服务端 `.env.local` / `.env`，禁止使用 `VITE_`。
- 仅配置钱包不代表真实链上完成；必须同时配置资产与收款白名单，并以真实确认交易、Explorer 和数据库 Receipt 为准。
- 详细字段和接入步骤见 [`INJECTIVE_AGENT_PAYMENT_HANDOFF.md`](INJECTIVE_AGENT_PAYMENT_HANDOFF.md)。

## 5. 测试与质量门槛

在 `web/` 目录执行：

```powershell
npm run lint
npm run build
npm run test:api
```

2026-07-24 最新运行时基线验证结果：

- `npm run lint`：通过。
- `npm run build`：通过。
- `npm run test:api`：`42/42` 通过。

高风险变更还必须验证：

- 未登录访问受保护 API 返回 `401`。
- 越权读取他人任务返回 `404` 或稳定拒绝。
- 非法状态跳转返回 `409`。
- 同一支付 Intent 重试不会重复结算。
- Policy 拒绝、人工批准、结算失败与成功 Receipt 均能持久化。
- Mock / Replay / Testnet / Live 标签与真实状态一致。
- SIGTERM 能让 API 正常关闭连接。

## 6. 当前核心 API

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout

POST /api/tasks
GET  /api/tasks/:id
GET  /api/tasks/:id/events
POST /api/tasks/:id/approve
POST /api/tasks/:id/execute

GET  /api/config/panda
GET  /api/config/panda/model
GET  /api/config/injective
GET  /api/treasury/:taskId/accounts
GET  /api/treasury/:taskId/audit-log
GET  /api/health

GET  /api/public/base-status
GET  /api/public/poolmate/bot-status
POST /api/demo/poolmate/checkout

GET  /.well-known/agent-card.json
POST /a2a
POST /a2a/tasks/send
GET  /a2a/tasks/:id
```

以上 PactLedger、PoolMate、Telegram 状态与 A2A 路由均已在 Fastify 实现并通过本地测试。Testnet 模式必须设置 `A2A_API_KEY` 才能接收外部任务；Agent Card 会声明 Bearer API Key 鉴权。`PUBLIC_BASE_URL` 用于生成公网 A2A 地址。当前仍需配置真实 Bot Token、重新部署并完成公网 Smoke Test。

## 7. Docker Compose

先复制并填写生产环境模板：

```powershell
Copy-Item .\web\.env.production.example .\web\.env.production
docker compose up --build
```

Compose 会启动：

- `agent-treasury`：端口 `8787`。
- `postgres`：PostgreSQL 16，数据写入 `postgres-data` 卷。

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
```

注意：新运行时使用 `mock_ready`、`testnet_configuration_required`、`testnet_ready`、`testnet_confirmed` 等状态。即使是 `testnet_ready` 也只代表配置齐全；只有 `testnet_confirmed` 加真实交易哈希、Explorer 和持久化 Receipt 才能证明链上完成。

## 8. Ubuntu + systemd

生产服务文件位于 `deploy/agent-treasury.service`，默认工作目录：

```text
/opt/agent-treasury/web
```

基本流程：

```bash
cd /opt/agent-treasury/web
npm ci
npm run build
sudo systemctl restart agent-treasury.service
curl -fsS http://127.0.0.1:8787/api/health
```

部署后继续运行生产 Smoke Test，至少核对：

```bash
curl -fsS http://127.0.0.1:8787/api/health
curl -fsS http://127.0.0.1:8787/api/public/base-status
curl -fsS http://127.0.0.1:8787/.well-known/agent-card.json
```

验收标准：

- health 的 `service` 必须是 `pactledger-api`。
- Base Status 与 Agent Card 无需登录即可返回 `200`，且响应中不能泄露私钥。
- 使用正确/错误 `A2A_API_KEY` 分别验证提交成功与 `401`；Testnet 未配置 Key 时应安全返回 `503`。
- 继续核对登录、创建任务、SSE、批准、执行、PoolMate 两种 Trace、数据库恢复和静态页面。

### 当前公网部署差异

2026-07-24 对 `http://129.226.91.246:8787` 的实测仍是旧版本：

- `/api/health` 返回 `service: kaleidox-api`。
- `/api/public/base-status` 返回 `401`。
- `/.well-known/agent-card.json` 返回 `404`。

因此源码完成不等于生产完成。下一位部署 Agent 应拉取最新 `main`，重新构建并重启服务，然后重复上述公网请求；在三个结果符合新契约前，不得把公网 Agent Card 或 Base Status 放进提交材料。

## 9. 关键文件导航

```text
web/src/domain/                 稳定领域模型
web/server/pactledger/          通用 Intent / Policy / Receipt 基座
web/server/poolmate/            Telegram 传输、拼单会话与规范化付款编排
web/server/orchestrator.ts      KaleidoX 业务编排
web/server/treasury.ts          Agent 内部账户和流水
web/server/quant/               PandaData、确定性回测、研究解释
web/server/adapters/            外部结算适配器
web/server/app.ts               Fastify 路由、鉴权、A2A 与 SSE
web/server/repository.ts        任务快照持久化
web/src/poolmate/               PoolMate 参考应用
```

完成度仍以 `PRODUCT_SPEC.md` 为准；代码存在或本地测试通过不等于已经生产上线。
