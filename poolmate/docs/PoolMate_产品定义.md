# PoolMate 产品定义

**版本：** v2.1
**产品形态：** Telegram 群聊原生拼单与支付确认 Agent
**交易模式：** Human Present
**协议定位：** 当前采用 A2A 作为购物应用与支付基座之间的外层协作协议，并为未来接入 AP2 Human Present 保留兼容边界
**结算原则：** 最终报价、精确分摊、逐人确认、一次付款；正常主流程不进行交付后退差

---

## 1. 产品定义

PoolMate 是运行在 Telegram 群聊中的拼单协调与支付确认 Agent。

它帮助群成员在群内用一句自然语言发起拼单、让 Bot 立即返回一张可追踪的群内卡片、收集其他成员的认领份额、获取商户最终报价、计算每名参与人的精确应付金额，并在锁定参与人全部明确确认后，通过受限支付基座向指定商户完成一次性付款。

典型入口是：

```text
@PoolMate 我们要拼单，期望3瓶可乐，美团外卖 xx 店铺名，（链接可有可无）
```

Bot 必须先在群里立刻发送一张“正在处理中”的拼单卡片，卡片中明确 @ 发起人、展示发起时间、原始请求和当前解析状态。LLM 或确定性解析完成后，Bot 更新同一张卡片，展示商品、期望数量、采购渠道/店铺/链接等不可信用户意图，并进入可点击认领阶段。

PoolMate 不是普通的群收款机器人，也不是代表用户自主购物的全自动 Agent。它不会根据预估价格自动花钱，不会在用户不在线时完成购买，也不会在付款后根据运费、折扣或最终成本重新计算并退还差价。

付款发生前，每名参与人都必须看到并确认：

- 最终商品和数量；
- 最终商户；
- 最终订单总额；
- 本人的精确应付金额；
- 使用的支付方式；
- 报价和付款有效期。

只有锁定参与人全部完成确认后，PoolMate 才能向商户付款。用户说的“期望数量”是拼单目标和 UI 参考，不是付款硬门槛：发起人可以在未达到期望数量时请求最终报价并付款，也可以在认领数量超过期望时按实际锁定数量继续付款。无论少于、等于还是超过期望数量，付款金额都只能来自最终 Checkout 和逐人确认。

---

## 2. 核心价值主张

> 把 PoolMate 拉进 Telegram 群，发起人一句 @Bot 就能生成可追踪的拼单卡片；群成员可以直接点击认领，并在商户最终价格确定后分别确认自己的精确付款金额。PoolMate 汇总确认结果并向指定商户完成付款，不需要任何群成员垫付，也不能改变用户已经确认的商品、金额和收款方。

PoolMate 主要解决四个问题：

1. 拼单发起人不需要个人垫付整笔订单。
2. 群成员不需要通过收款码和聊天记录人工对账。
3. 每名参与人只确认和承担自己的最终应付金额。
4. PoolMate 只能执行与最终订单和用户确认完全一致的商户付款。
5. 期望数量只帮助协调拼单，不阻塞提前结算或超额拼单的正常付款。

---

## 3. 产品假设

MVP 建立在以下产品假设上：

1. 拼单商品来自已接入或已配置的演示商户。
2. 商户可以在付款前提供包含全部费用的最终报价。
3. 最终报价至少包含商品金额、运费、折扣、税费或其他必要费用。
4. 用户确认后，商户不得再修改订单价格。
5. PoolMate 不支持付款后追加费用。
6. 商品交付不改变已经支付的订单金额。
7. 交付确认只用于更新履约状态，不触发二次资金结算。
8. 商户无法提供最终价格的商品或服务不进入 MVP。
9. 多参与人共同出资由 PoolMate 与支付基座的内部资金模型完成，不宣称属于 AP2 核心规范原生能力。
10. 期望数量不等于最大容量；产品可以配置绝对安全上限，但不能把用户期望数量当作付款前置条件。

---

## 4. 产品角色

### 4.1 群管理员

负责：

- 将 PoolMate 加入群；
- 完成群初始化；
- 配置默认商户和订单超时时间；
- 暂停新订单或付款；
- 处理异常订单。

### 4.2 拼单发起人

负责：

