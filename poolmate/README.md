# PoolMate 本地测试

PoolMate 是 PactLedger 的群聊拼单参考应用。当前自然语言入口会保存用户的商品、数量、单位、采购渠道偏好和参考价，但最终 merchant、payee 和 amount 仍只来自可信 Checkout；默认 Checkout 继续使用 `Demo Merchant #001` 模拟。

## 启用自然语言测试

如果原有 Telegram 和部署配置已经可用，本次只需设置一个服务端变量：

```text
AIPING_API_KEY=你的 API Key
```

不要把 Key 放进任何 `VITE_` 变量。只设置该 Key 时，后端会自动使用：

```text
provider=deepseek
baseUrl=https://aiping.cn/api/v1
model=DeepSeek-V3.2
```

如需显式关闭，可设置 `POOLMATE_LLM_ENABLED=false`；`DEEPSEEK_API_KEY` 和其他 `POOLMATE_LLM_*` 仍可作为替代配置。

Docker 配置示例：

```bash
cd poolmate
./scripts/poolmate.sh init-env
# 编辑 deploy/.env，至少填入现有 Telegram 配置和 AIPING_API_KEY
./scripts/poolmate.sh up
```

脚本会根据自身位置定位 Compose 文件，不依赖当前机器的绝对路径。它还支持 `rebuild`、`restart`、`down`、`status`、`logs` 和 `health`；已有自定义环境可以用 `--env-file` 和 `--project` 复用。

然后在已接入 Bot 的 Telegram 群里发送：

```text
@PoolMate 拼单 3瓶可乐，美团外卖
```

Bot 应先返回 `DRAFT` 草稿，并明确显示“可乐 / 3 瓶 / 美团外卖 / Demo Merchant (Mock)”。“美团外卖”只是采购渠道偏好，不代表已真实接入美团；最终 merchant、payee 和 amount 要等可信 Checkout 生成。

## 本地质量门

```bash
cd poolmate/shared && npm run typecheck && npm run build
cd ../backend && npm run ci && npm run db:check
cd ../frontend && npm run typecheck && npm run lint && npm test && npm run build
```
