# dsh-free-auto

DeepSeek Harness (`dsh`) 插件：在免费模型池里按**速度优先**自动选线，失败自动降级；附带可拖动的浮动 Dock（本月用量 / 命中率、Free Auto 开关、线路排名）。

## 功能

- 注册单一模型路由 `free-auto` / `Free Auto`
- 从 `our-free-model` 的 `catalog.entries` 取免费池，按 TTFT + 在途负载智能排序
- 多对话按繁忙程度分散到不同线路；会话粘性，失败或过忙自动换线
- Dock：
  - 本月用量 / 本月命中
  - Switch：打开切到 Free Auto，关闭还原上一模型（如本地 SGLang）
  - 线路排名（首字延迟、在途/失败态）
  - 可拖动，位置本地记忆

依赖已安装的 [`dsh-our-free-model`](https://github.com/Ebony-Vinyl/dsh-our-free-model)（实际上游发流）与 `dsh-usage`（用量 API，Dock 会隐藏其自带浮窗）。

## 安装

在 **web** profile 下：

```bash
# 克隆到 profile 目录（或任意路径后用 link）
cd ~/.dsh/profiles/web
git clone https://github.com/hhzx/dsh-free-auto.git

# 写入 package.json dependencies + dsh.profile.bundles
# 例如：
#   "dsh-free-auto": "link:./dsh-free-auto"
#   bundles: [ ..., "dsh-free-auto" ]
```

PowerShell 示例（Windows）：

```powershell
$web = Join-Path $env:USERPROFILE ".dsh\profiles\web"
cd $web
git clone https://github.com/hhzx/dsh-free-auto.git
# 然后编辑 package.json，把 dsh-free-auto 加入 dependencies 与 bundles，再：
pnpm install   # 或 npm install
```

重启 `dsh web`，硬刷新浏览器。模型选择器里选 **Free Auto**，或用 Dock 上的开关一键切换。

## 开发

| 文件 | 说明 |
|------|------|
| `index.js` | 服务端：adapter、排序、`/api/free-auto/status` |
| `client.js` | 浏览器 Dock（无构建步骤，纯 `__ModuleLoader__`） |
| `cordis.patch.yml` | bundle 注册补丁 |
| `package.json` | dsh bundle / client 元数据 |

状态接口（仅 loopback）：

```http
GET /api/free-auto/status
```

## License

MIT