- 用自然语言发起拼单请求；
- 在 Bot 无法解析时补充缺失字段；
- 认领自己的商品份额；
- 决定何时锁定当前参与人并请求商户最终报价；
- 在允许阶段取消订单；
- 查看商户履约状态。

发起人不能代表其他参与人确认付款。

### 4.3 参与人

可以：

- 认领商品数量或费用份额；
- 在锁单前调整或退出；
- 查看最终报价和本人精确应付金额；
- 确认或拒绝本人的付款；
- 查看付款结果和个人账单。

### 4.4 PoolMate Shopping Agent

负责：

- 理解群成员的自然语言订单请求；
- 立即发送并持续更新群内拼单卡片；
- 管理订单和参与人份额；
- 调用 Merchant Agent 获取最终 Checkout；
- 根据最终 Checkout 计算每名参与人的精确金额；
- 向每名参与人发起 Human Present 确认；
- 在全部确认后请求 Payment Agent 执行付款；
- 发布订单状态、付款结果和凭证。

PoolMate 不得自行决定最终金额、收款方或支付工具。

### 4.5 Trusted Confirmation Surface

Trusted Confirmation Surface 是用户确认最终购买和付款内容的可信界面。

MVP 可以采用 Telegram 私聊跳转的独立确认页面或钱包页面。该界面必须使用确定性数据渲染最终 Checkout，不允许由 LLM 自由生成金额或商户信息。

未来接入 AP2 Human Present 时，该界面负责取得用户对闭合 Checkout Mandate 和 Payment Mandate 的签名确认。

### 4.6 Merchant Agent

负责：

- 提供商品和可售数量；
- 返回最终报价；
- 创建商户订单；
- 提供经过验证的收款身份；
- 接收付款；
- 返回订单和履约状态；
- 返回商户订单凭证。

未来接入 AP2 时，Merchant 需要提供签名 Checkout，并验证与该 Checkout 绑定的 Checkout Mandate。

### 4.7 Payment Foundation

负责：

- 保存和验证用户付款确认；
- 校验每名参与人的精确应付金额；
- 校验商户身份和收款方；
- 校验订单、报价版本和幂等键；
- 聚合参与人的付款份额；
- 向商户执行一次性付款；
- 保存账本和审计凭证；
- 返回结构化付款结果。

当前 Payment Foundation 使用自有 canonical payment model。未来可以增加 AP2 Credential Provider、Mandate Verifier 和 Merchant Payment Processor 能力。

---

## 5. 核心用户流程

### 5.0 Bot 指令、帮助和调试入口

PoolMate 的 Telegram 指令说明由一个明确的 Markdown skill 维护：`poolmate/backend/src/bot/help/SKILL.md`。它是帮助输出、LLM command skill calling 和本地关键词兜底的共同事实源；TypeScript 代码只负责读取、解析和校验这份 Markdown，不再把“skill”写成命令常量文件。

当前 skill 覆盖的用户入口包括：

| 类别 | 指令 | 产品语义 |
|---|---|---|
| 初始化 | `/start` | 建立用户与 Bot 的私聊入口，确认 Bot 可用。 |
| 运行状态 | `/status` | 查看 Telegram Bot 与自然语言解析运行状态。 |
| 帮助 | `/help` | 展示完整命令清单。 |
| LLM skill calling | `/pool_help <用户请求>` | 先用 LLM 按 Markdown skill 调用用户意图对应的 command skill，再用本地关键词兜底推荐命令；不会执行高风险命令或推断订单 ID。 |
| 创建拼单 | `@PoolMate ...` / `/pool_new <expectedUnits> <title>` | 自然语言只要求明确商品和期望数量；展示标题未明确时由服务端根据商品生成。Bot 立即展示处理中卡片，解析完成后同卡片进入认领；命令入口用于无 LLM 或解析失败时。 |
| 认领 | `/pool_claim <orderId> [units]` | 在 `COLLECTING` 阶段认领或调整数量。 |
| 退出 | `/pool_leave <orderId>` | 锁单前移除自己的认领。 |
| 报价 | `/pool_quote <orderId>` | 发起人按当前实际份额锁单并请求最终 Checkout。 |
| 状态 | `/pool_status <orderId>` | 查看订单、Checkout、确认、付款和 Receipt 状态。 |
| 关闭 | `/pool_close <orderId>` | 在安全阶段关闭拼单，不创建 Receipt。 |
| 提醒 | `/pool_remind <orderId>` | 轮换并重发未确认用户的私聊确认链接。 |
| 手动调试 | `/pool_test <orderId> +N` / `/pool_test <orderId> -N` | 增减确定性的 `Virtual #001` 风格虚拟参与人，方便现场测试 under/exact/over expected；该指令只改变认领记录，不创建 Checkout、确认、付款、Receipt 或链上证据。 |

