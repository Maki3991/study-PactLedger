---
kind: dependency_management
name: 前端依赖管理（npm + lockfile）
category: dependency_management
scope:
    - '**'
source_files:
    - web/package.json
    - web/package-lock.json
---

本仓库为单前端项目，仅包含 `web/` 子目录的 React + Vite 应用，未涉及 Go、Python 等后端语言的依赖管理。当前依赖管理体系如下：

1. **包管理器与声明文件**
   - 使用 npm 作为包管理器，通过 `web/package.json` 声明运行时依赖与开发依赖。
   - 使用 `web/package-lock.json`（lockfileVersion: 3）锁定所有依赖树版本，确保构建可重复。
   - 未发现 `yarn.lock`、`pnpm-lock.yaml`、`go.mod`、`Cargo.toml`、`requirements.txt` 等其他语言/工具的依赖清单。

2. **版本策略**
   - 核心运行时依赖（react、react-dom、vite、@vitejs/plugin-react、lucide-react）在 `package.json` 中统一使用 `latest` 标签，未采用语义化版本范围或固定版本号。
   - 仅有 TypeScript 工具链使用精确版本 `~5.9.3`，其余开发依赖同样以 `latest` 声明。
   - 这种“全部 latest”的策略意味着每次 `npm install` 都会拉取各包的最新发布版本，存在不可复现构建的风险；实际安装结果由 `package-lock.json` 中的快照决定。

3. **私有源与镜像配置**
   - 未在仓库中发现 `.npmrc`、`.yarnrc`、`pnpm-workspace.yaml` 等私有注册表或镜像配置。
   - 也未发现 GOPRIVATE、vendor 目录、Go workspace 等后端依赖管理痕迹。

4. **工作区与多包结构**
   - 仓库为单包结构，不存在 monorepo/workspace 配置，也无共享包或内部模块引用。

开发者应遵循的规则与建议：
- 将 `package.json` 中的 `latest` 替换为明确的语义化版本范围（如 `^18.0.0`），并在提交前运行 `npm install --package-lock-only` 更新锁文件，以保证团队与 CI 环境的一致性。
- 若引入私有 npm 包，应在仓库根或 `web/` 下维护 `.npmrc` 并纳入版本控制，避免硬编码 token。
- 如需引入后端服务，建议为对应目录单独维护其依赖清单（如 `go.mod`、`requirements.txt`），与本前端依赖解耦。