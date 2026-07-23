---
kind: external_dependency
name: PandaAI — 金融数据与投研 Skill 服务
slug: pandai
category: external_dependency
category_hints:
    - vendor_identity
    - sdk_real_api
scope:
    - '**'
source_files:
    - web/README.md
---

作为赛道 18（PandaAI）的核心依赖，负责提供行情数据、研究 Skill 调用与策略回测结果。services/pandaClient.ts 将封装 PandaAI API，返回数据需转换为 domain/trading.ts 中的 StrategyCandidate 等稳定模型。目前仅为占位，尚未实现具体 SDK 集成。