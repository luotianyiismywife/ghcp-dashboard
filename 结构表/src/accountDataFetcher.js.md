# 数据获取层 — `src/accountDataFetcher.js`

对应源码文件：`src/accountDataFetcher.js`

## 职责

整个扩展的**核心模块**（约 1600 行），纯静态类，负责从 VS Code API 和本地 SQLite 数据库获取所有数据。

## 类结构

```javascript
class AccountDataFetcher {
    // 所有方法均为 static
}
```

## 内部状态

| 属性 | 类型 | 说明 |
|------|------|------|
| `_stateDbContentCache` | `string\|null` | 全局 state.vscdb 内容缓存 |
| `_stateDbCacheTimestamp` | `number` | 缓存时间戳（3s 有效期） |
| `_stateDbCachePath` | `string\|null` | 缓存对应的文件路径 + 编码 |

## 函数清单

### 私有方法（`_` 前缀）

| 方法 | 返回 | 说明 |
|------|------|------|
| `_getStateDbPath()` | `string` | 返回全局 state.vscdb 绝对路径（跨平台） |
| `_getStateDbContent(encoding)` | `string\|null` | 读取全局 state.vscdb 文件内容（带 3 秒缓存） |
| `_clearCache()` | `void` | 清除 state DB 缓存，每次 getAllData() 开始时调用 |
| `_getCopilotAccountFromStateDb()` | `string\|null` | 从 DB 扫描 `github.copilot-github` 键，提取 GitHub 账户名 |
| `_getTrustedExtensionsFromStateDb(labels, provider)` | `Object` | 读取 `github-<label>-usages` / `microsoft-<label>-usages` JSON |

### 公开方法（账户相关）

| 方法 | 返回 | 说明 |
|------|------|------|
| `getGitHubAccounts()` | `Promise<Array>` | 获取所有 GitHub 账户及会话状态 |
| `getMicrosoftAccounts()` | `Promise<Array>` | 获取所有 Microsoft 账户 |
| `getGitHubEnterpriseAccounts()` | `Promise<Array>` | 获取 GitHub Enterprise 账户 |
| `getActiveCopilotAccount()` | `Object\|null` | 通过信任扩展的 `lastUsed` 识别最近使用 Copilot Chat 的 GitHub 账户 |
| `getActiveGitHubAccount()` | `Promise<Object\|null>` | 3 层策略：① activeCopilotAccount ② 默认 Session ③ 信任扩展扫描 |
| `getAccountTrustedExtensions()` | `Object` | 从 state.vscdb 提取所有账户的信任扩展数据 + MCP 信任 + Copilot 策略 |

### 公开方法（MCP 相关）

| 方法 | 返回 | 说明 |
|------|------|------|
| `getMcpServerConfigsFromFiles()` | `Array` | 从 `.vscode/mcp.json` 等文件路径读取 MCP 配置（支持 JSONC 注释） |
| `getMcpServerConfigsFromSettings()` | `Array` | 从 VS Code 设置 `mcp.servers` 读取 MCP 配置 |
| `getAllMcpServers()` | `Array` | 合并文件 + 设置来源的 MCP 服务器，按名称去重 |

### 公开方法（Copilot / 模型 / 工具）

| 方法 | 返回 | 说明 |
|------|------|------|
| `getCopilotExtensionInfo()` | `Object` | 查询 GitHub.copilot 和 GitHub.copilot-chat 扩展的安装/活跃状态 |
| `getLanguageModels()` | `Promise<Array>` | 通过 `vscode.lm.selectChatModels()` 列出所有可用语言模型 |
| `getRegisteredTools()` | `Array` | 通过 `vscode.lm.tools` 列出所有已注册的 LM 工具 |

### 公开方法（统计数据）

| 方法 | 返回 | 说明 |
|------|------|------|
| `getAiStatsFromWorkspaceStorage()` | `Array` | 扫描所有工作区的 `state.vscdb` + WAL 文件，提取 `startTime/typedCharacters/aiCharacters/acceptedInlineSuggestions/chatEditCount`，按 startTime 去重 |
| `getChatSessionsFromWorkspaceStorage()` | `Array` | 从 3 个来源聚合：① agentSessions.model.cache ② `chatSessions/*.json` ③ `emptyWindowChatSessions/*.json` 及 `.jsonl`（JSONL 增量 patch 格式） |

### 公开方法（辅助）

| 方法 | 返回 | 说明 |
|------|------|------|
| `getWorkspaceInfo()` | `Object` | 当前工作区名称和文件夹列表 |
| `computeReadiness(data)` | `Object` | 检查账户、Copilot、MCP、模型等的状态，返回 `ready/warning/error` |
| `getContextAnalysis(models)` | `Promise<Array>` | 计算每个模型的上下文窗口 Token 分析（含工具定义 Token 数） |

### 主入口

| 方法 | 返回 | 说明 |
|------|------|------|
| `getAllData()` | `Promise<Object>` | 聚合所有数据，返回完整 data 对象（详见数据流图） |

## 数据源一览

| 来源 | 访问方式 | 用途 |
|------|----------|------|
| `vscode.authentication.getAccounts()` | API | GitHub / Microsoft / GHE 账户 |
| `vscode.authentication.getSession()` | API | 会话验证、获取 Token |
| `vscode.lm.selectChatModels()` | API | 语言模型列表 |
| `vscode.lm.tools` | API | 注册工具列表 |
| `vscode.extensions.getExtension()` | API | Copilot 扩展状态 |
| `vscode.workspace.workspaceFolders` | API | 工作区信息 |
| `vscode.workspace.getConfiguration()` | API | AI Stats 启用状态、MCP 设置 |
| 全局 `state.vscdb` | 文件扫描 | Copilot 账户、信任扩展、MCP 信任、策略数据 |
| 工作区 `state.vscdb` + WAL | 文件扫描 | AI 用量统计、Agent 会话 |
| 工作区 `chatSessions/*.json/.jsonl` | 文件读取 | 聊天会话历史 |
| `emptyWindowChatSessions/*.json/.jsonl` | 文件读取 | 空窗口聊天会话 |
| `.vscode/mcp.json` 等 | 文件读取 | MCP 服务器配置 |

## 设计要点

1. **state.vscdb 不直接用 SQLite 驱动**，而是二进制字符串扫描 + 正则匹配提取 JSON
2. **每刷新周期缓存**：`_getStateDbContent()` 有 3 秒缓存，避免同一刷新周期内反复读 50MB+ 文件
3. **AI Stats 去重**：用 `Map<startTime, record>` 去重，保留字符数最高的副本（WAL + DB 可能有旧页）
4. **JSONL 解析**：VS Code 新格式用增量 patch（kind=0 初始 / kind=1 用户 / kind=2 回复）
5. **活跃账户检测 3 层策略**：lastUsed 时间戳 → 默认 Session → 信任扩展扫描
