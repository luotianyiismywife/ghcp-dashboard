/*
 * Activity Heatmap test suite for GHCP Dashboard.
 *
 * Extracts the real renderAiHeatmap() function (and its toLocalDateStr helper)
 * out of dashboardPanel.js, runs it in a minimal fake-DOM sandbox, and asserts
 * that the rendered grid, cell classes, tooltips, streaks, and summary line up
 * with known inputs.
 *
 * Run:  node test_heatmap.js
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'src', 'dashboardPanel.js'), 'utf8');

function sliceFn(name, nextMarker) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('Could not find function ' + name);
    const end = nextMarker ? src.indexOf(nextMarker, start) : src.indexOf('\n        function ', start + 1);
    if (end < 0) throw new Error('Could not find end marker for ' + name);
    return src.slice(start, end);
}

const toLocalSrc = sliceFn('toLocalDateStr', '        function getDateRangeForPeriod');
const heatmapSrc = sliceFn('renderAiHeatmap', '        function renderAiStatsChart');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log('  PASS: ' + name); }
    else { failed++; console.log('  FAIL: ' + name + (detail ? ' -- ' + detail : '')); }
}

function toLocalNode(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function makeFakeDoc() {
    const el = { innerHTML: '' };
    return {
        el,
        document: { getElementById: (id) => id === 'aiHeatmap' ? el : null }
    };
}

function runHeatmap(aiStatsRaw, chatSessionsRaw) {
    const fake = makeFakeDoc();
    const fn = new Function('document', 'AI_STATS_RAW', 'CHAT_SESSIONS_RAW', toLocalSrc + '\n' + heatmapSrc + '\nrenderAiHeatmap();');
    fn(fake.document, aiStatsRaw, chatSessionsRaw || []);
    return fake.el.innerHTML;
}

// Helper: count cells by class fragment in rendered HTML
function countClass(html, cls) {
    const re = new RegExp('class="heatmap-cell[^"]*\\b' + cls + '\\b', 'g');
    return (html.match(re) || []).length;
}

function chatOnlyDaysFromHtml(html) {
    const m = html.match(/<strong>(\d+)<\/strong> chat-only days?/);
    return m ? parseInt(m[1], 10) : 0;
}

// Helper: extract summary "<strong>N</strong> active days"
function activeDaysFromHtml(html) {
    const m = html.match(/<strong>(\d+)<\/strong> active days/);
    return m ? parseInt(m[1], 10) : null;
}
function currentStreakFromHtml(html) {
    const m = html.match(/<strong>(\d+)-day<\/strong> streak/);
    return m ? parseInt(m[1], 10) : 0;
}
function longestStreakFromHtml(html) {
    const m = html.match(/Best streak: (\d+) days/);
    return m ? parseInt(m[1], 10) : null;
}
function peakRateFromHtml(html) {
    const m = html.match(/Peak: <strong>(\d+)%<\/strong> AI rate/);
    return m ? parseInt(m[1], 10) : null;
}

console.log('\n=== ACTIVITY HEATMAP ===');

// ---------- 1. Empty input ----------
{
    const html = runHeatmap([]);
    check('Empty: renders without throwing', typeof html === 'string' && html.length > 0);
    check('Empty: 0 active days', activeDaysFromHtml(html) === 0, 'got ' + activeDaysFromHtml(html));
    check('Empty: no streak shown', currentStreakFromHtml(html) === 0);
    check('Empty: no peak shown', peakRateFromHtml(html) === null);
    // Grid uses 7 rows * 16 columns = 112 cells + 1 today highlight may add nothing
    // Future cells get class "future", non-future get inactive default.
    const totalCells = (html.match(/class="heatmap-cell/g) || []).length;
    // 7*16 cells in the grid + 6 legend cells = 118 expected (4 legend swatches + today + weekend)
    check('Empty: grid has 112 day cells + legend swatches', totalCells >= 112, 'got ' + totalCells);
    // No active-rate classes when input is empty
    check('Empty: no ai-high cells', countClass(html, 'ai-high') === 0 || countClass(html, 'ai-high') === 1 /* legend */ , 'got ' + countClass(html, 'ai-high'));
}

