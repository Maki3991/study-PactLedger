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

生产构建由 Fastify 同端口托管四个入口：

- `/`：PactLedger 基座落地页；
- `/landing.html`：落地页兼容入口；
- `/kaleidox.html`：保留登录的股票量化产品实例；
- `/poolmate.html`：PoolMate 接入映射演示。

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

## Ubuntu 宿主机直接部署

生产应用不依赖 Zeabur 构建，也不需要 Docker。服务器直接拉取 Git 分支，在宿主机完成依赖安装和前端构建，再由 systemd 运行 Fastify：

```bash
sudo install -d -o ubuntu -g ubuntu /opt/agent-treasury
git clone --branch codex/postgres-server-deploy <仓库地址> /opt/agent-treasury
cd /opt/agent-treasury

python3 -m venv .venv
.venv/bin/python -m pip install -r web/requirements-panda.txt

cd web
cp .env.production.example .env
# 编辑 .env，填写 PostgreSQL 与 PandaAI；不要提交密钥
npm ci
npm run build

sudo install -m 0644 ../deploy/agent-treasury.service /etc/systemd/system/agent-treasury.service
sudo systemctl daemon-reload
sudo systemctl enable --now agent-treasury.service
```

私有仓库应先为服务器配置只读 GitHub Deploy Key；首次部署也可以传输 `git bundle`，避免把个人 GitHub 私钥复制到服务器。

服务监听 `0.0.0.0:8787`，健康检查为 `GET /api/health`。已有的 80/443 服务不需要改动；若以后绑定域名，再由现有网关反向代理到 `127.0.0.1:8787`。

更新版本：

```bash
cd /opt/agent-treasury
git fetch origin
git checkout codex/postgres-server-deploy
git pull --ff-only
cd web
npm ci
npm run build
sudo systemctl restart agent-treasury.service
```

PostgreSQL 备份示例（密码通过受保护的环境或 `.pgpass` 提供，不要写入命令历史）：

```bash
pg_dump -h 127.0.0.1 -p 5432 -U agent_treasury agent_treasury > agent-treasury-$(date +%F).sql
```
