## 📝 手动集成步骤（只需要2分钟）

因为自动修改可能会和现有代码冲突，请手动添加以下两行代码即可完成集成：

### 步骤1：添加导入
在 `web/server/app.ts` 的导入部分，找到 `TreasuryService` 的导入，添加一行：
```typescript
import { registerTreasuryRoutes } from './treasury-integration/routes.js'
```

### 步骤2：注册路由
在 `app.ts` 的 `buildApp` 函数末尾，`app.addHook('onClose', ...)` 之前，添加：
```typescript
// 注册金库集成API路由
await registerTreasuryRoutes(app)
```

### 步骤3：完成
就是这么简单！所有其他代码都已经准备好了，只需要添加这两行。
