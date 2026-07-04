/*
 * AI Stats diagnostics — find WHERE VS Code is actually writing AI Stats,
 * and whether `editor.aiStats.enabled` is on. Read-only, no edits.
 *
 * Run:  node test_aistats_diagnostics.js
 */
const fs = require('fs');
const path = require('path');

const userDir = path.join(process.env.APPDATA, 'Code', 'User');
const wsStorage = path.join(userDir, 'workspaceStorage');
const globalDb = path.join(userDir, 'globalStorage', 'state.vscdb');
const settingsPath = path.join(userDir, 'settings.json');

function toLocal(ts) { var d = new Date(ts); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function scanBytes(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try { return fs.readFileSync(filePath).toString('latin1'); } catch (e) { return null; }
}
function newestStartTime(text) {
    if (!text) return 0;
    var re = /"startTime":(\d{13})/g;
    var newest = 0, m;
    while ((m = re.exec(text)) !== null) {
        var t = parseInt(m[1], 10);
        if (t > newest && t < 2_000_000_000_000) newest = t;
    }
    return newest;
}

console.log('\n=== 1. SETTINGS — editor.aiStats.enabled ===');
try {
    var raw = fs.readFileSync(settingsPath, 'utf8');
    var stripped = raw.replace(/("(?:[^"\\]|\\.)*")|(\/\/.*$)|(\/\*[\s\S]*?\*\/)/gm, function(_, s) { return s || ''; });
    var settings = JSON.parse(stripped);
    var key = 'editor.aiStats.enabled';
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
        console.log('  ' + key + ' = ' + settings[key]);
    } else {
        console.log('  ' + key + ' NOT SET in user settings (VS Code default applies)');
    }
} catch (e) {
    console.log('  Could not read user settings.json: ' + e.message);
}

console.log('\n=== 2. GLOBAL storage — aiStats / related keys ===');
{
    var text = scanBytes(globalDb);
    if (!text) console.log('  globalStorage/state.vscdb not found or unreadable');
    else {
        // Find any ItemTable-style key containing aiStats or editTelemetry
        var keys = new Set();
        var keyRe = /[a-zA-Z0-9._\-]*aiStats[a-zA-Z0-9._\-]*|[a-zA-Z0-9._\-]*editTelemetry[a-zA-Z0-9._\-]*/g;
        var m;
        while ((m = keyRe.exec(text)) !== null) keys.add(m[0]);
        if (keys.size === 0) console.log('  No aiStats/editTelemetry-related keys present in globalStorage');
        else {
            console.log('  Keys/strings matched (' + keys.size + '): ' + Array.from(keys).slice(0, 20).join(', '));
        }
        var newest = newestStartTime(text);
        if (newest > 0) console.log('  Newest startTime in globalStorage: ' + toLocal(newest) + ' (' + new Date(newest).toISOString() + ')');
        else console.log('  No startTime payload found in globalStorage');
    }
}

console.log('\n=== 3. WORKSPACE storage — newest startTime across all DBs + WALs ===');
{
    if (!fs.existsSync(wsStorage)) { console.log('  workspaceStorage missing'); }
    else {
        var newestPerFile = [];
        var folders = fs.readdirSync(wsStorage);
        for (var fi = 0; fi < folders.length; fi++) {
            var folder = folders[fi];
            var base = path.join(wsStorage, folder, 'state.vscdb');
            for (var src of [base, base + '-wal', base + '-shm']) {
                if (!fs.existsSync(src)) continue;
                var t = scanBytes(src);
                if (!t) continue;
                var newest = newestStartTime(t);
                if (newest > 0) newestPerFile.push({ src: src.replace(wsStorage, '…'), date: toLocal(newest), ts: newest, hasMarker: t.indexOf('[{"startTime":') !== -1 });
            }
        }
        newestPerFile.sort(function(a,b) { return b.ts - a.ts; });
        console.log('  Top 10 newest per file:');
        newestPerFile.slice(0, 10).forEach(function(r) { console.log('    ' + r.date + '  ' + (r.hasMarker ? '[array]' : '[stray]') + '  ' + r.src); });
        if (newestPerFile.length === 0) console.log('  No startTime payload found anywhere in workspace storage');
    }
}

console.log('\n=== 4. LENIENT scan — records with missing acceptedInlineSuggestions / chatEditCount ===');
{
    var lenient = /"startTime":(\d{13})\s*,\s*"typedCharacters":(\d+)\s*,\s*"aiCharacters":(\d+)([^}]{0,200})\}/g;
    var strict = /"startTime":(\d{13})\s*,\s*"typedCharacters":(\d+)\s*,\s*"aiCharacters":(\d+)\s*,\s*"acceptedInlineSuggestions":(\d+)\s*,\s*"chatEditCount":(\d+)\s*\}/g;
    var lenientCount = 0, strictCount = 0;
    var folders = fs.existsSync(wsStorage) ? fs.readdirSync(wsStorage) : [];
    var partialDates = new Set();
    for (var fi = 0; fi < folders.length; fi++) {
        var base = path.join(wsStorage, folders[fi], 'state.vscdb');
        for (var src of [base, base + '-wal']) {
            if (!fs.existsSync(src)) continue;
            var t = scanBytes(src);
            if (!t) continue;
            var cleaned = t.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
            var lm; lenient.lastIndex = 0;
            while ((lm = lenient.exec(cleaned)) !== null) {
                lenientCount++;
                // Was the same record matched by strict? Check if the tail contains both keys
                var tail = lm[4];
                if (tail.indexOf('"acceptedInlineSuggestions"') === -1 || tail.indexOf('"chatEditCount"') === -1) {
                    partialDates.add(toLocal(parseInt(lm[1], 10)));
                }
            }
            var sm; strict.lastIndex = 0;
            while ((sm = strict.exec(cleaned)) !== null) strictCount++;
        }
    }
    console.log('  Lenient matches (3 fields min): ' + lenientCount);
    console.log('  Strict  matches (5 fields):     ' + strictCount);
    console.log('  Records the strict regex MISSES: ' + (lenientCount - strictCount));
    if (partialDates.size > 0) console.log('  Dates with partial records: ' + Array.from(partialDates).sort().join(', '));
}

console.log('\n=== DONE ===');
