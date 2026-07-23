---
kind: build_system
name: 前端构建系统（Vite + TypeScript）
category: build_system
scope:
    - '**'
source_files:
    - web/package.json
    - web/vite.config.ts
    - web/tsconfig.json
    - web/tsconfig.app.json
    - web/tsconfig.node.json
---

本仓库为 KaleidoX 参赛项目的方案与设计文档集合，不包含后端服务、链上合约或跨平台打包逻辑。构建体系仅存在于 `web/` 子目录中，采用纯前端单页应用模式：

- **构建工具**：Vite（`vite.config.ts`），启用 `@vitejs/plugin-react` 插件。
- **类型编译**：TypeScript 5.9.3，通过 `tsc -b` 进行项目引用式编译（`tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` 三文件结构）。
- **脚本入口**：`web/package.json` 的 `scripts` 字段提供 `dev`、`build`、`lint`、`preview` 四个命令；其中 `build` 先执行 `tsc -b` 再调用 `vite build`，产物输出到 `web/dist/`。
- **依赖管理**：npm（`package-lock.json`），所有依赖均使用 `latest` 标签，无固定版本策略。
- **代码质量**：ESLint（`eslint.config.js`）+ typescript-eslint，无 Prettier 集成。

仓库根目录不存在 Makefile、Dockerfile、CI 流水线、发布脚本等任何后端/容器化/自动化构建配置，因此该类别对整体仓库而言属于“低适用度”——仅有前端 Vite 构建存在。