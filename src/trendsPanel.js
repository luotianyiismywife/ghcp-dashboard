/**
 * Trends & Reports panel for the GHCP Dashboard.
 * Provides weekly/monthly usage trend analysis with comparison periods and export (CSV/Markdown).
 *
 * @module trendsPanel
 * @see Used by dashboardPanel.js — getTrendsTabHTML() for the panel markup, getTrendsJS() for client-side logic
 */

/**
 * Returns the HTML for the Trends & Reports tab panel.
 * @param {Object} data - Full dashboard data from AccountDataFetcher.getAllData()
 * @param {boolean} aiStatsEnabled - Whether editor.aiStats.enabled is true
 * @returns {string} HTML string for the tab panel
 */
function getTrendsTabHTML(data, aiStatsEnabled) {
    const hasData = data.aiStats && data.aiStats.length > 0;

    return `
        <div class="card-body" id="panel-trends" style="font-size:11px;">
                <div class="card-body" style="padding:0;">
                    ${!aiStatsEnabled ? `<div class="info-banner warning" style="margin-bottom:8px;display:flex;align-items:flex-start;gap:6px;padding:8px 10px;border-radius:6px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);font-size:10px;"><span class="codicon codicon-warning" style="color:#f59e0b;flex-shrink:0;margin-top:1px"></span><div><strong style="color:#f59e0b">AI Stats disabled</strong> — <a href="#" data-command="openSettings" style="color:#f59e0b;text-decoration:underline;cursor:pointer">Enable</a></div></div>` : ''}
                    ${!hasData ? `<div class="empty-state" style="padding:16px;"><div class="empty-icon"><span class="codicon codicon-graph-line"></span></div><p style="font-size:11px;">No trend data</p></div>` : `
                    <div style="margin-bottom:10px;">
                        <div style="font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);margin-bottom:4px;">Compare</div>
                        <div class="period-filters" id="trendsPeriodFilters" style="flex-wrap:wrap;">
                            <button class="period-btn active" data-trends-period="week" style="font-size:10px;padding:3px 8px;">Week</button>
                            <button class="period-btn" data-trends-period="month" style="font-size:10px;padding:3px 8px;">Month</button>
                            <button class="period-btn" data-trends-period="last30" style="font-size:10px;padding:3px 8px;">30 Days</button>
                        </div>
                        <span class="period-label" id="trendsPeriodLabel" style="font-size:9px;display:block;margin-top:4px;"></span>
                    </div>

                    <!-- Scoreboard -->
                    <div id="trendsSummary" style="margin-bottom:12px;"></div>

                    <!-- Charts (compact) -->
                    <div class="card" style="margin-bottom:10px;">
                        <div class="card-header collapsible-header" data-collapse="trends-activeDays" style="cursor:pointer;padding:6px 10px;">
                            <div class="card-title" style="font-size:11px;"><span class="codicon codicon-calendar"></span> Active Days</div>
                            <div class="card-header-actions"><span class="collapse-chevron" data-collapse-icon="trends-activeDays" style="display:inline-block;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--vscode-descriptionForeground);transition:transform 0.15s;margin-left:6px;"></span></div>
                        </div>
                        <div data-collapse-body="trends-activeDays">
                            <div class="chart-legend" id="activeDaysChartLegend" style="font-size:9px;padding:2px 10px 4px;display:flex;flex-wrap:wrap;gap:6px;"></div>
                            <div style="overflow-x:auto;"><div id="trendsActiveDaysChart" style="min-width:400px;height:220px;position:relative;"></div></div>
                        </div>
                    </div>

                    <div class="card" style="margin-bottom:10px;">
                        <div class="card-header collapsible-header" data-collapse="trends-chars" style="cursor:pointer;padding:6px 10px;">
                            <div class="card-title" style="font-size:11px;"><span class="codicon codicon-code"></span> Characters</div>
                            <div class="card-header-actions"><span class="collapse-chevron" data-collapse-icon="trends-chars" style="display:inline-block;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--vscode-descriptionForeground);transition:transform 0.15s;transform:rotate(-90deg);margin-left:6px;"></span></div>
                        </div>
                        <div data-collapse-body="trends-chars" style="display:none;">
                            <div class="chart-legend" id="charsChartLegend" style="font-size:9px;padding:2px 10px 4px;display:flex;flex-wrap:wrap;gap:6px;"></div>
                            <div style="overflow-x:auto;"><div id="trendsCharsChart" style="min-width:400px;height:220px;position:relative;"></div></div>
                        </div>
                    </div>

                    <div class="card" style="margin-bottom:10px;">
                        <div class="card-header collapsible-header" data-collapse="trends-rate" style="cursor:pointer;padding:6px 10px;">
                            <div class="card-title" style="font-size:11px;"><span class="codicon codicon-pulse"></span> <span id="trendsChartTitle">AI Rate</span></div>
                            <div class="card-header-actions"><span class="collapse-chevron" data-collapse-icon="trends-rate" style="display:inline-block;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--vscode-descriptionForeground);transition:transform 0.15s;transform:rotate(-90deg);margin-left:6px;"></span></div>
                        </div>
                        <div data-collapse-body="trends-rate" style="display:none;">
                            <div class="chart-legend" id="trendsChartLegend" style="font-size:9px;padding:2px 10px 4px;display:flex;flex-wrap:wrap;gap:6px;"></div>
                            <div style="overflow-x:auto;"><div id="trendsLineChart" style="min-width:400px;height:220px;position:relative;"></div></div>
                        </div>
                    </div>

                    <div class="card" style="margin-bottom:10px;">
                        <div class="card-header collapsible-header" data-collapse="trends-activity" style="cursor:pointer;padding:6px 10px;">
                            <div class="card-title" style="font-size:11px;"><span class="codicon codicon-lightbulb"></span> Suggestions & Edits</div>
                            <div class="card-header-actions"><span class="collapse-chevron" data-collapse-icon="trends-activity" style="display:inline-block;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--vscode-descriptionForeground);transition:transform 0.15s;transform:rotate(-90deg);margin-left:6px;"></span></div>
                        </div>
                        <div data-collapse-body="trends-activity" style="display:none;">
                            <div class="chart-legend" id="activityChartLegend" style="font-size:9px;padding:2px 10px 4px;display:flex;flex-wrap:wrap;gap:6px;"></div>
                            <div style="overflow-x:auto;"><div id="trendsActivityChart" style="min-width:400px;height:220px;position:relative;"></div></div>
                        </div>
                    </div>

                    <!-- Comparison Table -->
                    <div class="card" style="margin-bottom:10px;">
                        <div class="card-header collapsible-header" data-collapse="trends-table" style="cursor:pointer;padding:6px 10px;">
                            <div class="card-title" style="font-size:11px;"><span class="codicon codicon-table"></span> Comparison</div>
                            <div class="card-header-actions"><span class="collapse-chevron" data-collapse-icon="trends-table" style="display:inline-block;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--vscode-descriptionForeground);transition:transform 0.15s;transform:rotate(-90deg);margin-left:6px;"></span></div>
                        </div>
                        <div data-collapse-body="trends-table" style="display:none;padding:0;">
                            <table class="data-table" id="trendsTable">
                                <thead><tr>
                                    <th>Metric</th>
                                    <th id="trendsColCurrent">Current</th>
                                    <th id="trendsColPrevious">Previous</th>
                                    <th>Change</th>
                                </tr></thead>
                                <tbody id="trendsTableBody"></tbody>
                            </table>
                        </div>
                    </div>
                    `}
                </div>
        </div>`;
}

