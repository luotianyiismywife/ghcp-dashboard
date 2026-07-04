# 趋势分析面板 — `src/trendsPanel.js`

对应源码文件：`src/trendsPanel.js`

## 职责

仪表板中 Trends & Reports 标签页的实现模块。提供周/月/30 天维度的使用趋势分析，支持对比期和导出。

## 导出函数

```javascript
module.exports = { getTrendsTabHTML, getTrendsJS, getTrendsCSS };
```

## 函数清单

| 函数 | 返回 | 说明 |
|------|------|------|
| `getTrendsTabHTML(data, aiStatsEnabled)` | `string` | 趋势标签页的完整 HTML |
| `getTrendsJS()` | `string` | 客户端 JS（图表渲染、周期切换、导出 CSV/Markdown） |
| `getTrendsCSS()` | `string` | 趋势页面样式 |

## 外部依赖

```javascript
const vscode = require('vscode');  // 仅用于 vscode.l10n.t()
```

## 客户端 JS 子功能

| 功能 | 说明 |
|------|------|
| `renderTrendsSummary()` | 渲染计分板（当前 vs 上一期的关键指标对比） |
| `renderAllFourCharts()` | 渲染 4 个图表（活跃天数/字符数/AI Rate/建议与编辑） |
| `renderTrendsTable()` | 渲染对比表格 |
| `toggleCollapse()` | 折叠/展开图表区域 |
| `exportCSV()` / `exportMarkdown()` | 导出数据 |

## UI 结构

```
┌─ Trends & Reports ──────────────────────────┐
│  Compare: [Week] [Month] [30 Days]          │
│                                              │
│  📊 计分板（当前 vs 上一期）                  │
│  ┌──────────────────────────────────┐       │
│  │ 📅 Active Days (柱状图)          │       │
│  ├──────────────────────────────────┤       │
│  │ 💻 Characters (柱状图)           │       │
│  ├──────────────────────────────────┤       │
│  │ 📈 AI Rate (折线图)              │       │
│  ├──────────────────────────────────┤       │
│  │ 💡 Suggestions & Edits (柱状图)   │       │
│  └──────────────────────────────────┘       │
│                                              │
│  📋 Comparison Table                         │
│  ┌─────────┬────────┬────────┬──────┐       │
│  │ Metric  │Current │Previous│Change│       │
│  ├─────────┼────────┼────────┼──────┤       │
│  │ ...     │ ...    │ ...    │ ...  │       │
│  └─────────┴────────┴────────┴──────┘       │
└──────────────────────────────────────────────┘
```

## 设计要点

1. **对比分析**：自动将当前周期与上一周期（本周 vs 上周、本月 vs 上月）对比
2. **折叠面板**：每个图表区域可折叠
3. **导出功能**：支持 CSV 和 Markdown 格式导出
4. **嵌入仪表板**：当前 Trends 标签页内容嵌入在 AI Stats 标签页内，非常独立 Tab
5. **i18n**：标签、按钮、表头通过 `vscode.l10n.t()` 翻译
