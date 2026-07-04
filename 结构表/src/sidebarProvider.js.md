# 侧边栏视图 — `src/sidebarProvider.js`

对应源码文件：`src/sidebarProvider.js`

## 职责

注册为 `ghcpDashboard.sidebarView` 的 WebviewView 提供程序，在活动栏 GHCP 图标下渲染紧凑概览。

## 类结构

```javascript
class SidebarProvider {
    constructor(extensionUri, context)  // 存储引用，初始化状态
    resolveWebviewView(webviewView)     // VS Code 调用，设置 webview + 消息处理
    refresh()                           // 重新获取数据并渲染
    _updateContent()                    // 核心：骨架屏/刷新 → 获取数据 → _getHtml
    _getHtml(data)                      // 生成侧边栏完整 HTML
}
```

## 外部依赖

```javascript
const { AccountDataFetcher } = require('./accountDataFetcher');
```

## 函数清单

### 公开方法

| 方法 | 说明 |
|------|------|
| `constructor(extensionUri, context)` | 初始化：`_view = null`, `_hasLoadedOnce = false` |
| `resolveWebviewView(webviewView)` | 注册 webview 选项、首次渲染、可见性变化自动刷新、消息监听 |
| `refresh()` | 如果 view 存在则调用 `_updateContent()` |

### 私有方法

| 方法 | 返回 | 说明 |
|------|------|------|
| `_updateContent()` | `Promise<void>` | 首次加载显示骨架屏 → `getAllData()` → `_getHtml()` 渲染；失败显示错误页 |
| `_getHtml(data)` | `string` | 生成完整侧边栏 HTML（AI Metrics / Copilot Chat / Recent Sessions / Models / MCP Servers） |

### 辅助函数

| 函数 | 返回 | 说明 |
|------|------|------|
| `getNonce()` | `string` | 生成随机 nonce，用于 CSP |
| `escapeHtml(s)` | `string` | HTML 转义（& < > "），防 XSS |

## 消息处理

| 消息命令 | 处理动作 |
|----------|----------|
| `openDashboard` | 执行 `ghcpDashboard.open` |
| `switchAccount` | 执行 `ghcpDashboard.switchAccount` |
| `refresh` | 调用 `this.refresh()` |
| `manageAccounts` | 打开账户管理 |
| `signInGithub` | 静默请求 GitHub session |
| `signInMicrosoft` | 静默请求 Microsoft session |
| `openSettings` | 打开 `editor.aiStats.enabled` |
| `openChatSession` | 4 种策略尝试重新打开会话 |

## 侧边栏 UI 结构

```
┌─────────────────────┐
│ 📊 AI Metrics — 日期  │  ← 本周统计（可折叠）
│ [AI Rate][Sessions]  │
│ [Suggestions][Edits] │
│ 进度条               │
├─────────────────────┤
│ 💬 Copilot Chat      │  ← 版本/状态/上次使用/工作区（可折叠）
├─────────────────────┤
│ 🕐 Recent Sessions   │  ← 最近 5 条（可折叠）
├─────────────────────┤
│ 🤖 Models (N)        │  ← 可用数 + 顶级模型（可折叠）
├─────────────────────┤
│ 🔌 MCP Servers (N)   │  ← 服务器列表（可折叠）
├─────────────────────┤
│ [Open Dashboard]     │  ← 粘性底部
│ [Refresh]            │
│ 🦊 名言 + 时间戳      │
└─────────────────────┘
```

## 设计要点

1. **骨架屏首次加载**：`_hasLoadedOnce=false` 时显示灰色骨架 + 狐狸消息轮播
2. **可见性自动刷新**：侧边栏从隐藏切到可见时重新渲染，防止缓存过期
3. **可折叠 section**：每个数据区域支持点击标题折叠/展开
4. **刷新 toast**：刷新时显示浮动 toast + 狐狸消息动画
5. **数据新鲜度指示**：绿色=5分钟内，琥珀色=超过5分钟
