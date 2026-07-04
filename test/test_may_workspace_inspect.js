/*
 * Inspect every workspace that has chat activity on May 28-31 and report
 * (1) the workspace name and (2) every AI Stats session timestamp it
 * contains (whole range, not just May 28-31).
 *
 * Run:  node test_may_workspace_inspect.js
 */
const fs = require('fs');
const path = require('path');

const wsDir = path.join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage');
const targetFolders = ['119d13d3', '5f13010a', 'a104a621'];

function getWsName(folder) {
    try {
        const wsJsonPath = path.join(wsDir, folder, 'workspace.json');
        if (!fs.existsSync(wsJsonPath)) return '(no workspace.json)';
        const j = JSON.parse(fs.readFileSync(wsJsonPath, 'utf8'));
        return j.folder || j.workspace || '(empty)';
    } catch (e) { return '(error: ' + e.message + ')'; }
}

function findFolder(prefix) {
    const all = fs.readdirSync(wsDir);
    return all.find(f => f.startsWith(prefix));
}

for (const prefix of targetFolders) {
    const folder = findFolder(prefix);
    if (!folder) { console.log('\n=== ' + prefix + ' ===\n  NOT FOUND'); continue; }
    console.log('\n=== ' + prefix + ' ===');
    console.log('  Workspace: ' + getWsName(folder));
    const base = path.join(wsDir, folder, 'state.vscdb');
    const sources = [base, base + '-wal'];
    const startTimes = new Set();
    for (const src of sources) {
        if (!fs.existsSync(src)) continue;
        const text = fs.readFileSync(src).toString('latin1');
        // Find all aiStats startTime entries (in the AI Stats payload, format "startTime":NNN,"typedCharacters":)
        const re = /"startTime":(\d{13}),"typedCharacters":/g;
        let m;
        while ((m = re.exec(text)) !== null) startTimes.add(parseInt(m[1], 10));
    }
    if (startTimes.size === 0) {
        console.log('  AI Stats sessions: NONE — VS Code never wrote an aiStats blob in this workspace');
    } else {
        console.log('  AI Stats sessions: ' + startTimes.size);
        Array.from(startTimes).sort().forEach(t => {
            const d = new Date(t);
            console.log('    ' + d.toISOString() + '  (local: ' + d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0') + ')');
        });
    }
}

// Also: check if any workspace has a chat session with code apply on May 28-31
console.log('\n=== Chat sessions with `lastMessageDate` in 2026-05-28..2026-05-31 ===');
const winStart = new Date('2026-05-28T00:00:00Z').getTime();
const winEnd = new Date('2026-06-01T00:00:00Z').getTime();
const allFolders = fs.readdirSync(wsDir);
const chatHits = [];
for (const f of allFolders) {
    const base = path.join(wsDir, f, 'state.vscdb');
    for (const src of [base, base + '-wal']) {
        if (!fs.existsSync(src)) continue;
        const text = fs.readFileSync(src).toString('latin1');
        const re = /"lastMessageDate":(\d{13})/g;
        let m;
        while ((m = re.exec(text)) !== null) {
            const t = parseInt(m[1], 10);
            if (t >= winStart && t <= winEnd) chatHits.push({ ts: t, folder: f.slice(0,8) });
        }
    }
}
const uniqHits = Array.from(new Set(chatHits.map(h => h.ts + '|' + h.folder))).map(s => {
    const [ts, folder] = s.split('|');
    return { ts: parseInt(ts), folder };
}).sort((a,b) => a.ts - b.ts);
if (uniqHits.length === 0) console.log('  NONE');
else {
    uniqHits.forEach(h => console.log('  ' + new Date(h.ts).toISOString() + '  folder=' + h.folder));
}
