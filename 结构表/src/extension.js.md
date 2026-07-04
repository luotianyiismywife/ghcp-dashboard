# 扩展入口 — `src/extension.js`

对应源码文件：`src/extension.js`

## 职责

VS Code 扩展的激活入口。负责注册所有命令、视图、状态栏组件和事件监听器。

## 导出

| 导出名 | 类型 | 说明 |
|--------|------|------|
| `activate` | `function(context)` | VS Code 激活时调用 |
| `deactivate` | `function()` | VS Code 停用时调用（空实现） |

## `activate()` 注册清单

| 注册项 | 类型 | ID / 标识 | 说明 |
|--------|------|-----------|------|
| WebviewViewProvider | 视图 | `ghcpDashboard.sidebarView` | 侧边栏（`SidebarProvider`） |
| Command | 命令 | `ghcpDashboard.open` | 打开完整仪表板面板 |
| Command | 命令 | `ghcpDashboard.refresh` | 刷新侧边栏 + 仪表板 |
| Command | 命令 | `ghcpDashboard.switchAccount` | 显示账户操作 QuickPick |
| StatusBarItem | 状态栏 | `$(github) GHCP` | 右下角按钮，点击打开仪表板 |
| EventListener | 事件 | `onDidChangeSessions` | 认证变化时自动刷新 |

## `switchAccount` 命令的 QuickPick 选项

| 选项 | 动作 |
|------|------|
| $(github) Sign out of GitHub | 执行 `github.copilot.signOut` |
| $(account) Sign out of Microsoft | 打开账户管理页 |
| $(sign-in) Sign in to GitHub | 静默请求 GitHub session，触发登录 |
| $(key) Manage Accounts... | 打开 VS Code 账户管理 |

## i18n

所有用户可见字符串（通知、QuickPick 标签、状态栏）均通过 `vscode.l10n.t()` 包裹。
