---
kind: external_dependency
name: A2A 协议 — Agent 编排通信标准
slug: a2a-protocol
category: external_dependency
category_hints:
    - auth_protocol
    - framework_behavior
scope:
    - '**'
source_files:
    - web/src/components/AgentRail.tsx
    - web/src/App.tsx
---

项目采用 A2A（Agent-to-Agent）协议进行多 Agent 协作编排。App.tsx 底部标注 'A2A compatible'，AgentRail 组件显示 'A2A orchestration'。services/a2aClient.ts 将负责任务提交与 Agent 运行状态订阅，需遵循 A2A 协议的通信规范。当前为架构预留，尚未实现具体客户端。