/**
 * Returns the client-side JavaScript for the Trends tab.
 * Handles period comparison, aggregation, chart rendering, and export.
 * @returns {string} JavaScript code string
 */
function getTrendsJS() {
    return `
        // ========== TRENDS & REPORTS ==========
        var trendsPeriod = 'week';

        function getTrendsDateRanges(period) {
            var now = new Date();
            var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            var cur, prev;

            switch (period) {
                case 'week': {
                    var day = today.getDay(); var diff = day === 0 ? 6 : day - 1;
                    var weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - diff);
                    var weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
                    var prevStart = new Date(weekStart); prevStart.setDate(prevStart.getDate() - 7);
                    var prevEnd = new Date(weekStart); prevEnd.setDate(prevEnd.getDate() - 1);
                    cur = { start: toLocalDateStr(weekStart), end: toLocalDateStr(weekEnd), label: 'This Week' };
                    prev = { start: toLocalDateStr(prevStart), end: toLocalDateStr(prevEnd), label: 'Last Week' };
                    break;
                }
                case 'month': {
                    var monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                    var monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
                    var prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                    var prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
                    cur = { start: toLocalDateStr(monthStart), end: toLocalDateStr(monthEnd), label: 'This Month' };
                    prev = { start: toLocalDateStr(prevMonthStart), end: toLocalDateStr(prevMonthEnd), label: 'Last Month' };
                    break;
                }
                case 'last30': {
                    var s30 = new Date(today); s30.setDate(s30.getDate() - 29);
                    var p60 = new Date(today); p60.setDate(p60.getDate() - 59);
                    var p30 = new Date(today); p30.setDate(p30.getDate() - 30);
                    cur = { start: toLocalDateStr(s30), end: toLocalDateStr(today), label: 'Last 30 Days' };
                    prev = { start: toLocalDateStr(p60), end: toLocalDateStr(p30), label: 'Prior 30 Days' };
                    break;
                }
            }
            return { current: cur, previous: prev };
        }

        function aggregateTrendsPeriod(records) {
            var result = { typedCharacters: 0, aiCharacters: 0, acceptedInlineSuggestions: 0, chatEditCount: 0, sessions: 0, activeDays: 0 };
            var daySet = {};
            for (var i = 0; i < records.length; i++) {
                var r = records[i];
                result.typedCharacters += r.typedCharacters;
                result.aiCharacters += r.aiCharacters;
                result.acceptedInlineSuggestions += r.acceptedInlineSuggestions;
                result.chatEditCount += r.chatEditCount;
                result.sessions++;
                daySet[r.date] = true;
            }
            result.activeDays = Object.keys(daySet).length;
            result.totalChars = result.typedCharacters + result.aiCharacters;
            result.aiPct = result.totalChars > 0 ? Math.round(result.aiCharacters / result.totalChars * 100) : 0;
            return result;
        }

        function calcChange(cur, prev) {
            if (prev === 0 && cur === 0) return { pct: 0, direction: 'neutral' };
            if (prev === 0) return { pct: 100, direction: 'up' };
            var pct = Math.round((cur - prev) / prev * 100);
            return { pct: Math.abs(pct), direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral' };
        }

        function changeHtml(change, higherIsBetter) {
            if (change.direction === 'neutral') return '<span style="color:var(--vscode-descriptionForeground)">—</span>';
            var color = change.direction === 'up'
                ? (higherIsBetter ? '#22c55e' : '#f59e0b')
                : (higherIsBetter ? '#f59e0b' : '#22c55e');
            var arrow = change.direction === 'up' ? '▲' : '▼';
            return '<span style="color:' + color + ';font-weight:600">' + arrow + ' ' + change.pct + '%</span>';
        }

        function renderTrendsSummary(curAgg, prevAgg) {
            var el = document.getElementById('trendsSummary');
            if (!el) return;

            var metrics = [
                { label: 'AI Rate', cur: curAgg.aiPct, prev: prevAgg.aiPct, suffix: '%', better: true },
                { label: 'AI Chars', cur: curAgg.aiCharacters, prev: prevAgg.aiCharacters, suffix: '', better: true },
                { label: 'Typed', cur: curAgg.typedCharacters, prev: prevAgg.typedCharacters, suffix: '', better: false },
                { label: 'Suggestions', cur: curAgg.acceptedInlineSuggestions, prev: prevAgg.acceptedInlineSuggestions, suffix: '', better: true },
                { label: 'Chat Edits', cur: curAgg.chatEditCount, prev: prevAgg.chatEditCount, suffix: '', better: true },
                { label: 'Active Days', cur: curAgg.activeDays, prev: prevAgg.activeDays, suffix: '', better: true }
            ];

            el.innerHTML = '<div style="display:flex;flex-direction:column;gap:4px;">' + metrics.map(function(m) {
                var ch = calcChange(m.cur, m.prev);
                var pct = ch.pct;
                var dir = ch.direction;
                var arrow = dir === 'up' ? '\u25B2' : dir === 'down' ? '\u25BC' : '\u25CF';
                var color = dir === 'neutral' ? 'var(--vscode-descriptionForeground)' : (dir === 'up' ? '#22c55e' : '#ef4444');
                var val = m.suffix === '' ? m.cur.toLocaleString() : m.cur;
                return '<div style="display:flex;align-items:center;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(110,118,129,0.08);">' +
                    '<span style="font-size:10px;color:var(--vscode-descriptionForeground);">' + m.label + '</span>' +
                    '<span style="display:flex;align-items:center;gap:4px;">' +
                    '<strong style="font-size:12px;">' + val + m.suffix + '</strong>' +
                    '<span style="font-size:9px;color:' + color + ';">' + arrow + ' ' + pct + '%</span>' +
                    '</span></div>';
            }).join('') + '</div>';
        }

        function renderTrendsTable(curAgg, prevAgg, ranges) {
            var body = document.getElementById('trendsTableBody');
            var colCur = document.getElementById('trendsColCurrent');
            var colPrev = document.getElementById('trendsColPrevious');
            if (!body) return;
            if (colCur) colCur.textContent = ranges.current.label;
            if (colPrev) colPrev.textContent = ranges.previous.label;

            var rows = [
                { label: 'AI Code Rate', cur: curAgg.aiPct + '%', prev: prevAgg.aiPct + '%', change: calcChange(curAgg.aiPct, prevAgg.aiPct), better: true },
                { label: 'AI Characters', cur: curAgg.aiCharacters.toLocaleString(), prev: prevAgg.aiCharacters.toLocaleString(), change: calcChange(curAgg.aiCharacters, prevAgg.aiCharacters), better: true },
                { label: 'Typed Characters', cur: curAgg.typedCharacters.toLocaleString(), prev: prevAgg.typedCharacters.toLocaleString(), change: calcChange(curAgg.typedCharacters, prevAgg.typedCharacters), better: false },
                { label: 'Total Characters', cur: curAgg.totalChars.toLocaleString(), prev: prevAgg.totalChars.toLocaleString(), change: calcChange(curAgg.totalChars, prevAgg.totalChars), better: true },
                { label: 'Accepted Suggestions', cur: curAgg.acceptedInlineSuggestions.toLocaleString(), prev: prevAgg.acceptedInlineSuggestions.toLocaleString(), change: calcChange(curAgg.acceptedInlineSuggestions, prevAgg.acceptedInlineSuggestions), better: true },
                { label: 'Chat Edits', cur: curAgg.chatEditCount.toLocaleString(), prev: prevAgg.chatEditCount.toLocaleString(), change: calcChange(curAgg.chatEditCount, prevAgg.chatEditCount), better: true },
                { label: 'Sessions', cur: curAgg.sessions.toLocaleString(), prev: prevAgg.sessions.toLocaleString(), change: calcChange(curAgg.sessions, prevAgg.sessions), better: true },
                { label: 'Active Days', cur: curAgg.activeDays.toLocaleString(), prev: prevAgg.activeDays.toLocaleString(), change: calcChange(curAgg.activeDays, prevAgg.activeDays), better: true }
            ];

            body.innerHTML = rows.map(function(r) {
                return '<tr><td><strong>' + r.label + '</strong></td><td>' + r.cur + '</td><td>' + r.prev + '</td><td>' + changeHtml(r.change, r.better) + '</td></tr>';
            }).join('');
        }

        // ========== SHARED SVG LINE CHART BUILDER ==========
        function fmtDateLabel(dateStr, totalDates) {
            var dt = new Date(dateStr + 'T00:00:00');
            if (totalDates <= 7) return dt.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
            if (totalDates <= 31) return dt.getDate() + ' ' + dt.toLocaleDateString('en-US', { month: 'short' });
            return (dt.getMonth() + 1) + '/' + dt.getDate();
        }

        function buildSvgLineChart(containerId, legendId, series, curDates, prevDates, yLabel, yMax, formatVal, scaleMode) {
            var container = document.getElementById(containerId);
            var legendEl = document.getElementById(legendId);
            if (!container) return;
            container.innerHTML = '';

            // Legend
            if (legendEl) {
                legendEl.innerHTML = series.map(function(s) {
                    return '<span class="legend-item"><span class="legend-dot" style="background:' + s.color + ';opacity:' + (s.opacity || 1) + '"></span> ' + s.label + '</span>';
                }).join('');
            }

            var padL = 50, padR = 50, padT = 15, padB = 45;
            var maxLen = Math.max(curDates.length, prevDates.length);
            var containerW = container.clientWidth || 400;
            var minPointWidth = 40;
            var W = Math.max(containerW, maxLen * minPointWidth + padL + padR);
            container.style.width = W + 'px';
            var H = container.clientHeight || 220;
            var chartW = W - padL - padR;
            var chartH = H - padT - padB;

            // Find actual data max across all series
            var dataMax = 0;
            for (var si = 0; si < series.length; si++) {
                for (var vi = 0; vi < series[si].values.length; vi++) {
                    if (series[si].values[vi] > dataMax) dataMax = series[si].values[vi];
                }
            }
            if (dataMax === 0) dataMax = 10;

            // Apply scale mode — scaleMode always wins when provided
            // scaleMode: 'auto' (nice rounding), 'tight' (zoom to data), or numeric string (direct Y-max)
            if (scaleMode && scaleMode !== 'auto') {
                if (scaleMode === 'tight') {
                    yMax = Math.ceil(dataMax * 1.1) || 1;
                } else if (!isNaN(Number(scaleMode))) {
                    // Direct Y-max: use this exact value as the chart ceiling
                    yMax = Number(scaleMode);
                }
            } else if (!yMax) {
                // Default auto: nice ceiling
                var magnitude = Math.pow(10, Math.floor(Math.log10(dataMax)));
                var residual = dataMax / magnitude;
                var niceMultiplier;
                if (residual <= 1) niceMultiplier = 1;
                else if (residual <= 1.5) niceMultiplier = 1.5;
                else if (residual <= 2) niceMultiplier = 2;
                else if (residual <= 3) niceMultiplier = 3;
                else if (residual <= 5) niceMultiplier = 5;
                else if (residual <= 7.5) niceMultiplier = 7.5;
                else niceMultiplier = 10;
                yMax = Math.ceil(niceMultiplier * magnitude);
                if (yMax < dataMax * 1.2) yMax = Math.ceil(dataMax * 1.2);
            }
            // yMax must be at least 1 to avoid divide by zero
            if (!yMax || yMax <= 0) yMax = 10;

            var svg = '<svg width="' + W + '" height="' + H + '" style="overflow:visible;font-family:var(--vscode-font-family);">';

            // Y-axis grid lines — compute nice step size
            var yStepCount = 4;
            var yStepSize;
            {
                // Pick a nice step: round to 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000...
                var rawStep = yMax / yStepCount;
                if (rawStep < 1) rawStep = 1;
                var stepMag = Math.pow(10, Math.floor(Math.log10(rawStep)));
                var stepRes = rawStep / stepMag;
                if (stepRes <= 1) yStepSize = stepMag;
                else if (stepRes <= 2) yStepSize = 2 * stepMag;
                else if (stepRes <= 5) yStepSize = 5 * stepMag;
                else yStepSize = 10 * stepMag;
                // Recalculate yMax to align with steps
                yMax = yStepSize * yStepCount;
            }
            for (var yi = 0; yi <= yStepCount; yi++) {
                var yVal = yi * yStepSize;
                if (yVal > yMax) break;
                var yy = padT + chartH - (yVal / yMax * chartH);
                svg += '<line x1="' + padL + '" y1="' + yy + '" x2="' + (padL + chartW) + '" y2="' + yy + '" stroke="var(--vscode-panel-border)" stroke-dasharray="' + (yi === 0 ? '0' : '4,4') + '" />';
                svg += '<text x="' + (padL - 8) + '" y="' + (yy + 4) + '" text-anchor="end" fill="var(--vscode-descriptionForeground)" font-size="10">' + (formatVal ? formatVal(yVal) : yVal) + '</text>';
                svg += '<text x="' + (padL + chartW + 8) + '" y="' + (yy + 4) + '" text-anchor="start" fill="var(--vscode-descriptionForeground)" font-size="10">' + (formatVal ? formatVal(yVal) : yVal) + '</text>';
            }

            // X-axis: two rows of dates (current on top row, previous on bottom row)
            var labelStep = maxLen > 10 ? Math.ceil(maxLen / 6) : maxLen > 7 ? 2 : 1;
            var xAxisY1 = padT + chartH + 15; // current dates row
            var xAxisY2 = padT + chartH + 28; // previous dates row
            for (var xi = 0; xi < maxLen; xi++) {
                if (xi % labelStep !== 0 && xi !== maxLen - 1) continue;
                var xx = padL + (maxLen > 1 ? (xi / (maxLen - 1)) * chartW : chartW / 2);
                // Vertical tick mark
                svg += '<line x1="' + xx + '" y1="' + (padT + chartH) + '" x2="' + xx + '" y2="' + (padT + chartH + 4) + '" stroke="var(--vscode-panel-border)" />';
                // Current date label (blue)
                if (xi < curDates.length) {
                    svg += '<text x="' + xx + '" y="' + xAxisY1 + '" text-anchor="middle" fill="#58a6ff" font-size="9" font-weight="600">' + fmtDateLabel(curDates[xi], maxLen) + '</text>';
                }
                // Previous date label (amber)
                if (xi < prevDates.length) {
                    svg += '<text x="' + xx + '" y="' + xAxisY2 + '" text-anchor="middle" fill="#f59e0b" font-size="9" opacity="0.7">' + fmtDateLabel(prevDates[xi], maxLen) + '</text>';
                }
            }

            // Draw series
            for (var s = 0; s < series.length; s++) {
                var ser = series[s];
                var vals = ser.values;
                var dates = ser.dates;
                var color = ser.color;
                var opacity = ser.opacity || 1;
                var lineWidth = ser.lineWidth || 2.5;
                if (vals.length === 0) continue;

                var coords = [];
                for (var k = 0; k < vals.length; k++) {
                    var px = padL + (vals.length > 1 ? (k / (maxLen - 1)) * chartW : chartW / 2);
                    var py = padT + chartH - (Math.min(vals[k], yMax) / yMax * chartH);
                    coords.push({ x: px, y: py, val: vals[k], date: dates[k] });
                }

                // Area fill
                if (ser.area !== false) {
                    var areaPath = 'M' + coords[0].x + ',' + coords[0].y;
                    for (var a = 1; a < coords.length; a++) areaPath += ' L' + coords[a].x + ',' + coords[a].y;
                    areaPath += ' L' + coords[coords.length - 1].x + ',' + (padT + chartH) + ' L' + coords[0].x + ',' + (padT + chartH) + ' Z';
                    svg += '<path d="' + areaPath + '" fill="' + color + '" opacity="' + (opacity * 0.08) + '" />';
                }

                // Line with smooth curves
                var linePath = 'M' + coords[0].x + ',' + coords[0].y;
                for (var l = 1; l < coords.length; l++) linePath += ' L' + coords[l].x + ',' + coords[l].y;
                svg += '<path d="' + linePath + '" fill="none" stroke="' + color + '" stroke-width="' + lineWidth + '" opacity="' + opacity + '" stroke-linejoin="round" stroke-linecap="round" />';

                // Dots with value labels + tooltips
                for (var d = 0; d < coords.length; d++) {
                    svg += '<circle cx="' + coords[d].x + '" cy="' + coords[d].y + '" r="4" fill="' + color + '" opacity="' + opacity + '" stroke="var(--vscode-editor-background)" stroke-width="2">' +
                        '<title>' + coords[d].date + ': ' + (formatVal ? formatVal(coords[d].val) : coords[d].val.toLocaleString()) + (ser.tooltipSuffix || '') + '</title></circle>';
                    // Show value labels only on first series, and only if few points
                    if (s === 0 && maxLen <= 7) {
                        svg += '<text x="' + coords[d].x + '" y="' + (coords[d].y - 10) + '" text-anchor="middle" fill="' + color + '" font-size="8" font-weight="600" opacity="' + opacity + '">' + (formatVal ? formatVal(coords[d].val) : coords[d].val.toLocaleString()) + '</text>';
                    }
                }
            }

            svg += '</svg>';
            container.innerHTML = svg;
        }

        // ========== AGGREGATE BY DAY ==========
        function aggregateRecordsByDay(records) {
            var byDay = {};
            for (var i = 0; i < records.length; i++) {
                var r = records[i];
                if (!byDay[r.date]) byDay[r.date] = { ai: 0, typed: 0, sugg: 0, chats: 0 };
                byDay[r.date].ai += r.aiCharacters;
                byDay[r.date].typed += r.typedCharacters;
                byDay[r.date].sugg += r.acceptedInlineSuggestions;
                byDay[r.date].chats += r.chatEditCount;
            }
            return byDay;
        }

        // ========== RENDER ALL 3 CHARTS ==========
        function renderAllTrendsCharts(curRecords, prevRecords, ranges) {
            var curDates = getAllDatesInRange(ranges.current.start, ranges.current.end);
            var prevDates = getAllDatesInRange(ranges.previous.start, ranges.previous.end);
            var curByDay = aggregateRecordsByDay(curRecords);
            var prevByDay = aggregateRecordsByDay(prevRecords);

            // --- Chart 1: Characters (AI vs Typed) ---
            var curAiVals = [], curTypedVals = [], prevAiVals = [], prevTypedVals = [];
            for (var c1 = 0; c1 < curDates.length; c1++) {
                var cd1 = curByDay[curDates[c1]] || { ai: 0, typed: 0 };
                curAiVals.push(cd1.ai);
                curTypedVals.push(cd1.typed);
            }
            for (var p1 = 0; p1 < prevDates.length; p1++) {
                var pd1 = prevByDay[prevDates[p1]] || { ai: 0, typed: 0 };
                prevAiVals.push(pd1.ai);
                prevTypedVals.push(pd1.typed);
            }

            // Pre-compute all metric data sets for re-rendering
            window._trendsChartData = {
                curDates: curDates, prevDates: prevDates, ranges: ranges,
                curByDay: curByDay, prevByDay: prevByDay,
                curAiVals: curAiVals, curTypedVals: curTypedVals,
                prevAiVals: prevAiVals, prevTypedVals: prevTypedVals
            };
            renderAllFourCharts();
        }

        function renderAllFourCharts() {
            var d = window._trendsChartData;
            if (!d) return;
            var curDates = d.curDates, prevDates = d.prevDates, ranges = d.ranges;
            var curByDay = d.curByDay, prevByDay = d.prevByDay;
            var fmtK = function(v) { return v >= 1000 ? Math.round(v/1000) + 'k' : v.toString(); };

            // --- Chart 1: Characters (AI vs Typed) ---
            buildSvgLineChart('trendsCharsChart', 'charsChartLegend', [
                { label: 'AI Chars (' + ranges.current.label + ')', values: d.curAiVals, dates: curDates, color: '#22c55e', opacity: 1, lineWidth: 2.5, tooltipSuffix: ' AI chars' },
                { label: 'Typed (' + ranges.current.label + ')', values: d.curTypedVals, dates: curDates, color: '#58a6ff', opacity: 0.8, lineWidth: 2, tooltipSuffix: ' typed chars' },
                { label: 'AI Chars (' + ranges.previous.label + ')', values: d.prevAiVals, dates: prevDates, color: '#f59e0b', opacity: 0.4, lineWidth: 1.5, area: false, tooltipSuffix: ' AI chars' }
            ], curDates, prevDates, 'Characters', null, fmtK);

            // --- Chart 2: AI Code Rate % ---
            var curRateVals = [], prevRateVals = [];
            for (var c2 = 0; c2 < curDates.length; c2++) {
                var cd2 = curByDay[curDates[c2]] || { ai: 0, typed: 0 };
                var t2 = cd2.ai + cd2.typed;
                curRateVals.push(t2 > 0 ? Math.round(cd2.ai / t2 * 100) : 0);
            }
            for (var p2 = 0; p2 < prevDates.length; p2++) {
                var pd2 = prevByDay[prevDates[p2]] || { ai: 0, typed: 0 };
                var t2b = pd2.ai + pd2.typed;
                prevRateVals.push(t2b > 0 ? Math.round(pd2.ai / t2b * 100) : 0);
            }
            var rateTitle = document.getElementById('trendsChartTitle');
            if (rateTitle) rateTitle.textContent = 'AI Code Rate — ' + ranges.current.label + ' vs ' + ranges.previous.label;
            buildSvgLineChart('trendsLineChart', 'trendsChartLegend', [
                { label: ranges.current.label, values: curRateVals, dates: curDates, color: '#58a6ff', opacity: 1, lineWidth: 2.5, tooltipSuffix: '%' },
                { label: ranges.previous.label, values: prevRateVals, dates: prevDates, color: '#f59e0b', opacity: 0.5, lineWidth: 2, area: false, tooltipSuffix: '%' }
            ], curDates, prevDates, 'AI %', null, function(v) { return v + '%'; });

            // --- Chart 3: Suggestions & Chat Edits ---
            var curSuggVals = [], curChatVals = [], prevSuggVals = [];
            for (var c3 = 0; c3 < curDates.length; c3++) {
                var cd3 = curByDay[curDates[c3]] || { sugg: 0, chats: 0 };
                curSuggVals.push(cd3.sugg);
                curChatVals.push(cd3.chats);
            }
            for (var p3 = 0; p3 < prevDates.length; p3++) {
                var pd3 = prevByDay[prevDates[p3]] || { sugg: 0, chats: 0 };
                prevSuggVals.push(pd3.sugg);
            }
            buildSvgLineChart('trendsActivityChart', 'activityChartLegend', [
                { label: 'Suggestions (' + ranges.current.label + ')', values: curSuggVals, dates: curDates, color: '#a78bfa', opacity: 1, lineWidth: 2.5, tooltipSuffix: ' suggestions' },
                { label: 'Chat Edits (' + ranges.current.label + ')', values: curChatVals, dates: curDates, color: '#06b6d4', opacity: 0.9, lineWidth: 2, tooltipSuffix: ' chat edits' },
                { label: 'Suggestions (' + ranges.previous.label + ')', values: prevSuggVals, dates: prevDates, color: '#f59e0b', opacity: 0.4, lineWidth: 1.5, area: false, tooltipSuffix: ' suggestions' }
            ], curDates, prevDates, 'Count', null, null);

            // --- Chart 4: Active Days (Cumulative) ---
            var curAD = [], prevAD = [], cS = 0, pS = 0;
            for (var c4 = 0; c4 < curDates.length; c4++) {
                cS += curByDay[curDates[c4]] ? 1 : 0;
                curAD.push(cS);
            }
            for (var p4 = 0; p4 < prevDates.length; p4++) {
                pS += prevByDay[prevDates[p4]] ? 1 : 0;
                prevAD.push(pS);
            }
            buildSvgLineChart('trendsActiveDaysChart', 'activeDaysChartLegend', [
                { label: ranges.current.label + ' (' + cS + ' days)', values: curAD, dates: curDates, color: '#22c55e', opacity: 1, lineWidth: 2.5, tooltipSuffix: ' active days' },
                { label: ranges.previous.label + ' (' + pS + ' days)', values: prevAD, dates: prevDates, color: '#f59e0b', opacity: 0.5, lineWidth: 2, area: false, tooltipSuffix: ' active days' }
            ], curDates, prevDates, 'Days', null, null);
        }

        function updateTrends() {
            var ranges = getTrendsDateRanges(trendsPeriod);
            var curRecords = AI_STATS_RAW.filter(function(r) { return r.date >= ranges.current.start && r.date <= ranges.current.end; });
            var prevRecords = AI_STATS_RAW.filter(function(r) { return r.date >= ranges.previous.start && r.date <= ranges.previous.end; });
            var curAgg = aggregateTrendsPeriod(curRecords);
            var prevAgg = aggregateTrendsPeriod(prevRecords);

            renderTrendsSummary(curAgg, prevAgg);
            renderTrendsTable(curAgg, prevAgg, ranges);
            renderAllTrendsCharts(curRecords, prevRecords, ranges);

            var lbl = document.getElementById('trendsPeriodLabel');
            if (lbl) lbl.textContent = ranges.current.label + ' vs ' + ranges.previous.label;
        }

        // Period filter buttons
        document.querySelectorAll('[data-trends-period]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('[data-trends-period]').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                trendsPeriod = btn.dataset.trendsPeriod;
                updateTrends();
            });
        });

        // Initialize trends when side panel is first expanded (lazy)
        var trendsInitialized = false;
        var trendsSideTab = document.getElementById('trendsSidebarTab');
        if (trendsSideTab) {
            trendsSideTab.addEventListener('click', function() {
                if (!trendsInitialized) {
                    trendsInitialized = true;
                    setTimeout(function() { updateTrends(); }, 150);
                }
            });
        }

        // Info tooltip — position as fixed overlay
        var infoIcon = document.querySelector('.trends-info-icon');
        var infoTip = document.querySelector('.trends-info-tooltip');
        if (infoIcon && infoTip) {
            infoIcon.addEventListener('mouseenter', function() {
                var rect = infoIcon.getBoundingClientRect();
                infoTip.style.display = 'block';
                infoTip.style.left = (rect.right + 10) + 'px';
                infoTip.style.top = Math.max(8, rect.top - 40) + 'px';
            });
            infoIcon.addEventListener('mouseleave', function() {
                infoTip.style.display = 'none';
            });
        }
    `;
}

