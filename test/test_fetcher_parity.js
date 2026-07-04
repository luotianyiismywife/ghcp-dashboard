/*
 * Parity test: run getAiStatsFromWorkspaceStorage from the live fetcher
 * (stubbing the vscode module) and confirm it returns a SUPERSET of the
 * dates that the standalone probe in test_ai_stats.js finds, plus a clean
 * dedupe (no duplicate startTime).
 *
 * Run:  node test_fetcher_parity.js
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

// Stub the vscode module so accountDataFetcher.js loads in pure Node.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(req, parent, ...rest) {
    if (req === 'vscode') return require.resolve('./test_fetcher_parity.js');
    return origResolve.call(this, req, parent, ...rest);
};
require.cache[require.resolve('./test_fetcher_parity.js') + '::vscode'] = {
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
// Inject the stub into module cache under the bare name 'vscode'
const fakePath = require.resolve('./test_fetcher_parity.js') + '::vscode';
const origLoad = Module._load;
Module._load = function(req, parent, ...rest) {
    if (req === 'vscode') return require.cache[fakePath].exports;
    return origLoad.call(this, req, parent, ...rest);
};

const { AccountDataFetcher } = require('./src/accountDataFetcher.js');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log('  PASS: ' + name); }
    else { failed++; console.log('  FAIL: ' + name + (detail ? ' -- ' + detail : '')); }
}

console.log('\n=== FETCHER PARITY ===');

const records = AccountDataFetcher.getAiStatsFromWorkspaceStorage();
check('Fetcher returns array', Array.isArray(records));
check('Fetcher returned records', records.length > 0, 'count=' + records.length);

// No duplicate startTime in the fetcher output (dedupe map should guarantee this)
const seen = new Set();
let dup = 0;
for (const r of records) { if (seen.has(r.startTime)) dup++; seen.add(r.startTime); }
check('Fetcher: no duplicate startTime', dup === 0, dup + ' dupes');

// All records have all 5 expected numeric fields >= 0
const ok = records.every(r =>
    typeof r.startTime === 'number' && r.startTime > 0 &&
    typeof r.typedCharacters === 'number' && r.typedCharacters >= 0 &&
    typeof r.aiCharacters === 'number' && r.aiCharacters >= 0 &&
    typeof r.acceptedInlineSuggestions === 'number' && r.acceptedInlineSuggestions >= 0 &&
    typeof r.chatEditCount === 'number' && r.chatEditCount >= 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.date)
);
check('Fetcher: all records well-formed', ok);

// Records sorted ascending by startTime
let sorted = true;
for (let i = 1; i < records.length; i++) if (records[i].startTime < records[i-1].startTime) { sorted = false; break; }
check('Fetcher: sorted ascending', sorted);

// Independently enumerate the same dates from raw .vscdb files (mirrors test_ai_stats.js)
function toLocal(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
const wsDir = path.join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage');
const probeDates = new Set();
const probeStartTimes = new Set();
for (const f of fs.readdirSync(wsDir)) {
    const db = path.join(wsDir, f, 'state.vscdb');
    if (!fs.existsSync(db)) continue;
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
                probeStartTimes.add(r.startTime);
                probeDates.add(toLocal(new Date(r.startTime)));
            }
        } catch(e) {}
        idx = end + 1;
    }
}

const fetcherDates = new Set(records.map(r => r.date));
const fetcherStartTimes = new Set(records.map(r => r.startTime));

// Fetcher MUST include every startTime the standalone probe found in main DBs.
let missingTimes = 0;
for (const st of probeStartTimes) if (!fetcherStartTimes.has(st)) missingTimes++;
check('Fetcher is superset of standalone probe (by startTime)', missingTimes === 0, missingTimes + ' missing');

let missingDates = 0;
for (const d of probeDates) if (!fetcherDates.has(d)) missingDates++;
check('Fetcher is superset of standalone probe (by date)', missingDates === 0, missingDates + ' missing');

console.log('\n  Fetcher dates  : ' + Array.from(fetcherDates).sort().join(', '));
console.log('  Probe dates    : ' + Array.from(probeDates).sort().join(', '));
console.log('  Fetcher startTimes: ' + fetcherStartTimes.size + ' | Probe startTimes: ' + probeStartTimes.size);

console.log('\n=== SUMMARY ===');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
