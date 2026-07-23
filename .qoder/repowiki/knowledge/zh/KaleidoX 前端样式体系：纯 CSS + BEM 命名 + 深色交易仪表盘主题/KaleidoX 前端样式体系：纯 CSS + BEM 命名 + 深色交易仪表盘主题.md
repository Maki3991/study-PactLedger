---
kind: frontend_style
name: KaleidoX 前端样式体系：纯 CSS + BEM 命名 + 深色交易仪表盘主题
category: frontend_style
scope:
    - '**'
source_files:
    - web/src/styles.css
    - web/src/App.tsx
    - web/src/components/AgentRail.tsx
    - web/src/components/EvolutionPanel.tsx
    - web/src/components/FirewallPanel.tsx
    - web/package.json
---

## 1. 系统/方法概述
- 技术栈：React + Vite + TypeScript，无 UI 组件库（仅使用 lucide-react 图标），样式全部通过原生 CSS 管理。
- 样式方法论：采用 BEM 风格的类名约定（如 app-shell、sidebar、nav-item、panel-heading、timeline-event 等），配合全局 CSS 变量实现主题与语义化配色。
- 构建与运行：Vite 开发服务器，TypeScript 编译后打包；样式由 Vite 直接引入 src/styles.css，无需额外 CSS 预处理器或 Tailwind。

## 2. 关键文件与包
- 样式入口与主题：web/src/styles.css
- 应用骨架与页面结构：web/src/App.tsx
- 子面板组件（复用同一套 CSS 类）：
  - web/src/components/AgentRail.tsx
  - web/src/components/EvolutionPanel.tsx
  - web/src/components/FirewallPanel.tsx
- 构建与依赖声明：web/package.json（仅 React/Vite/lucide-react，无样式框架）

## 3. 架构与约定
- 设计令牌（Design Tokens）集中定义在 :root 中，包括：
  - 背景与层级色板：--bg、--sidebar、--panel、--panel-raised、--line、--line-soft
  - 文本与层次：--text、--muted、--dim、--mono
  - 状态语义色：--green、--green-deep、--amber、--red、--cyan
- 字体策略：Google Fonts 加载 DM Mono + Manrope，正文用 Manrope，数据/标签用 DM Mono，并通过 CSS 变量 --mono 统一引用。
- 布局模式：固定侧边栏 + 弹性主工作区（.app-shell / .sidebar / .workspace），内容区以 CSS Grid 组合多个 .panel 卡片形成仪表盘网格（.dashboard-grid）。
- 响应式策略：基于三个断点（940px、1230px、700px）的 @media 规则，移动端侧边栏滑出并叠加遮罩，网格自动降级为两列/单列，隐藏次要元素（搜索框、网络徽章等）。
- 动效与可访问性：少量 @keyframes（pulse/rotate/reveal）用于状态指示与入场动画；提供 prefers-reduced-motion 媒体查询强制降低动效；按钮聚焦态使用绿色描边提升键盘可达性。
- 组件级样式约定：每个功能区域以 .panel 容器承载，头部统一使用 .panel-heading，内部列表/表格使用小字号 + monospace 数字/哈希展示，保持交易终端风格一致性。

## 4. 开发者应遵循的规则
- 新增样式优先使用现有 CSS 变量，不要硬编码颜色值；状态色严格对应 --green / --amber / --red / --cyan。
- 类名遵循 BEM 风格：模块级（如 agent-row、version-node、firewall-rule）、修饰符（如 is-working、selected、locked）清晰表达状态。
- 布局尽量复用 .panel + .panel-heading 组合，避免在每个组件内重复实现边框、圆角、间距等基础样式。
- 响应式行为集中在 styles.css 的 @media 块中维护，不要在组件里写内联样式控制布局。
- 图标统一从 lucide-react 导入，尺寸建议保持在 16–18px 范围，与现有导航/工具栏视觉一致。
- 如需新增主题或品牌色，请在 :root 扩展变量，并在需要时提供对应的暗/亮变体，保持全局一致性。
- 动画应保持克制，仅在关键反馈（执行状态、新事件进入）上使用，且需尊重 prefers-reduced-motion。