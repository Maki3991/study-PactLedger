# Agent Treasury / KaleidoX Demo

通用 Agent Treasury 控制基座，以及股票量化案例。PandaAI 负责股票数据与研究解释，策略信号和回测由确定性引擎生成；Injective 仅通过执行适配器接收统一 `ActionIntent`，当前默认使用 Mock 回执。

## 本地运行

```bash
npm install
npm run build
npm run dev
```

`npm run dev` 会同时启动：

- Web：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8787`

## PandaAI 股票数据配置

Python 需为 3.10 或更高版本。先安装官方数据 SDK：

```bash
C:\path\to\python.exe -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-panda.txt
```

复制 `.env.example` 为 `.env.local` 并自行填写 PandaAI 官网账号。不要在聊天、前端变量或 Git 中提交密码：

```dotenv
PANDA_DATA_MODE=auto
PANDA_DATA_USERNAME=86加官网注册手机号
PANDA_DATA_PASSWORD=
PANDA_PYTHON_BIN=.venv/Scripts/python.exe
ARK_API_KEY=
```

未配置账号时系统自动使用确定性 Replay 数据；配置后由服务端 Python bridge 调用 `panda_data`。`ARK_API_KEY` 仅用于解释回测证据，不负责生成交易决定。

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
├── services/       # 任务、配置状态、Treasury 前端客户端
├── App.tsx         # 页面编排与演示状态机
└── styles.css      # 视觉系统和响应式布局
server/
├── adapters/       # 外部执行层接口与 Injective Mock
├── quant/          # PandaData bridge、回测和研究解释
├── app.ts          # Fastify 路由和 SSE 端点
├── orchestrator.ts # 股票研究、回测、风控与执行编排
├── treasury.ts     # Agent 账户和资金流水 Demo
└── repository.ts   # PostgreSQL 任务快照持久化
```

## API

```text
POST /api/tasks
GET  /api/tasks/:id
GET  /api/tasks/:id/events   # Server-Sent Events
POST /api/tasks/:id/approve
POST /api/tasks/:id/execute
GET  /api/config/panda
GET  /api/config/panda/model
GET  /api/config/injective
GET  /api/treasury/:taskId/accounts
GET  /api/treasury/:taskId/audit-log
GET  /api/health
```

任务只能按以下状态推进：

```text
created → researching → strategizing → backtesting → risk_review
→ awaiting_approval → approved → executing → executed
```

越过审批直接执行会返回 `409 Conflict`。开发和生产运行都需要 PostgreSQL；可使用 `DATABASE_URL`，或配置 `POSTGRES_HOST`、`POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`。测试套件使用进程内存仓库，不依赖 SQLite。

## 后续接入点

- `services/taskClient.ts`：任务提交、SSE 订阅、批准和执行；
- `server/quant/marketData.ts`：PandaData / Replay Provider；
- `server/adapters/execution.ts`：将 `MockInjectiveAdapter` 替换为团队实现的 Injective 适配器；
- 服务返回值应转换为 `domain/trading.ts` 中的稳定领域模型，避免 API 结构渗透到组件。

当前不会买卖股票，也不会发起真实链上交易。回测、风险退回、用户批准和执行回执会进入统一任务快照与审计界面。

## Ubuntu / Zeabur 生产部署

仓库根目录提供单容器 `Dockerfile`。容器会：

- 构建 React 前端，并由 Fastify 在同一端口托管；
- 启动股票量化 API、SSE 和 Treasury API；
- 在 `/opt/panda-venv` 安装 `panda_data==0.0.12`；
- 将任务快照、Agent 账户和资金流水保存到 PostgreSQL；
- 监听 `0.0.0.0:8787`，并通过 `/api/health` 健康检查。

在服务器或 Zeabur 的项目变量中填写 `.env.production.example` 对应字段。不要提交 `.env.production`，也不要把 PandaAI 密码、Ark Key 或 Injective 私钥写入镜像。

普通 Ubuntu Docker 部署：

```bash
cp web/.env.production.example web/.env.production
# 在服务器上编辑 web/.env.production
docker compose up -d --build
docker compose logs -f agent-treasury
```

访问 `http://服务器地址:8787/`。如果使用域名，建议由 Zeabur 或 Nginx/Caddy 提供 HTTPS，并将流量反向代理到容器的 `8787` 端口。

同机 PostgreSQL 默认不映射公网端口，数据保存在 Docker 卷 `postgres-data`。备份示例：

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > agent-treasury-$(date +%F).sql
```
