---
kind: external_dependency
name: Injective 测试网 — 链上执行目标网络
slug: injective-testnet
category: external_dependency
category_hints:
    - vendor_identity
    - client_constraint
scope:
    - '**'
source_files:
    - web/src/domain/trading.ts
    - web/src/components/FirewallPanel.tsx
---

项目计划通过 Injective 测试网完成真实链上交易执行。当前前端仅模拟状态流转，尚未接入钱包授权、Capital Firewall 校验与交易广播。后续需在 services/injectiveClient.ts 中实现：钱包签名、防火墙规则校验、测试网交易提交与回执解析。交易哈希以 0x 前缀展示，需确认 Injective 测试网的实际地址格式与区块浏览器链接。