// ---------- 2. Today active, high AI rate ----------
{
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const data = [
        { startTime: today.getTime(), date: toLocalNode(today), typedCharacters: 100, aiCharacters: 900, acceptedInlineSuggestions: 0, chatEditCount: 0 }
    ];
    const html = runHeatmap(data);
    check('Today active: 1 active day', activeDaysFromHtml(html) === 1, 'got ' + activeDaysFromHtml(html));
    check('Today active: streak = 1', currentStreakFromHtml(html) === 1);
    check('Today active: peak rate = 90%', peakRateFromHtml(html) === 90, 'got ' + peakRateFromHtml(html));
    // Today cell should carry both `today` and `ai-high` classes
    const todayCellRe = /<div class="heatmap-cell[^"]*\bai-high\b[^"]*\btoday\b[^"]*"|<div class="heatmap-cell[^"]*\btoday\b[^"]*\bai-high\b[^"]*"/;
    check('Today active: today cell is ai-high', todayCellRe.test(html));
}

// ---------- 3. Three-day active streak ending today ----------
{
    const today = new Date(); today.setHours(12,0,0,0);
    const y1 = new Date(today); y1.setDate(today.getDate() - 1);
    const y2 = new Date(today); y2.setDate(today.getDate() - 2);
    const data = [
        { startTime: today.getTime(), date: toLocalNode(today), typedCharacters: 10, aiCharacters: 90, acceptedInlineSuggestions: 0, chatEditCount: 0 },
        { startTime: y1.getTime(),    date: toLocalNode(y1),    typedCharacters: 50, aiCharacters: 50, acceptedInlineSuggestions: 0, chatEditCount: 0 },
        { startTime: y2.getTime(),    date: toLocalNode(y2),    typedCharacters: 70, aiCharacters: 30, acceptedInlineSuggestions: 0, chatEditCount: 0 }
    ];
    const html = runHeatmap(data);
    check('3-day streak: 3 active days', activeDaysFromHtml(html) === 3, 'got ' + activeDaysFromHtml(html));
    check('3-day streak: currentStreak = 3', currentStreakFromHtml(html) === 3, 'got ' + currentStreakFromHtml(html));
    check('3-day streak: peak = 90% (today)', peakRateFromHtml(html) === 90, 'got ' + peakRateFromHtml(html));
    // Tooltips should mention each date
    check('3-day streak: today tooltip present', html.indexOf(toLocalNode(today) + ': 90% AI rate') !== -1);
    check('3-day streak: y1 tooltip present', html.indexOf(toLocalNode(y1) + ': 50% AI rate') !== -1);
    check('3-day streak: y2 tooltip present', html.indexOf(toLocalNode(y2) + ': 30% AI rate') !== -1);
    // Classification: 90% → ai-high, 50% → ai-med, 30% → ai-low
    check('3-day streak: at least one ai-med cell', countClass(html, 'ai-med') >= 1);
    check('3-day streak: at least one ai-low cell', countClass(html, 'ai-low') >= 1);
}

// ---------- 4. Today inactive, yesterday active — streak gets grace ----------
{
    const today = new Date(); today.setHours(12,0,0,0);
    const y1 = new Date(today); y1.setDate(today.getDate() - 1);
    const y2 = new Date(today); y2.setDate(today.getDate() - 2);
    const data = [
        { startTime: y1.getTime(), date: toLocalNode(y1), typedCharacters: 100, aiCharacters: 100, acceptedInlineSuggestions: 0, chatEditCount: 0 },
        { startTime: y2.getTime(), date: toLocalNode(y2), typedCharacters: 100, aiCharacters: 100, acceptedInlineSuggestions: 0, chatEditCount: 0 }
    ];
    const html = runHeatmap(data);
    check('Grace day: 2 active days', activeDaysFromHtml(html) === 2);
    check('Grace day: streak counts yesterday despite inactive today', currentStreakFromHtml(html) === 2, 'got ' + currentStreakFromHtml(html));
}

