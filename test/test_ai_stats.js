/*
 * ----------------------------------------------------------------------------
 * Created On  : 28-Feb-2026
 * Description : Test suite for GHCP Dashboard data validation.
 *               Reads VS Code state databases directly (no vscode module needed)
 *               and validates all data that the dashboard displays.
 *
 * Usage:  node test_ai_stats.js
 * ----------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0, skipped = 0;

function test(name, condition, detail) {
    if (condition) { passed++; console.log('  PASS: ' + name); }
    else { failed++; console.log('  FAIL: ' + name + (detail ? ' -- ' + detail : '')); }
}
function skip(name, reason) { skipped++; console.log('  SKIP: ' + name + ' -- ' + reason); }
function toLocal(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

// === 1. AI STATS DATA ===
console.log('\n=== 1. AI STATS DATA ===');
var wsDir = path.join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage');
var allRecords = [], seenTimes = new Set();
var folders = fs.readdirSync(wsDir);
for (var fi = 0; fi < folders.length; fi++) {
    var dbPath = path.join(wsDir, folders[fi], 'state.vscdb');
    if (!fs.existsSync(dbPath)) continue;
    try {
        var text = fs.readFileSync(dbPath, 'utf8');
        var marker = '[{"startTime"';
        var idx = 0;
        while ((idx = text.indexOf(marker, idx)) !== -1) {
            var depth2 = 0, end2 = -1;
            for (var i2 = idx; i2 < text.length; i2++) {
                if (text[i2] === '[') depth2++;
                if (text[i2] === ']') { depth2--; if (depth2 === 0) { end2 = i2; break; } }
            }
            if (end2 === -1) { idx += marker.length; continue; }
            var cleaned2 = text.slice(idx, end2 + 1).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
            try {
                var recs = JSON.parse(cleaned2);
                for (var ri = 0; ri < recs.length; ri++) {
                    var r = recs[ri];
                    if (r.typedCharacters === undefined) continue;
                    var key2 = r.startTime + '_' + (r.aiCharacters || 0);
                    if (seenTimes.has(key2)) continue;
                    seenTimes.add(key2);
                    var d2 = new Date(r.startTime);
                    allRecords.push({ startTime: r.startTime, date: toLocal(d2), typed: r.typedCharacters||0, ai: r.aiCharacters||0, sugg: r.acceptedInlineSuggestions||0, chat: r.chatEditCount||0 });
                }
            } catch(e) {}
            idx = end2 + 1;
        }
    } catch(e) {}
}
allRecords.sort(function(a,b) { return a.startTime - b.startTime; });

test('AI Stats: Records found', allRecords.length > 0, 'found ' + allRecords.length);
test('AI Stats: No negative typedCharacters', allRecords.every(function(r) { return r.typed >= 0; }));
test('AI Stats: No negative aiCharacters', allRecords.every(function(r) { return r.ai >= 0; }));
test('AI Stats: No negative suggestions', allRecords.every(function(r) { return r.sugg >= 0; }));
test('AI Stats: No negative chatEdits', allRecords.every(function(r) { return r.chat >= 0; }));
test('AI Stats: All have valid startTime', allRecords.every(function(r) { return typeof r.startTime === 'number' && r.startTime > 0; }));
test('AI Stats: All dates match YYYY-MM-DD', allRecords.every(function(r) { return /^\d{4}-\d{2}-\d{2}$/.test(r.date); }));
test('AI Stats: Sorted ascending', (function() { for (var i=1;i<allRecords.length;i++) { if (allRecords[i].startTime < allRecords[i-1].startTime) return false; } return true; })());
test('AI Stats: Dates use LOCAL timezone', (function() { for (var i=0;i<allRecords.length;i++) { var d=new Date(allRecords[i].startTime); if (allRecords[i].date !== toLocal(d)) return false; } return true; })());
test('AI Stats: No duplicates', allRecords.length === seenTimes.size);

var byDate = {};
for (var bi = 0; bi < allRecords.length; bi++) {
    var br = allRecords[bi];
    if (!byDate[br.date]) byDate[br.date] = { typed:0, ai:0, sessions:0, sugg:0, chat:0 };
    byDate[br.date].typed += br.typed;
    byDate[br.date].ai += br.ai;
    byDate[br.date].sessions++;
    byDate[br.date].sugg += br.sugg;
    byDate[br.date].chat += br.chat;
}
console.log('\n  Per-day summary:');
Object.keys(byDate).sort().forEach(function(d) {
    var v = byDate[d];
    var total = v.typed + v.ai;
    var pct = total > 0 ? Math.round(v.ai / total * 100) : 0;
    console.log('    ' + d + ': ai=' + v.ai + ' typed=' + v.typed + ' rate=' + pct + '% sessions=' + v.sessions + ' sugg=' + v.sugg + ' chat=' + v.chat);
});

var todayStr = toLocal(new Date());
console.log('\n  Today (' + todayStr + '): ' + (byDate[todayStr] ? JSON.stringify(byDate[todayStr]) : 'No data recorded yet (normal if no coding activity today)'));


// === 2. TRUSTED EXTENSIONS ===
console.log('\n=== 2. TRUSTED EXTENSIONS ===');
var globalDbPath = path.join(process.env.APPDATA, 'Code', 'User', 'globalStorage', 'state.vscdb');
var globalText = '';
try { globalText = fs.readFileSync(globalDbPath, 'utf8'); } catch(e) {}

function extractUsages(txt, provider) {
    var map = {};
    var regex = new RegExp(provider + '-([a-zA-Z0-9_.@-]+)-usages', 'g');
    var m;
    while ((m = regex.exec(txt)) !== null) {
        var label = m[1];
        var after = txt.slice(m.index + m[0].length, m.index + m[0].length + 5000);
        var jStart = after.indexOf('[');
        if (jStart === -1 || jStart > 50) continue;
        var depth3 = 0, jEnd = -1;
        for (var i3 = jStart; i3 < after.length; i3++) {
            if (after[i3] === '[') depth3++;
            if (after[i3] === ']') { depth3--; if (depth3 === 0) { jEnd = i3; break; } }
        }
        if (jEnd === -1) continue;
        try {
            var parsed = JSON.parse(after.slice(jStart, jEnd + 1).replace(/[\x00-\x1f\x7f-\x9f]/g, ''));
            if (!map[label]) { map[label] = parsed; }
            else { for (var pi=0;pi<parsed.length;pi++) { var entry=parsed[pi]; var existing=map[label].find(function(e){return e.extensionId===entry.extensionId;}); if(!existing) map[label].push(entry); else if(entry.lastUsed>(existing.lastUsed||0)) Object.assign(existing, entry); } }
        } catch(e) {}
    }
    return map;
}

var ghT = extractUsages(globalText, 'github');
var msT = extractUsages(globalText, 'microsoft');

test('Trusted: GitHub accounts found', Object.keys(ghT).length > 0, Object.keys(ghT).length + ' accounts');
test('Trusted: Microsoft accounts found', Object.keys(msT).length > 0, Object.keys(msT).length + ' accounts');

Object.keys(ghT).forEach(function(label) {
    var exts = ghT[label];
    test('Trusted: github/' + label + ' has valid data', exts.length > 0 && exts.every(function(e) { return e.extensionId && e.lastUsed > 0; }), exts.length + ' exts');
    exts.forEach(function(e) { console.log('    ' + e.extensionName + ': lastUsed=' + new Date(e.lastUsed).toISOString()); });
});
Object.keys(msT).forEach(function(label) {
    var exts = msT[label];
    test('Trusted: microsoft/' + label + ' has valid data', exts.length > 0 && exts.every(function(e) { return e.extensionId && e.lastUsed > 0; }), exts.length + ' exts');
    exts.forEach(function(e) { console.log('    ' + e.extensionName + ': lastUsed=' + new Date(e.lastUsed).toISOString()); });
});


// === 3. ACTIVE COPILOT ACCOUNT ===
console.log('\n=== 3. ACTIVE COPILOT ACCOUNT ===');
var best = null;
Object.keys(ghT).forEach(function(label) { var c = ghT[label].find(function(e){return e.extensionId==='github.copilot-chat';}); if (c && (!best || c.lastUsed > best.lastUsed)) best = { label:label, provider:'github', lastUsed:c.lastUsed }; });
Object.keys(msT).forEach(function(label) { var c = msT[label].find(function(e){return e.extensionId==='github.copilot-chat';}); if (c && (!best || c.lastUsed > best.lastUsed)) best = { label:label, provider:'microsoft', lastUsed:c.lastUsed }; });

test('Active Account: Detected', best !== null, best ? best.provider + '/' + best.label : '');
if (best) console.log('    Winner: ' + best.provider + '/' + best.label + ' lastUsed=' + new Date(best.lastUsed).toISOString());


// === 4. DATE RANGE LOGIC ===
console.log('\n=== 4. DATE RANGE LOGIC ===');
var now = new Date();
var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
var dow = today.getDay();
var monOff = dow === 0 ? 6 : dow - 1;
var weekStart = new Date(today); weekStart.setDate(today.getDate() - monOff);
var weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);

test('Week: Starts on Monday', weekStart.getDay() === 1, 'day=' + weekStart.getDay());
test('Week: Ends on Sunday', weekEnd.getDay() === 0, 'day=' + weekEnd.getDay());
test('Week: Today in range', today >= weekStart && today <= weekEnd);
console.log('    Week: ' + toLocal(weekStart) + ' to ' + toLocal(weekEnd) + ', Today: ' + toLocal(today));


// === 5. JSONC COMMENT STRIPPING ===
console.log('\n=== 5. JSONC COMMENT STRIPPING ===');
var jsoncRegex = /("(?:[^"\\]|\\.)*")|(\/\/.*$)|(\/\*[\s\S]*?\*\/)/gm;

var testJsonc = '{\n  // This is a comment\n  "servers": {\n    "test": {\n      "url": "https://example.com/api"\n    }\n  }\n}';
var stripped = testJsonc.replace(jsoncRegex, function(match, str) { return str ? str : ''; });
try {
    var parsed2 = JSON.parse(stripped);
    test('JSONC: URL preserved after comment stripping', parsed2.servers.test.url === 'https://example.com/api');
} catch(e) {
    test('JSONC: Parses correctly', false, e.message);
}

var testJsonc2 = '{ "gallery": "https://api.mcp.github.com" }\n';
try {
    var parsed3 = JSON.parse(testJsonc2.replace(jsoncRegex, function(match, str) { return str ? str : ''; }));
    test('JSONC: URL preserved without comment', parsed3.gallery === 'https://api.mcp.github.com');
} catch(e) {
    test('JSONC: URL parse', false, e.message);
}


// === SUMMARY ===
console.log('\n=== SUMMARY ===');
console.log('  ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
console.log('  Total: ' + (passed + failed + skipped) + ' tests\n');
if (failed > 0) process.exit(1);
