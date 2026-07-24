# PactLedger 文档索引

## 权威顺序

1. [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md)：产品定位、架构、完成度、路线图与统一口径，最高优先级。
2. [`DEVELOPMENT.md`](DEVELOPMENT.md)：本地运行、测试、环境和部署。
3. [`INJECTIVE_AGENT_PAYMENT_HANDOFF.md`](INJECTIVE_AGENT_PAYMENT_HANDOFF.md)：Injective 专项接口与验收。
4. [`.impeccable.md`](../.impeccable.md)：界面设计上下文，只约束视觉与信息层级。
5. `.qoder/repowiki/`：工具自动生成的代码索引，仅供搜索参考，不能覆盖上述人工文档。

比赛原始材料统一放在 `reference/`。[`reference/ADVENTUREX_TRACKS.md`](reference/ADVENTUREX_TRACKS.md) 是赛题原文整理，用于核对提交要求，不代表本项目已经实现其中描述的能力。

根目录 [`README.md`](../README.md) 是导航入口，[`AGENTS.md`](../AGENTS.md) 是编程 Agent 的强制约束。

## 文档状态规则

文档描述功能时必须使用以下五种状态之一：

- `已实现`：代码存在，并通过本地测试或可复现验证。
- `已接入`：依赖真实外部服务且当前配置可用；必须同时提供验证方式。
- `原型`：页面或确定性模拟可演示，但不等于真实业务闭环。
- `实现中`：代码已进入当前工作树，但尚未完成测试、联调或部署验收。
- `待实现`：只有接口、方案或占位代码。

禁止把 `Mock` 写成 Testnet，把 `Replay` 写成 Live，把协议标签写成协议已接入。

“待生产部署”是对 `已实现` 的部署限定，不是第六种实现状态；必须同时写清本地证据和公网证据。

## 清理结果

- 旧的双租户规划稿已由 `PRODUCT_SPEC.md` 吸收，不再作为事实源。
- 根目录赛题整理已归档到 `docs/reference/`，避免与产品文档混放。
- `web/README.md` 只保留跳转入口，避免与根目录文档重复。
- 新增产品约束或改变产品定位时，先更新 `PRODUCT_SPEC.md`，再更新专项文档。