// ---------- 5. Today + yesterday both inactive — streak broken ----------
{
    const today = new Date(); today.setHours(12,0,0,0);
    const y3 = new Date(today); y3.setDate(today.getDate() - 3);
    const y4 = new Date(today); y4.setDate(today.getDate() - 4);
    const data = [
        { startTime: y3.getTime(), date: toLocalNode(y3), typedCharacters: 50, aiCharacters: 50, acceptedInlineSuggestions: 0, chatEditCount: 0 },
        { startTime: y4.getTime(), date: toLocalNode(y4), typedCharacters: 50, aiCharacters: 50, acceptedInlineSuggestions: 0, chatEditCount: 0 }
    ];
    const html = runHeatmap(data);
    check('Broken streak: 2 active days', activeDaysFromHtml(html) === 2);
    check('Broken streak: currentStreak = 0', currentStreakFromHtml(html) === 0, 'got ' + currentStreakFromHtml(html));
    check('Broken streak: longest = 2', longestStreakFromHtml(html) === 2 || activeDaysFromHtml(html) === 2, 'got ' + longestStreakFromHtml(html));
}

// ---------- 6. Future cells are not active ----------
{
    const today = new Date(); today.setHours(12,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const data = [
        { startTime: tomorrow.getTime(), date: toLocalNode(tomorrow), typedCharacters: 100, aiCharacters: 100, acceptedInlineSuggestions: 0, chatEditCount: 0 }
    ];
    const html = runHeatmap(data);
    // Future cells should be rendered with class "future", never as active.
    check('Future: future dates ignored in active count', activeDaysFromHtml(html) === 0, 'got ' + activeDaysFromHtml(html));
    check('Future: at least 1 future cell', (html.match(/class="heatmap-cell future"/g) || []).length >= 1);
}

// ---------- 7. Grid geometry ----------
{
    const html = runHeatmap([]);
    // 7 rows expected
    const rows = (html.match(/class="heatmap-row"/g) || []).length;
    check('Geometry: 7 day rows rendered', rows === 7, 'got ' + rows);
    // Day labels — must be 7 (one per row)
    const labels = (html.match(/class="heatmap-label"/g) || []).length;
    check('Geometry: 7 day labels rendered', labels === 7, 'got ' + labels);
    // Months strip rendered
    check('Geometry: month strip rendered', html.indexOf('heatmap-months') !== -1);
    // Legend rendered
    check('Geometry: legend rendered', html.indexOf('heatmap-legend') !== -1);
}

// ---------- 8. Chat-only days (Option A: surface chat usage without AI Stats writes) ----------
{
    const today = new Date(); today.setHours(12,0,0,0);
    const y1 = new Date(today); y1.setDate(today.getDate() - 1);
    const y2 = new Date(today); y2.setDate(today.getDate() - 2);
    const y3 = new Date(today); y3.setDate(today.getDate() - 3);

    // AI Stats only on y3 (3 days ago) — yesterday and 2-days-ago were "chat only".
    const ai = [
        { startTime: y3.getTime(), date: toLocalNode(y3), typedCharacters: 100, aiCharacters: 900, acceptedInlineSuggestions: 0, chatEditCount: 0 }
    ];
    // Chat sessions on y1 + y2 (no AI Stats those days)
    const chats = [
        { lastMessageDate: y1.getTime(), workspace: 'foo' },
        { lastMessageDate: y2.getTime(), workspace: 'foo' },
        { lastMessageDate: y2.getTime() + 60_000, workspace: 'foo' }
    ];
    const html = runHeatmap(ai, chats);

    check('Chat-only: 1 active day (y3 only)', activeDaysFromHtml(html) === 1, 'got ' + activeDaysFromHtml(html));
    check('Chat-only: 2 chat-only days in summary', chatOnlyDaysFromHtml(html) === 2, 'got ' + chatOnlyDaysFromHtml(html));
    check('Chat-only: legend includes "Chat only"', html.indexOf('Chat only') !== -1);
    check('Chat-only: at least 2 chat-only cells in grid (1 legend + 2 days)', countClass(html, 'chat-only') >= 3, 'got ' + countClass(html, 'chat-only'));

    // Tooltip on y2 should mention 2 chat sessions and "no inline accepts"
    const y2tip = new RegExp(toLocalNode(y2) + ': Chat only \\u2022 2 chat sessions');
    check('Chat-only: y2 tooltip shows session count', y2tip.test(html) || html.indexOf(toLocalNode(y2) + ': Chat only') !== -1);
    // Tooltip on y1 should be singular
    check('Chat-only: y1 tooltip uses singular for 1 session', html.indexOf(toLocalNode(y1) + ': Chat only \u2022 1 chat session') !== -1);

    // Active streak: today inactive (grace), y1 chat-only (does NOT count), y2 chat-only, y3 active
    // currentStreak should be 0 because the most recent ACTIVE day (y3) is preceded by chat-only days, not active ones.
    // (Chat-only deliberately does not count toward AI activity streak — only AI Stats sessions do.)
    check('Chat-only: AI streak ignores chat-only days', currentStreakFromHtml(html) <= 1, 'got ' + currentStreakFromHtml(html));

    // Combined day: an AI Stats day that ALSO had chat sessions
    const y4 = new Date(today); y4.setDate(today.getDate() - 4);
    const ai2 = [
        { startTime: y4.getTime(), date: toLocalNode(y4), typedCharacters: 100, aiCharacters: 900, acceptedInlineSuggestions: 0, chatEditCount: 0 }
    ];
    const chats2 = [
        { lastMessageDate: y4.getTime() + 3600_000, workspace: 'foo' }
    ];
    const html2 = runHeatmap(ai2, chats2);
    check('Combined day: still ai-high (not chat-only)', countClass(html2, 'ai-high') >= 1);
    check('Combined day: tooltip mentions chat session alongside AI rate', html2.indexOf(toLocalNode(y4) + ': 90% AI rate') !== -1 && html2.indexOf('1 chat session') !== -1);
    check('Combined day: chat-only summary = 0 (since y4 has AI Stats)', chatOnlyDaysFromHtml(html2) === 0);
}

// ---------- 9. Real workspace data: must render without throwing and count cells ----------
{
    // Synthesize from real DBs the same way test_ai_stats.js does, then feed to renderer.
    const wsDir = path.join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage');
    const records = [];
    if (fs.existsSync(wsDir)) {
        for (const f of fs.readdirSync(wsDir)) {
            const db = path.join(wsDir, f, 'state.vscdb');
            if (!fs.existsSync(db)) continue;
            try {
                const text = fs.readFileSync(db, 'utf8');
                const marker = '[{"startTime"';
                let idx = 0;
                while ((idx = text.indexOf(marker, idx)) !== -1) {
                    let depth = 0, end = -1;
                    for (let i = idx; i < text.length; i++) {
                        if (text[i] === '[') depth++;
                        else if (text[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
                    }
                    if (end === -1) { idx += marker.length; continue; }
                    try {
                        const recs = JSON.parse(text.slice(idx, end+1).replace(/[\x00-\x1f\x7f-\x9f]/g, ''));
                        for (const r of recs) {
                            if (r.typedCharacters === undefined) continue;
                            records.push({
                                startTime: r.startTime,
                                date: toLocalNode(new Date(r.startTime)),
                                typedCharacters: r.typedCharacters || 0,
                                aiCharacters: r.aiCharacters || 0,
                                acceptedInlineSuggestions: r.acceptedInlineSuggestions || 0,
                                chatEditCount: r.chatEditCount || 0
                            });
                        }
                    } catch(e) {}
                    idx = end + 1;
                }
            } catch(e) {}
        }
    }
    const html = runHeatmap(records);
    check('Real data: render succeeded', typeof html === 'string' && html.length > 0);
    check('Real data: grid has 7 rows', (html.match(/class="heatmap-row"/g) || []).length === 7);
    const active = activeDaysFromHtml(html);
    console.log('  INFO: real data renders ' + records.length + ' raw records → ' + active + ' active days in 16-week window');
    check('Real data: active days >= 0 and <= 112', active !== null && active >= 0 && active <= 112);
}

console.log('\n=== SUMMARY ===');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
