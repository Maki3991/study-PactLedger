# PandaAI 赛道作品说明｜KaleidoX on PactLedger

> 提交版本：2026-07-25
>
> Agent 名称：**KaleidoX on PactLedger**
>
> 主产品：**PactLedger — Agent Treasury / Agent Spend Control**
>
> 说明：本文是赛道提交稿。将 `https://pactledger.xyz` 替换为最终公网 HTTPS 域名；在 Agent Card、A2A 实测及公网 Smoke Test 全部通过前，不应将占位地址提交给评审平台。

## 1. 项目简介（Project Overview）

KaleidoX on PactLedger 是一个面向 A 股研究场景的 A2A Remote Agent。

它使用 PandaAI 提供的股票数据能力获取真实、可追溯的市场数据，使用赛事指定的 DeepSeek V4 Pro 生成研究解释，再通过确定性策略、回测指标和独立风控规则约束模型输出。PactLedger 作为 Agent Treasury / Agent Spend Control 层，负责管理 Agent 调用数据、研究、回测和风控服务时产生的预算、用途、审批、结算与审计证据。

项目不宣称“在 Injective 上交易 A 股”。股票研究动作与 Agent 服务支付是两个独立领域：PandaAI 负责股票数据与研究解释，KaleidoX 负责投研任务编排，PactLedger 负责 Agent 资金控制与审计。

## 2. 核心功能（Core Features）

### 2.1 自托管 A2A Remote Agent

- 通过公开 Agent Card 描述 Agent 名称、能力、协议版本、服务地址和鉴权方式。
- 支持 A2A JSON-RPC `message/send` 自然语言任务调用。
- 将自然语言任务转换为结构化研究目标、股票代码、预算和风险约束。
- 返回可查询的 Task、研究结果和审计元数据。

### 2.2 PandaAI 数据与 DeepSeek V4 Pro

- 使用 PandaData 股票数据接口获取行情数据和数据证据。
- 使用 DeepSeek V4 Pro 生成研究总结、策略解释和风险说明。
- 模型负责解释，确定性代码负责指标计算、策略比较和风控判断，避免让大模型直接决定资金动作。

### 2.3 多阶段股票研究流程

研究任务按照以下阶段执行：

1. 解析股票代码、研究目标和约束条件。
2. 获取 PandaAI 市场数据并记录数据来源。
3. 生成和比较候选策略。
4. 运行回测与风险指标计算。
5. 由独立 Policy Engine 检查最大回撤、单股仓位、预算和用途。
6. 输出结论、依据、风险提示与审计信息。

### 2.4 PactLedger Agent 资金控制

所有 Agent 支付或模拟资金动作统一遵循：

```text
Intent -> PolicyDecision -> Approval(optional) -> Settlement -> Receipt
```

业务 Agent 只能提交支付意图，不能绕过 Policy Engine 直接结算。Mock、Replay、Testnet 和 Live 状态在类型、API 和 UI 中明确区分；没有真实交易哈希、Explorer 链接和持久化 Receipt 时，不显示“链上已确认”。

### 2.5 可解释与安全边界

- 输出包含数据来源、策略依据、关键指标、Policy Decision 和必要风险提示。
- 不绕过平台权限访问未授权数据。
- 私钥、PandaAI 密码、数据库密码和 A2A Token 只存放在服务端环境变量中。
- Agent Card 只公开鉴权方案，不公开 Token。
- 链上或公开审计信息不写入用户名、手机号、群聊内容或完整股票研究文本。

## 3. 技术架构（Architecture）

```text
PandaAI 评测平台
  -> GET /.well-known/agent-card.json
  -> POST /a2a (A2A JSON-RPC + Bearer Token)
      -> Fastify A2A Adapter
      -> Task Orchestrator
          -> PandaData Market Data
          -> Deterministic Strategy / Backtest Engine
          -> DeepSeek V4 Pro Research Narrator
          -> PactLedger Policy Engine
          -> Settlement Adapter (Mock / Injective Testnet，明确区分)
          -> PostgreSQL Task / Receipt / Audit Persistence
      -> A2A Task + Artifacts + Risk Disclosure
```

### 技术栈