### 阶段 A：创建拼单

1. 群成员通过 `/pool_new <expectedUnits> <title>`，或在群内明确 @mention Bot 后用自然语言发起拼单。
2. Bot 立即返回一张处理中卡片，展示发起人、发起时间、原始请求和“正在解析”的状态；此时无 Checkout、无确认、无付款。
3. 当前自然语言适配器提取商品、期望数量、单位、采购渠道偏好、店铺名、可选链接和用户参考价；例如 `@PoolMate 我们要拼单，期望3瓶可乐，美团外卖 xx 店铺名` 会保留“可乐 / 3 / 瓶 / 美团外卖 / xx 店铺名”。
4. 采购渠道、店铺名、链接和参考价属于不可信用户意图，不等于已验证商户、收款方或最终价格；当前 Checkout 仍由固定 Demo Merchant 模拟生成。
5. 字段缺失或歧义时，处理中卡片更新为“需要补充信息”或“解析失败”，不得创建可认领订单；完整结果进入 `COLLECTING`，同一张卡片更新为可点击认领卡片。

此阶段的价格可以是参考价格，但必须清楚标记为“预估”，不能用于实际扣款。

### 阶段 B：成员认领

1. 群成员认领商品数量。
2. PoolMate 记录每个人的份额。
3. 参与人可以在锁单前调整数量或退出。
4. 认领行为只是加入订单，不产生支付授权或资金扣款。
5. 期望数量只是卡片进度参考；认领少于、等于或超过期望数量时，发起人都可以请求最终报价。
6. 请求最终报价时，PoolMate 锁定当前参与人和实际认领份额，并在卡片中明确展示“未达期望 / 已达期望 / 超过期望”。

### 阶段 C：获取最终报价

PoolMate 向 Merchant Agent 请求最终 Checkout。

最终 Checkout 必须包含：

- 商户身份；
- 商品明细；
- 最终数量；
- 商品金额；
- 最终运费；
- 折扣；
- 税费和其他费用；
- 最终订单总额；
- 支付资产；
- 收款方；
- 报价版本；
- 报价有效期。

报价进入确认阶段后必须不可变。

### 阶段 D：计算个人应付

PoolMate 根据锁定份额和最终 Checkout 计算每名参与人的精确应付金额。

```text
个人应付
= 最终商品金额分摊
+ 最终运费分摊
+ 税费及其他费用分摊
- 折扣分摊
```

所有金额使用最小支付单位整数计算，不使用浮点数。

各参与人应付金额之和必须严格等于商户最终 Checkout 总额。

### 阶段 E：Human Present 确认

PoolMate 向每名参与人发送独立确认页面。

确认页面至少显示：

```text
订单：#PM-7F3K
商品：可乐 1 瓶
商户：Demo Merchant #001

商品分摊：9 USDT
运费分摊：1 USDT
折扣分摊：0 USDT
你的最终应付：10 USDT

报价有效期：2026-07-25 20:10
支付方式：测试钱包

确认后，PoolMate 将按以上金额向该商户付款。
付款后不会根据价格变化自动退差。
```

操作按钮：

```text
[确认购买并付款]
[拒绝]
```

确认必须满足：

- 用户身份正确；
- Checkout 仍在有效期内；
- Checkout hash 和报价版本未变化；
- 本人份额未变化；
- 本人金额未变化；
- 商户身份未变化；
- 支付方式仍然可用。

任何一项变化都必须使原确认失效，并要求用户重新确认。

### 阶段 F：执行付款

只有同时满足以下条件，订单才能付款：

1. 至少一名参与人已认领有效份额；
2. 当前参与人和实际份额已锁定；
3. 商户最终 Checkout 有效；
4. 所有锁定参与人均已确认；
5. 每人确认金额与资金分配一致；
6. 分配金额之和等于 Checkout 总额；
7. 商户和收款方通过白名单校验；
8. 订单和 Tenant 未暂停；
9. 幂等键尚未成功执行。

