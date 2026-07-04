/*
 * Focus probe: what AI Stats does the dashboard actually have for the
 * last week of May 2026 (2026-05-25 through 2026-05-31)?
 *
 * Runs the live fetcher (same code path the dashboard uses) and prints
 * per-day totals + per-workspace breakdown for that window. Also re-runs
 * the heatmap renderer against that data and shows which cells light up.
 *
 * Run:  node test_late_may_probe.js
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

// ---- Stub the vscode module so accountDataFetcher.js loads in plain Node.
const fakePath = require.resolve('./test_late_may_probe.js') + '::vscode';
require.cache[fakePath] = {
    exports: {
        workspace: { getConfiguration: () => ({ get: () => false }), workspaceFolders: [], name: '' },
        authentication: { getAccounts: async () => [] },
        lm: { tools: [] },
        extensions: { all: [], getExtension: () => null },
        env: { sessionId: '', machineId: '' },
        Uri: { file: p => ({ fsPath: p }) },
        EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} },
        commands: { executeCommand: async () => null, getCommands: async () => [] }
    }
};
const origLoad = Module._load;
Module._load = function(req, parent, ...rest) {
    if (req === 'vscode') return require.cache[fakePath].exports;
    return origLoad.call(this, req, parent, ...rest);
};

const { AccountDataFetcher } = require('./src/accountDataFetcher.js');

const records = AccountDataFetcher.getAiStatsFromWorkspaceStorage();
const chatSessions = AccountDataFetcher.getChatSessionsFromWorkspaceStorage();
console.log('\n=== TOTAL records from fetcher: ' + records.length + ' ===');
console.log('=== TOTAL chat sessions from fetcher: ' + chatSessions.length + ' ===');

// Window: 2026-05-25 .. 2026-05-31
const windowStart = '2026-05-25';
const windowEnd = '2026-05-31';
const inWindow = records.filter(r => r.date >= windowStart && r.date <= windowEnd);

console.log('\n=== Records in ' + windowStart + ' .. ' + windowEnd + ': ' + inWindow.length + ' ===');
if (inWindow.length === 0) {
    console.log('  (nothing — data simply does not exist for this date range)');
} else {
    inWindow.forEach(r => {
        console.log('  ' + r.date + '  ws=' + r.workspace + '  typed=' + r.typedCharacters + '  ai=' + r.aiCharacters + '  sugg=' + r.acceptedInlineSuggestions + '  chat=' + r.chatEditCount + '  startTime=' + new Date(r.startTime).toISOString());
    });
}

// Per-day aggregation in window
const byDate = {};
inWindow.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = { ai: 0, typed: 0, sessions: 0, sugg: 0, chat: 0 };
    byDate[r.date].ai += r.aiCharacters;
    byDate[r.date].typed += r.typedCharacters;
    byDate[r.date].sugg += r.acceptedInlineSuggestions;
    byDate[r.date].chat += r.chatEditCount;
    byDate[r.date].sessions++;
});
console.log('\n=== Per-day summary in window ===');
['2026-05-25','2026-05-26','2026-05-27','2026-05-28','2026-05-29','2026-05-30','2026-05-31'].forEach(d => {
    const v = byDate[d];
    if (!v) console.log('  ' + d + ': ----  (NO RECORDS)');
    else console.log('  ' + d + ': ai=' + v.ai + '  typed=' + v.typed + '  sessions=' + v.sessions + '  sugg=' + v.sugg + '  chat=' + v.chat);
});

// What date range does the heatmap actually cover?
function toLocal(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
const today = new Date(); today.setHours(0,0,0,0);
const startDate = new Date(today);
startDate.setDate(startDate.getDate() - (15 * 7) - today.getDay());
const lastCell = new Date(startDate);
lastCell.setDate(lastCell.getDate() + (16 * 7) - 1);
console.log('\n=== Heatmap window today (' + toLocal(today) + ') ===');
console.log('  Heatmap startDate: ' + toLocal(startDate));
console.log('  Heatmap lastCell:  ' + toLocal(lastCell));
console.log('  Window covers ' + windowStart + '..' + windowEnd + '? ' + (windowStart >= toLocal(startDate) && windowEnd <= toLocal(lastCell) ? 'YES — should be visible' : 'NO — outside grid'));

// Render heatmap with this real data and report which cells in the window are filled
const src = fs.readFileSync(path.join(__dirname, 'src', 'dashboardPanel.js'), 'utf8');
function sliceFn(name, nextMarker) {
    const s = src.indexOf('function ' + name + '(');
    const e = src.indexOf(nextMarker, s);
    return src.slice(s, e);
}
const toLocalSrc = sliceFn('toLocalDateStr', '        function getDateRangeForPeriod');
const heatmapSrc = sliceFn('renderAiHeatmap', '        function renderAiStatsChart');
const fakeEl = { innerHTML: '' };
const fakeDoc = { getElementById: id => id === 'aiHeatmap' ? fakeEl : null };
new Function('document', 'AI_STATS_RAW', 'CHAT_SESSIONS_RAW', toLocalSrc + '\n' + heatmapSrc + '\nrenderAiHeatmap();')(fakeDoc, records, chatSessions);

console.log('\n=== Heatmap rendered tooltips for ' + windowStart + '..' + windowEnd + ' ===');
const tipRe = /title="(2026-05-2[5-9]|2026-05-30|2026-05-31)[^"]*"/g;
let m, count = 0;
while ((m = tipRe.exec(fakeEl.innerHTML)) !== null) {
    console.log('  ' + m[0].slice(7, -1));
    count++;
}
console.log('  (' + count + ' tooltips found — should be 7 cells for May 25-31)');

console.log('\n=== Summary line in rendered heatmap ===');
const summaryMatch = fakeEl.innerHTML.match(/<div class="heatmap-summary">([\s\S]*?)<\/div>/);
if (summaryMatch) {
    // Strip HTML for readability
    console.log('  ' + summaryMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}
