# GitHub Copilot Instructions — ghcp-dashboard

## 项目信息

- **项目**: ghcp-dashboard（GitHub Copilot Insights Dashboard）
- **类型**: VS Code 扩展（JavaScript, Node.js）
- **来源**: 源自 Jadhav Shubhamm（shujadhav），原仓库及作者账号已不复存在，当前为从 VSIX 提取的延续版本
- **许可证**: MIT

## 分支策略

- `dev` 分支用于日常开发，所有提交先推到 dev
- `master` 分支仅用于稳定版本，dev 测试通过后再合并到 master
- **禁止在开发过程中反复推送中间提交** — 完成任务后再一次性 commit + push
- **`.github/` 和 `结构表/` 内容仅在 dev 上存在**，合并到 master 时需手动排除：
  ```bash
  git checkout master
  git merge --no-commit dev
  git restore --staged .github/ 结构表/
  git checkout HEAD -- .github/ 结构表/
  git commit
  ```

## 技术栈

- 运行时: Node.js（VS Code 扩展宿主）
- API: VS Code Extension API（vscode.lm, vscode.authentication, state.vscdb）
- UI: WebView（HTML + CSS + Vanilla JS），无前端框架
- 数据源: VS Code 内部 SQLite 数据库（state.vscdb），通过二进制扫描 + 正则提取

## i18n / 本地化

- 代码中所有用户可见字符串使用 `vscode.l10n.t('...')` 包裹
- `package.nls.json` — 清单（package.json）的英文本地化文件（必须放在扩展根目录）
- `package.nls.zh-cn.json` — 清单的中文翻译
- `l10n/bundle.l10n.json` — 代码字符串的默认英文包（必须放在扩展根目录下的 l10n/）
- `l10n/bundle.l10n.zh-cn.json` — 代码字符串的中文翻译
- `package.json` 中必须有 `"l10n": "./l10n"` 字段，否则翻译不会加载
- 翻译文件的 JSON 必须严格有效，注意中文引号不能使用 ASCII `"`，改用「」或转义

## 项目结构

```
src/                          # 源码
  extension.js               # 扩展入口，注册命令和视图
  accountDataFetcher.js      # 核心数据获取层（~1600 行）
  dashboardPanel.js          # 完整仪表板 WebView 面板
  sidebarProvider.js         # 侧边栏 WebView 视图
  trendsPanel.js             # 趋势分析标签页
test/                         # 测试文件（独立 Node.js 脚本）
  test_verify.js
  test_ai_stats.js
  ...
l10n/                         # i18n 翻译包
  bundle.l10n.json
  bundle.l10n.zh-cn.json
```

## 代码风格

- 使用 Tab 缩进，Tab 宽度 4 空格（已在 workspace 设置中配置）
- 使用 CommonJS（require / module.exports），非 ES Modules
- HTML 模板通过模板字面量（template literals）嵌入 JavaScript

## 响应语言

- 使用中文（zh-cn）与用户交流
- 代码注释和字符串保留英文原文，翻译放在 l10n bundle 中