Payment Foundation 将参与人的精确付款份额聚合为一次商户付款。

### 阶段 G：订单完成

付款成功后：

1. PoolMate 发布商户付款凭证；
2. 商户开始履约；
3. PoolMate 展示发货或交付状态；
4. 商户确认交付，或发起人确认收到商品；
5. 订单进入 `COMPLETED`。

交付确认不触发金额重算、退差或补差。

---

## 6. 价格与资金规则

### 6.1 预估价格不产生授权

订单创建阶段的价格仅用于帮助群成员判断是否参加。

预估价格不得直接用于：

- 创建付款授权；
- 扣款；
- 生成商户订单；
- 判断最终个人应付。

### 6.2 最终价格先于确认

用户只确认最终金额，不确认金额上限。

因此 MVP 删除以下概念：

- 预估授权上限；
- 安全缓冲；
- 最多可消费金额；
- 交付后实际金额；
- 自动退差；
- 最终补差。

### 6.3 报价变化必须重新确认

在付款执行前，只要发生以下任一变化，全部相关确认失效：

- 商品变化；
- 数量变化；
- 商户变化；
- 运费变化；
- 折扣变化；
- 税费或其他费用变化；
- 总金额变化；
- 参与人份额变化；
- 支付工具变化；
- 报价过期。

系统必须生成新的 Checkout 版本，并重新请求参与人确认。

### 6.4 付款后价格不可变化

付款成功后，商户不得要求 PoolMate 自动追加付款。

如果商户无法按已确认价格履约：

- MVP 将订单标记为异常；
- 不自动重新计算参与人金额；
- 不自动执行差价调整；
- 由商户退款或运营流程处理。

### 6.5 不退差价不等于完全没有退款

MVP 不支持因最终运费、折扣或成本变化产生的自动退差。

以下异常退款可以作为后续能力保留：

- 商户取消订单；
- 商户无法履约；
- 重复付款；
- 明确的支付执行错误；
- 经人工审核确认的整单退款。

异常退款不属于正常订单主流程，也不进入首版演示闭环。

---

## 7. 订单状态机

正常状态：

```text
DRAFT
  → COLLECTING
  → QUOTE_PENDING
  → CONFIRMATION_PENDING
  → READY_FOR_PAYMENT
  → PAYMENT_PENDING
  → MERCHANT_PAID
  → FULFILLMENT_PENDING
  → COMPLETED
```

异常状态：

```text
CANCEL_PENDING
CANCELED
EXPIRED
PAYMENT_FAILED
FAILED_REVIEW
```

MVP 删除：

```text
SETTLING
REFUND_PENDING
REFUNDED
```

### 状态说明

| 状态 | 含义 |
|---|---|
| `DRAFT` | 订单信息尚未确认 |
| `COLLECTING` | 群成员正在认领份额 |
| `QUOTE_PENDING` | 份额已锁定，正在获取最终报价 |
| `CONFIRMATION_PENDING` | 最终报价已生成，等待参与人逐一确认 |
| `READY_FOR_PAYMENT` | 全部参与人已确认，可以执行付款 |
| `PAYMENT_PENDING` | 付款已提交，等待确定结果 |
| `MERCHANT_PAID` | 商户已收到付款 |
| `FULFILLMENT_PENDING` | 等待发货或交付 |
| `COMPLETED` | 商品已交付，订单结束 |
| `EXPIRED` | 认领、报价或确认阶段超时 |
| `PAYMENT_FAILED` | 付款被明确拒绝或执行失败 |
| `FAILED_REVIEW` | 支付终态未知或自动恢复失败 |

---

## 8. 参与人状态

```text
ALLOCATED
  → CONFIRMATION_PENDING
  → CONFIRMED
  → CAPTURED
  → COMPLETED
```

其他状态：

```text
EXITED
DECLINED
EXPIRED
PAYMENT_FAILED
```

其中：

- `ALLOCATED`：已认领份额；
- `CONFIRMATION_PENDING`：已计算最终金额，等待本人确认；
- `CONFIRMED`：已确认最终 Checkout 和本人金额；
- `CAPTURED`：本人对应金额已用于商户付款；
- `COMPLETED`：订单已交付；
- `DECLINED`：用户拒绝最终金额。

---

## 9. A2A 协议定位