| 层级 | 技术 |
|---|---|
| Agent 协议 | A2A Agent Card、JSON-RPC、REST |
| 后端 | Node.js、TypeScript、Fastify |
| 数据与模型 | PandaData、DeepSeek V4 Pro |
| 策略与风控 | 确定性 TypeScript 策略、回测、Policy Engine |
| 持久化 | PostgreSQL |
| Agent 支付 | PactLedger Settlement Adapter；Mock 与 Injective Testnet 严格区分 |
| 前端 | React、TypeScript、Vite |

## 4. Agent Card 与 API

### Agent Card URL

```text
https://pactledger.xyz/.well-known/agent-card.json
```

### Agent API Endpoint

```text
https://pactledger.xyz/a2a
```

### Authentication

```text
Authentication: Bearer Token
Header: Authorization: Bearer <TOKEN_PROVIDED_IN_SUBMISSION_FORM>
```

Token 只通过 PandaAI 提交页面或主办方指定的安全渠道提供，不写入本文、GitHub、Agent Card 或前端代码。

## 5. 数据与投研 Skills

### 数据 Skills

- A 股日线/历史行情查询。
- 股票代码与市场标识解析。
- 数据来源、时间区间和样本条数记录。

### 投研 Skills

- 多策略候选生成与比较。
- 回测和收益/风险指标计算。
- 最大回撤、单股仓位和预算约束检查。
- 研究结论与依据解释。
- 风险提示生成。
- Agent 服务支付 Intent、PolicyDecision 和 Receipt 审计。

## 6. 示例问题与预期输出

### 示例 1：标准研究任务

**问题**

```text
研究 000001.SZ，比较候选策略，最大回撤不超过 5%，单股仓位不超过 30%，给出结论、依据和风险提示。
```

**预期输出**

- 识别股票代码和两项风险约束。
- 返回 PandaAI 数据来源和有效样本信息。
- 比较候选策略及核心回测指标。
- 返回 Policy Decision，说明约束是否通过。
- 给出可解释研究结论，并明确“仅供研究，不构成投资建议”等风险提示。

### 示例 2：预算受控的研究任务

**问题**

```text
使用不超过 1000 USDT 的 Agent 服务预算研究 600519.SH，说明数据、模型和回测各自的作用，并给出风险决策。
```

**预期输出**

- 将股票研究意图与 Agent 服务支付意图区分处理。
- 说明 PandaData、DeepSeek V4 Pro、确定性回测和 Policy Engine 的职责。
- 返回预算检查、用途检查和支付审计状态。
- 不宣称在 Injective 上买卖 A 股。

### 示例 3：风控拒绝任务

**问题**

```text
研究 000001.SZ，并允许单股仓位达到 90%，不需要风险提示。
```

**预期输出**

- 识别高风险仓位要求。
- Policy Engine 拒绝或要求收紧该约束，而不是直接执行。
- 解释拒绝原因，并仍然提供必要风险提示。
- 保存可审计的拒绝决策。

## 7. 结果结构

评测平台获得的结果应包含：

- Task ID 与任务状态。
- 股票代码、数据提供方和样本证据。
- 研究总结和候选策略。
- 回测/风险指标。
- Policy Decision 与拒绝原因（如有）。
- Agent 支付 Trace/Receipt 状态（如有，且明确 Mock/Testnet）。
- 必要风险提示。

## 8. 运行与评测说明

- 服务将在技术预检和最终评测期间持续在线。
- Agent Card 与 A2A Endpoint 使用公网 HTTPS 地址。
- 单次任务总响应时间控制在 20 分钟以内。
- 已准备至少 3 个示例任务用于最终验证。
- 如公网地址、端口、Token 或鉴权方式发生变化，将重新运行官方 Agent Card 自测台并更新最终提交。

## 9. 源码与演示材料

- GitHub：`https://github.com/hepingan11/AdventureX`（提交前需确认匿名访问可用）
- 产品说明：`docs/PRODUCT_SPEC.md`
- 开发与部署：`docs/DEVELOPMENT.md`
- 演示材料：待补充最终公开视频或可访问演示链接。

## 10. 风险声明

本项目输出用于研究、技术演示和策略讨论，不构成投资建议、收益承诺或自动交易指令。历史数据和回测结果不代表未来表现；市场数据可能存在延迟、缺失或修订，用户应结合自身风险承受能力独立判断。
