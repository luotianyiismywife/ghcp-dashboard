# GitHub Copilot Insights Dashboard

> 在 VS Code 内部查看 GitHub Copilot 账户、AI 用量统计、聊天会话历史、MCP 服务器连接和语言模型——一站式面板。

> **来源：** 本扩展源自 [Jadhav Shubhamm](https://github.com/luotianyiismywife) 开发的 **GitHub Copilot Insights Dashboard** VS Code 扩展（v2.0.4）。原仓库已不复存在，当前仓库为其延续版本，遵循 MIT 许可协议。所有源代码版权归原作者所有。

[![Version](https://img.shields.io/badge/version-2.0.4-blue)](https://github.com/luotianyiismywife/ghcp-dashboard)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE.txt)
[![VS Code](https://img.shields.io/badge/vscode-%5E1.95.0-007ACC)](https://code.visualstudio.com)

---

## 项目概览

**ghcp-dashboard** 是一款 VS Code 扩展，通过读取 VS Code 原生 API 和本地 `state.vscdb` 数据库，将 GitHub Copilot 相关的各类信息整合到一个直观的可视化界面中。它包含一个**侧边栏概览**和一个**完整的仪表板面板**，无需离开编辑器即可掌握 Copilot 的全貌。

### 核心功能

| 功能 | 说明 |
|------|------|
| **账户管理** | 列出所有 GitHub、Microsoft、GitHub Enterprise 账户，自动检测当前 Copilot 活跃账户 |
| **AI 用量统计** | 读取 VS Code 的 `editor.aiStats` 数据，展示每日/每周/每月的 Completion 请求、字符数、活跃天数 |
| **聊天会话历史** | 浏览所有 Agent、Ask、Chat 及自定义 Agent 的会话记录，支持跨工作区搜索与重新打开 |
| **语言模型** | 列出 VS Code 当前可用的所有语言模型（通过 `vscode.lm` API） |
| **MCP 服务器** | 显示已配置的 MCP 服务器连接状态和配置来源（文件/设置） |
| **趋势与报表** | 提供周/月/30 天维度的活跃度趋势图，支持 CSV 和 Markdown 导出 |
| **上下文分析** | 计算各工作区的上下文窗口 Token 使用情况 |
| **系统就绪检查** | 检测 Copilot 扩展安装状态、认证状态、配置完整性 |

### 用户界面

- **侧边栏** (`Account Overview`)：紧凑展示本周 AI 指标、Copilot 状态、模型和 MCP 服务器概览
- **仪表板面板** (`ghcpDashboard.open`)：完整面板，包含 Copilot & Chat、AI Stats、Accounts、Models、MCP Servers、Trends 等多个标签页

---

## 项目结构

```
ghcp-dashboard/
├── .vscode/                  # VS Code 工作区设置
├── media/                    # 图标资源
│   ├── GHCP_dash_icon_circle.png
│   ├── GHCP_dash_icon_sjtc.png
│   └── GHCP_dash_icon_sjtc_1.png
├── src/                      # 源码
│   ├── extension.js          # 扩展入口，注册命令、侧边栏、认证监听
│   ├── accountDataFetcher.js # 核心数据获取模块（账户、MCP、AI Stats、模型等）
│   ├── dashboardPanel.js     # 完整仪表板 WebView 面板
│   ├── sidebarProvider.js    # 侧边栏 WebView 提供程序
│   └── trendsPanel.js        # 趋势与报表标签页
├── test_ai_stats.js          # AI Stats 数据验证测试
├── test_aistats_diagnostics.js
├── test_fetcher_parity.js    # 数据获取器一致性测试
├── test_heatmap.js           # 热力图数据测试
├── test_late_may_probe.js
├── test_may_28_31_raw_scan.js
├── test_may_workspace_inspect.js
├── test_verify.js            # 语法/结构/功能的综合验证测试
├── package.json
├── ghcp-dashboard.code-workspace
├── LICENSE.txt
└── README.md
```

---

## 安装

### 从 VSIX 安装（推荐）

从 [Releases](https://github.com/luotianyiismywife/ghcp-dashboard/releases) 页面下载最新的 `.vsix` 文件，然后在 VS Code 中执行：

```
code --install-extension ghcp-dashboard-2.0.4.vsix
```

或通过 VS Code 扩展面板 → `···` → `Install from VSIX...`。

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/luotianyiismywife/ghcp-dashboard.git
cd ghcp-dashboard

# 安装依赖
npm install

# 打包为 VSIX
npm run package
```

---

## 使用

### 命令

| 命令 | 触发方式 | 说明 |
|------|----------|------|
| `GHCP: Open Copilot Insights Dashboard` | 命令面板 / 快捷键 | 打开完整的仪表板面板 |
| `GHCP: Refresh Account Data` | 命令面板 / 侧边栏工具栏按钮 | 刷新所有数据 |
| `GHCP: Switch GitHub Account` | 命令面板 | 切换 GitHub 账户 |

### 侧边栏

点击活动栏中的 GitHub 图标即可展开侧边栏，快速查看本周 AI 用量、活跃账户和 Copilot 状态。

### 仪表板

通过 `GHCP: Open Copilot Insights Dashboard` 命令打开完整面板，包含以下标签页：

1. **Copilot & Chat** — 账户状态、会话历史、活跃模型
2. **AI Stats** — 详细的用量统计数据（图表化展示）
3. **Accounts** — 所有已登录的 GitHub/Microsoft/GHE 账户
4. **Models** — 当前可用的所有语言模型清单
5. **MCP Servers** — MCP 服务器配置与连接状态
6. **Trends** — 周/月/30 天趋势图表，支持导出

---

## 开发

### 技术栈

- **运行时**: Node.js (VS Code 扩展宿主)
- **API**: VS Code Extension API (`vscode.lm`, `vscode.authentication`, `state.vscdb`)
- **UI**: WebView (HTML + CSS + JavaScript)，使用 VS Code 原生设计语言
- **数据源**: VS Code 内部 SQLite 数据库 (`state.vscdb`)

### 本地调试

1. 在 VS Code 中打开项目文件夹
2. 按 `F5` 启动扩展开发宿主
3. 在新窗口中打开命令面板，运行 `GHCP: Open Copilot Insights Dashboard`

### 运行测试

```bash
# 语法与结构验证
node test_verify.js

# AI Stats 数据验证
node test_ai_stats.js

# 数据获取器一致性测试
node test_fetcher_parity.js
```

---

## 当前状态

- **版本**: 2.0.4（稳定版）
- **作者**: [Jadhav Shubhamm](https://github.com/luotianyiismywife)（AI Developer）
- **许可证**: MIT
- **兼容性**: VS Code `^1.95.0`
- **状态**: 功能完整，持续维护中

### 已知限制

- AI Stats 数据依赖 VS Code 的 `editor.aiStats.enabled` 设置，需手动开启
- `state.vscdb` 为 VS Code 内部 SQLite 数据库，格式可能随版本更新变化
- MCP 服务器状态为配置级检测，不含实时连接健康检查

---

## 贡献

欢迎提交 Issue 和 Pull Request。请确保：

1. 新功能附带相应的测试用例
2. 通过 `node test_verify.js` 验证
3. 遵循现有代码风格（Tab 缩进，4 空格宽度）

---

## 许可证

[MIT](LICENSE.txt) © 2026 Jadhav Shubhamm
