/*
 * Byte-level search across EVERY state.vscdb / -wal / -shm for any 13-digit
 * timestamp that falls in 2026-05-28 .. 2026-05-31 (UTC).
 *
 * If anything is found, the dashboard's regex is missing it. If nothing is
 * found, VS Code never recorded any AI Stats session for those days.
 *
 * Run:  node test_may_28_31_raw_scan.js
 */
const fs = require('fs');
const path = require('path');

const wsDir = path.join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage');
const globalDb = path.join(process.env.APPDATA, 'Code', 'User', 'globalStorage', 'state.vscdb');

// UTC window with 1-day padding on each side to catch timezone edges
const winStart = new Date('2026-05-27T00:00:00Z').getTime();
const winEnd = new Date('2026-06-01T00:00:00Z').getTime();

const sources = [];
if (fs.existsSync(wsDir)) {
    for (const f of fs.readdirSync(wsDir)) {
        const base = path.join(wsDir, f, 'state.vscdb');
        for (const ext of ['', '-wal', '-shm']) {
            const p = base + ext;
            if (fs.existsSync(p)) sources.push({ path: p, label: f.slice(0, 8) + ext });
        }
    }
}
if (fs.existsSync(globalDb)) sources.push({ path: globalDb, label: 'globalStorage' });
for (const ext of ['-wal', '-shm']) {
    const p = globalDb + ext;
    if (fs.existsSync(p)) sources.push({ path: p, label: 'globalStorage' + ext });
}

console.log('\n=== Scanning ' + sources.length + ' files for any 13-digit ms-epoch in 2026-05-27..2026-06-01 UTC ===');

const re = /[12]\d{12}/g;
const hits = [];
for (const src of sources) {
    let text;
    try { text = fs.readFileSync(src.path).toString('latin1'); }
    catch (e) { continue; }
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
        const t = parseInt(m[0], 10);
        if (t >= winStart && t <= winEnd) {
            // Capture ~60 chars of surrounding context
            const ctxStart = Math.max(0, m.index - 30);
            const ctxEnd = Math.min(text.length, m.index + 30);
            const ctx = text.slice(ctxStart, ctxEnd).replace(/[\x00-\x1f\x7f-\x9f]/g, '·');
            hits.push({ ts: t, iso: new Date(t).toISOString(), src: src.label, ctx });
        }
    }
}

if (hits.length === 0) {
    console.log('  NO 13-digit timestamps found in 2026-05-27..2026-06-01 across any DB / WAL / SHM.');
    console.log('  Conclusion: VS Code did NOT record any AI Stats session for May 28-31.');
} else {
    // Dedupe by (ts, src)
    const seen = new Set();
    const unique = hits.filter(h => {
        const k = h.ts + '|' + h.src;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    console.log('  Found ' + unique.length + ' unique timestamp occurrences:\n');
    unique.sort((a, b) => a.ts - b.ts).forEach(h => {
        console.log('  ' + h.iso + '  src=' + h.src + '  ctx="' + h.ctx + '"');
    });
}
