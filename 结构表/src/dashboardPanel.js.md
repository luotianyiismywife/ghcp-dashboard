# 仪表板面板 — `src/dashboardPanel.js`

对应源码文件：`src/dashboardPanel.js`

## 职责

完整的仪表板 WebView 面板，通过 `ghcpDashboard.open` 命令打开。使用 VS Code `WebviewPanel` API。

## 类结构

```javascript
class DashboardPanel {
    static currentPanel = null       // 单例引用
    static viewType = 'ghcpDashboard'

    constructor(panel, extensionUri, context)
    static createOrShow(extensionUri, context)  // 创建/显示面板
    refresh()                                   // 重新获取数据并渲染
    _handleMessage(message)                     // WebView 消息处理
    _update()                                   // 加载动画 → 获取数据 → _getHtml
    _getHtml(data)                              // 生成完整仪表板 HTML
    dispose()                                   // 清理
}
```

## 外部依赖

```javascript
const { AccountDataFetcher } = require('./accountDataFetcher');
const { getTrendsTabHTML, getTrendsJS, getTrendsCSS } = require('./trendsPanel');
```

## 函数清单

### 静态方法

| 方法 | 说明 |
|------|------|
| `createOrShow(extensionUri, context)` | 单例模式：存在则 reveal + refresh，否则创建新 WebviewPanel |

### 实例方法

| 方法 | 说明 |
|------|------|
| `constructor(panel, extensionUri, context)` | 绑定事件监听，触发首次 `_update()` |
| `refresh()` | 重新获取数据并渲染 |
| `_handleMessage(message)` | 处理来自 WebView 的消息 |
| `_update()` | 显示加载动画 → `getAllData()` → `_getHtml()` → 渲染；失败显示错误页 |
| `_getHtml(data)` | 生成完整仪表板 HTML（所有 Tab） |
| `dispose()` | 清理：`currentPanel = null` |

### 辅助函数

| 函数 | 说明 |
|------|------|
| `getNonce()` | 生成 CSP nonce |
| `esc(s)` | HTML 转义 |
| `getCSS()` | 返回所有仪表板 CSS 样式（~200 行） |
| `getJS()` | 返回客户端 JS（图表绘制、Tab 切换、消息通信等，~400 行） |

## 消息处理

| 消息命令 | 处理动作 |
|----------|----------|
| `switchAccount` | 执行 `ghcpDashboard.switchAccount` |
| `manageAccounts` | 打开账户管理页 |
| `refresh` | 调用 `this.refresh()` |
| `signInGithub` | 请求 GitHub session 后刷新 |
| `signInMicrosoft` | 请求 Microsoft session 后刷新 |
| `openMcpConfig` | 用文本编辑器打开 mcp.json |
| `copyAccountInfo` | 复制文本到剪贴板 |
| `openSettings` | 打开 `editor.aiStats.enabled` 设置 |
| `openChatSession` | 4 种策略尝试重新打开聊天会话 |

## 仪表板 UI 结构

```
┌──────────────────────────────────────────────────┐
│ 🔷 GitHub Copilot Insights Dashboard    [Refresh] │
├──────────────────────────────────────────────────┤
│ [Overview] [Chat Sessions] [AI Stats] [Accounts]  │
│ [Models & MCP] [Info]                             │
├──────────────────────────────────────────────────┤
│                                                  │
│  Tab 1: Overview                                 │
│   ├─ Copilot Chat 卡片（版本/状态/扩展ID/账户）    │
│   ├─ 最近 5 条聊天会话（可打开）                   │
│   └─ AI 用量图表（接受率柱状图）                   │
│                                                  │
│  Tab 2: Chat Sessions                            │
│   ├─ 搜索/筛选/排序                               │
│   └─ 完整会话列表（可打开）                        │
│                                                  │
│  Tab 3: AI Stats                                 │
│   ├─ 时间段筛选 + 工作区筛选                       │
│   ├─ 计分板（总字符/接受率/会话数）                 │
│   ├─ 活动热力图                                   │
│   ├─ AI Rate 柱状图                              │
│   ├─ AI vs Typed 字符对比图                       │
│   ├─ 建议数图表 + 聊天编辑图表                     │
│   └─ 趋势分析子面板（周/月/30天）                  │
│                                                  │
│  Tab 4: Accounts                                 │
│   ├─ 左侧：所有账户列表（GitHub + Microsoft）       │
│   └─ 右侧：选中账户详情（信任扩展/MCP信任/策略）    │
│                                                  │
│  Tab 5: Models & MCP                             │
│   ├─ 语言模型列表（ID/厂商/家族/Token限制）         │
│   ├─ MCP 服务器列表                               │
│   ├─ 注册工具列表（MCP + 非MCP）                   │
│   └─ 上下文窗口 Token 分析                         │
│                                                  │
│  Tab 6: Info                                     │
│   └─ 版本/GitHub 链接/许可证信息                   │
│                                                  │
├──────────────────────────────────────────────────┤
│  🦊 CodeFox — "..."                               │
└──────────────────────────────────────────────────┘
```

## 设计要点

1. **单例模式**：`currentPanel` 确保只有一个仪表板实例
2. **加载动画**：每次刷新先显示狐狸转圈 + 随机励志消息（2 秒轮换）
3. **错误页面**：数据获取失败显示友好错误页，含错误详情 + 解决建议 + 重试按钮
4. **空状态引导**：无账户/无 Copilot 时显示操作引导按钮
5. **客户端图表**：所有图表（柱状图/热力图/折线图）由纯 JS 在浏览器端绘制
6. **可折叠区域**：AI Stats 中各图表支持折叠/展开
7. **i18n**：Tab 名称、标签、按钮、空状态文字均通过 `vscode.l10n.t()` 翻译