/**
 * Returns additional CSS for the Trends tab.
 * @returns {string} CSS string
 */
function getTrendsCSS() {
    return `
        .trends-summary { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; }
        .trends-card { background:var(--card-bg); border:1px solid var(--card-border); border-radius:8px; padding:14px 16px; text-align:center; }
        .trends-card-value { font-size:22px; font-weight:800; color:var(--vscode-foreground); }
        .trends-card-label { font-size:11px; font-weight:600; color:var(--vscode-descriptionForeground); text-transform:uppercase; letter-spacing:0.5px; margin-top:2px; }
        .trends-card-change { font-size:11px; margin-top:6px; color:var(--vscode-descriptionForeground); }
        .trends-info-icon { position:static; display:inline-flex; align-items:center; margin-left:6px; }
        .trends-info-tooltip { display:none; position:fixed; z-index:9999; width:360px; background:var(--vscode-editorHoverWidget-background, #1e1e1e); color:var(--vscode-editorHoverWidget-foreground, #ccc); border:1px solid var(--vscode-editorHoverWidget-border, #454545); border-radius:8px; padding:14px 18px; font-size:12px; font-weight:400; line-height:1.7; box-shadow:0 6px 20px rgba(0,0,0,0.35); white-space:normal; pointer-events:none; }
    `;
}

module.exports = { getTrendsTabHTML, getTrendsJS, getTrendsCSS };