A2A 是 PoolMate Shopping Agent、Merchant Agent 和 Payment Agent 之间的外层协作协议。

A2A 用于：

- Agent 能力发现；
- 创建和查询任务；
- 传输结构化请求；
- 返回报价和付款 Artifact；
- 推送异步状态；
- 保存跨 Agent Trace。

A2A 不负责定义：

- 订单金额计算；
- 多参与人资金分配；
- 用户确认规则；
- 合规策略；
- 账本；
- 底层结算。

上述内容由 PoolMate Domain 和 Payment Foundation 的 canonical model 定义。

---

## 10. AP2 演进边界

当前版本不声明已经符合 AP2，但必须保留以下产品和数据对象：

- Merchant Checkout Snapshot；
- Checkout Version；
- Checkout Hash；
- Merchant Identity；
- Exact Payment Amount；
- Payment Instrument Reference；
- User Confirmation Evidence；
- Checkout Result；
- Payment Result；
- Checkout Receipt Reference；
- Payment Receipt Reference。

未来升级至 AP2 Human Present 时：

1. Merchant Checkout Snapshot 替换或扩展为 Merchant-signed Checkout JWT。
2. 用户购买确认扩展为闭合 Checkout Mandate。
3. 用户付款确认扩展为闭合 Payment Mandate。
4. Payment Foundation 验证 Payment Mandate 并返回受限支付凭证。
5. Merchant 验证 Checkout Mandate。
6. Merchant 返回 Checkout Receipt。
7. Payment Processor 返回 Payment Receipt。
8. Mandate 和 Receipt 与现有订单、付款操作和审计事件关联。

当前版本不实现：

- Open Checkout Mandate；
- Open Payment Mandate；
- Human Not Present；
- Agent 自主签署最终购买；
- AP2 多参与人付款扩展；
- AP2 标准化退款。

---

## 11. MVP 产品范围

### 11.1 必须完成

- Telegram 群初始化；
- 明确 @mention 后自然语言创建待确认草稿；
- 群内拼单卡片；
- 多成员认领和调整份额；
- 份额锁定；
- Merchant Agent 最终报价；
- 最终费用完整展示；
- 精确个人金额计算；
- 每名参与人独立 Human Present 确认；
- 锁定参与人全部确认后执行一次商户付款；
- 白名单和金额一致性校验；
- Checkout 版本和 hash 绑定；
- 幂等付款；
- 支付成功、失败和未知状态处理；
- 商户订单和履约状态；
- 群总账和个人账单；
- A2A 与 Payment Trace；
- 可查询付款凭证。

### 11.2 明确不做

- 用户不在线时自动购买；
- 预授权金额上限；
- 安全缓冲；
- 最终报价范围内自动付款；
- 交付后价格重算；
- 自动退差；
- 自动补差；
- Batch Payout；
- 部分退款恢复；
- 多商品购物车；
- 多商户拆单；
- 动态汇率；
- 开放互联网商品搜索；
- 复杂物流和售后；
- AP2 正式兼容声明。

---

## 12. 安全原则

1. LLM 不得直接修改订单状态。
2. LLM 不得生成或修改最终金额。
3. LLM 不得指定任意收款地址。
4. 最终 Checkout 必须来自经过验证的 Merchant Agent 或 Merchant Adapter。
5. 用户确认必须绑定 Checkout hash、版本、本人份额和本人金额。
6. Checkout 变化后，原确认必须失效。
7. Payment Agent 只能接收订单和报价引用，不接受 LLM 提交的任意金额和收款方。
8. 所有付款请求必须具备幂等键。
9. 支付状态未知时不得重复付款。
10. 群内不得展示完整钱包地址、签名或敏感付款凭证。
11. 设置服务端 `AIPING_API_KEY` 时自然语言能力自动使用普通模型 `DeepSeek-V3.2`；未设置、显式关闭或不可用时，命令流程必须继续工作。
12. LLM 只允许返回可选展示标题、商品、期望数量、单位、采购渠道偏好、店铺/链接、用户参考价和缺失/歧义分类；自然语言的用户必填信息只有商品和期望数量，展示标题缺失时由服务端根据商品确定性生成。任何 merchant、payee、asset、final amount、Checkout、确认、付款或状态字段都必须拒绝。
13. LLM 输出不得决定可信状态；只有确定性服务在校验结果完整后，才能把处理中卡片更新为 `COLLECTING` 可认领卡片。
14. 发起人或受保护的管理员只能在 `DRAFT`、`COLLECTING`、`QUOTE_PENDING`、`CONFIRMATION_PENDING`、`READY_FOR_PAYMENT` 且付款尚未提交时关闭拼单。
15. 关闭拼单必须持久化取消证据、使待处理确认失效，并且不得伪造 Settlement 或 Receipt。

---

## 13. 核心验收标准

### AC-01：认领不产生付款

**Given** 用户认领商品份额
**When** 商户最终报价尚未生成
**Then** 系统不得创建付款或扣款
**And** 用户状态只进入 `ALLOCATED`

### AC-02：最终报价后逐人确认

**Given** 最终 Checkout 已生成
**When** 系统计算出各参与人的精确应付金额
**Then** 每名参与人必须收到独立确认页面
**And** 页面显示最终商品、商户和本人金额

### AC-03：锁定参与人未全员确认不得付款

**Given** 订单锁定了三名参与人
**And** 其中一人尚未确认
**When** PoolMate 检查付款条件
**Then** 订单必须保持 `CONFIRMATION_PENDING`
**And** 不得向商户付款

### AC-03A：期望数量不是付款硬门槛

**Given** 发起人期望 3 瓶可乐
**And** 当前实际认领数量为 2 瓶或 4 瓶
**When** 发起人请求最终报价
**Then** PoolMate 可以锁定当前实际份额并进入报价流程
**And** 卡片必须明确展示当前数量与期望数量的差异
**And** 最终 Checkout、分摊和付款确认必须使用实际锁定数量

### AC-04：Checkout 变化使确认失效

**Given** 用户已经确认 Checkout v1
**When** 商户修改运费并生成 Checkout v2
**Then** v1 的全部用户确认必须失效
**And** 所有参与人必须重新确认 v2

### AC-05：分配总额必须一致

**Given** Merchant Checkout 总额为 30 USDT
**When** Payment Foundation 校验参与人分配
**Then** 所有参与人金额之和必须严格等于 30 USDT
**And** 不一致时不得执行付款

### AC-06：非指定商户不得收款

**Given** 最终 Checkout 指定 Demo Merchant #001
**When** 任意消息要求向其他地址付款
**Then** Payment Foundation 必须拒绝
**And** 订单与资金状态保持不变

### AC-07：重复请求不重复付款

**Given** 同一付款请求已提交
**When** Telegram、A2A 或 Worker 重复发送请求
**Then** 系统必须复用原幂等键
**And** 不得创建第二笔商户付款

### AC-08：支付状态未知不得重付

**Given** 底层支付已提交但返回超时
**When** Worker 执行恢复
**Then** 系统必须先查询原支付终态
**And** 不得直接重新创建付款

### AC-09：交付后不退差

**Given** 商户已按最终 Checkout 收款
**When** 发起人确认交付
**Then** 订单直接进入 `COMPLETED`
**And** 不得触发价格重算、退差或补差

---

## 14. MVP 完成定义

PoolMate 只有同时满足以下条件才算完成：

1. 至少两个独立 Telegram 用户参与同一订单。
2. 每名用户可以认领和修改自己的份额。
3. Bot 能在 @mention 后立即发送处理中卡片，并在解析完成后更新为可点击认领卡片。
4. 份额锁定后，系统可以从商户获取最终 Checkout；实际份额可以少于、等于或超过期望数量。
5. 最终 Checkout 包含全部应付费用。
6. 系统能精确计算每名参与人的最终应付金额。
7. 每名参与人都能在独立界面查看并确认自己的精确金额。
8. 任一锁定参与人未确认时，不得执行商户付款。
9. 任一 Checkout 字段发生变化时，已有确认必须失效。
10. Payment Foundation 只能向最终 Checkout 指定的已验证商户付款。
11. 所有参与人的付款分配之和必须等于商户 Checkout 总额。
12. 重复消息、重复确认和重复任务不得产生重复付款。
13. 付款成功后可以查看商户订单、支付状态和交易凭证。
14. 订单交付后直接进入 `COMPLETED`，不进入退差结算流程。
15. 产品数据结构可以在不修改订单核心模型的前提下扩展 AP2 Mandate 和 Receipt。
