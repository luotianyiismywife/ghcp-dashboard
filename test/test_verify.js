/**
 * GHCP Dashboard — Automated Verification Script
 * Verifies syntax, structure, and key functions of all source files.
 * 
 * Run: node test_verify.js
 */
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const results = { passed: 0, failed: 0, tests: [] };

function test(name, fn) {
    try {
        fn();
        results.passed++;
        results.tests.push({ name, status: '✅ PASS' });
    } catch (e) {
        results.failed++;
        results.tests.push({ name, status: '❌ FAIL', error: e.message });
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

// ═══════════════════════════════════════════
// 1. SYNTAX VERIFICATION
// ═══════════════════════════════════════════
const files = ['extension.js', 'accountDataFetcher.js', 'dashboardPanel.js', 'sidebarProvider.js'];

for (const file of files) {
    test(`Syntax: ${file} parses without errors`, () => {
        const code = fs.readFileSync(path.join(srcDir, file), 'utf8');
        // Use Function constructor to check syntax (doesn't execute)
        // We wrap in try to catch SyntaxError
        try {
            new Function(code);
        } catch (e) {
            if (e instanceof SyntaxError) throw e;
            // ReferenceError for 'require'/'vscode' is OK — means syntax is valid
        }
    });
}

// ═══════════════════════════════════════════
// 2. EXTENSION.JS CHECKS
// ═══════════════════════════════════════════
test('extension.js: exports activate and deactivate', () => {
    const code = fs.readFileSync(path.join(srcDir, 'extension.js'), 'utf8');
    assert(code.includes('module.exports = { activate, deactivate }'), 'Missing module.exports');
    assert(code.includes('function activate(context)'), 'Missing activate function');
    assert(code.includes('function deactivate()'), 'Missing deactivate function');
});

test('extension.js: activate has try/catch', () => {
    const code = fs.readFileSync(path.join(srcDir, 'extension.js'), 'utf8');
    const activateBody = code.substring(code.indexOf('function activate(context)'));
    assert(activateBody.includes('} catch (e) {'), 'activate() missing try/catch');
    assert(activateBody.includes('Failed to activate extension'), 'Missing activation error message');
});

test('extension.js: open command has try/catch', () => {
    const code = fs.readFileSync(path.join(srcDir, 'extension.js'), 'utf8');
    assert(code.includes("try { DashboardPanel.createOrShow"), 'Open command missing try/catch');
});

test('extension.js: refresh command has try/catch', () => {
    const code = fs.readFileSync(path.join(srcDir, 'extension.js'), 'utf8');
    const refreshSection = code.substring(code.indexOf("'ghcpDashboard.refresh'"));
    assert(refreshSection.includes('try {'), 'Refresh command missing try/catch');
});

test('extension.js: switchAccount signOut has try/catch', () => {
    const code = fs.readFileSync(path.join(srcDir, 'extension.js'), 'utf8');
    assert(code.includes("try { await vscode.commands.executeCommand('github.copilot.signOut')"), 'signOut missing try/catch');
});

test('extension.js: onDidChangeSessions has try/catch', () => {
    const code = fs.readFileSync(path.join(srcDir, 'extension.js'), 'utf8');
    assert(code.includes('Auth change handler error'), 'onDidChangeSessions missing error handling');
});

test('extension.js: registers 3 commands', () => {
    const code = fs.readFileSync(path.join(srcDir, 'extension.js'), 'utf8');
    assert(code.includes("'ghcpDashboard.open'"), 'Missing open command');
    assert(code.includes("'ghcpDashboard.refresh'"), 'Missing refresh command');
    assert(code.includes("'ghcpDashboard.switchAccount'"), 'Missing switchAccount command');
});

// ═══════════════════════════════════════════
// 3. ACCOUNT DATA FETCHER CHECKS
// ═══════════════════════════════════════════
test('accountDataFetcher.js: exports AccountDataFetcher', () => {
    const code = fs.readFileSync(path.join(srcDir, 'accountDataFetcher.js'), 'utf8');
    assert(code.includes('module.exports = { AccountDataFetcher }'), 'Missing module.exports');
    assert(code.includes('class AccountDataFetcher'), 'Missing class definition');
});

test('accountDataFetcher.js: getCopilotExtensionInfo has try/catch', () => {
    const code = fs.readFileSync(path.join(srcDir, 'accountDataFetcher.js'), 'utf8');
    const method = code.substring(code.indexOf('static getCopilotExtensionInfo()'), code.indexOf('static getCopilotExtensionInfo()') + 1000);
    assert(method.includes('try {'), 'getCopilotExtensionInfo missing try/catch');
    assert(method.includes('Could not get Copilot extension info'), 'Missing error logging');
});

test('accountDataFetcher.js: getAllMcpServers has try/catch', () => {
    const code = fs.readFileSync(path.join(srcDir, 'accountDataFetcher.js'), 'utf8');
    const idx = code.indexOf('static getAllMcpServers()');
    assert(idx >= 0, 'getAllMcpServers not found');
    const method = code.substring(idx, idx + 800);
    assert(method.includes('try {'), 'getAllMcpServers missing try/catch');
    assert(method.includes('Could not get MCP servers'), 'Missing error logging');
});

test('accountDataFetcher.js: getWorkspaceInfo has try/catch', () => {
    const code = fs.readFileSync(path.join(srcDir, 'accountDataFetcher.js'), 'utf8');
    const method = code.substring(code.indexOf('static getWorkspaceInfo()'), code.indexOf('static getWorkspaceInfo()') + 500);
    assert(method.includes('try {'), 'getWorkspaceInfo missing try/catch');
    assert(method.includes('Could not get workspace info'), 'Missing error logging');
});

test('accountDataFetcher.js: computeReadiness has try/catch and null-safe access', () => {
    const code = fs.readFileSync(path.join(srcDir, 'accountDataFetcher.js'), 'utf8');
    const idx = code.indexOf('static computeReadiness(data)');
    assert(idx >= 0, 'computeReadiness not found');
    const method = code.substring(idx, idx + 3000);
    assert(method.includes('try {'), 'computeReadiness missing try/catch');
    assert(method.includes('(data.github || [])'), 'Missing null-safe access for data.github');
    assert(method.includes('Could not compute readiness'), 'Missing error logging');
});

test('accountDataFetcher.js: getAiStatsFromWorkspaceStorage uses regex parsing', () => {
    const code = fs.readFileSync(path.join(srcDir, 'accountDataFetcher.js'), 'utf8');
    assert(code.includes('const recordPattern ='), 'Missing regex pattern for aiStats');
    assert(code.includes('"startTime":(\\d+)'), 'Missing startTime regex capture');
});

test('accountDataFetcher.js: getChatSessionsFromWorkspaceStorage reads 3 sources', () => {
    const code = fs.readFileSync(path.join(srcDir, 'accountDataFetcher.js'), 'utf8');
    assert(code.includes('agentSessions.model.cache'), 'Missing source 1: agentSessions');
    assert(code.includes("source: 'chatSession'"), 'Missing source 2: chatSession');
    assert(code.includes("source: 'emptyWindow'"), 'Missing source 3: emptyWindow');
});

test('accountDataFetcher.js: chat sessions have chatType and agentName', () => {
    const code = fs.readFileSync(path.join(srcDir, 'accountDataFetcher.js'), 'utf8');
    assert(code.includes('chatType:'), 'Missing chatType field');
    assert(code.includes('agentName:'), 'Missing agentName field');
    assert(code.includes('canReopen:'), 'Missing canReopen field');
    assert(code.includes('isCurrentWorkspace:'), 'Missing isCurrentWorkspace field');
});

test('accountDataFetcher.js: agentSessions dedup keeps last occurrence', () => {
    const code = fs.readFileSync(path.join(srcDir, 'accountDataFetcher.js'), 'utf8');
    assert(code.includes('sessionMap.set(dedupeKey'), 'Missing sessionMap dedup logic');
    assert(code.includes('for (const [dedupeKey, sess] of sessionMap)'), 'Missing sessionMap iteration');
});

test('accountDataFetcher.js: getAllData aggregates all data', () => {
    const code = fs.readFileSync(path.join(srcDir, 'accountDataFetcher.js'), 'utf8');
    assert(code.includes('static async getAllData()'), 'Missing getAllData method');
    assert(code.includes('chatSessions: this.getChatSessionsFromWorkspaceStorage()'), 'Missing chatSessions in getAllData');
    assert(code.includes('data.readiness = this.computeReadiness(data)'), 'Missing readiness computation');
});

// ═══════════════════════════════════════════
// 4. DASHBOARD PANEL CHECKS
// ═══════════════════════════════════════════
test('dashboardPanel.js: exports DashboardPanel', () => {
    const code = fs.readFileSync(path.join(srcDir, 'dashboardPanel.js'), 'utf8');
    assert(code.includes('module.exports = { DashboardPanel }'), 'Missing module.exports');
    assert(code.includes('class DashboardPanel'), 'Missing class definition');
});

test('dashboardPanel.js: _update has loading screen', () => {
    const code = fs.readFileSync(path.join(srcDir, 'dashboardPanel.js'), 'utf8');
    assert(code.includes('Loading GHCP Dashboard'), 'Missing loading screen');
    assert(code.includes('loadingMessages'), 'Missing loading messages array');
    assert(code.includes('setInterval'), 'Missing message rotation interval');
});

test('dashboardPanel.js: _update has try/catch with error page', () => {
    const code = fs.readFileSync(path.join(srcDir, 'dashboardPanel.js'), 'utf8');
    assert(code.includes('Dashboard Could Not Load'), 'Missing error page heading');
    assert(code.includes('foxMessages'), 'Missing CodeFox error messages');
});

test('dashboardPanel.js: refresh has try/catch', () => {
    const code = fs.readFileSync(path.join(srcDir, 'dashboardPanel.js'), 'utf8');
    assert(code.includes("async refresh() { try { await this._update()"), 'refresh missing try/catch');
});

test('dashboardPanel.js: _handleMessage has try/catch', () => {
    const code = fs.readFileSync(path.join(srcDir, 'dashboardPanel.js'), 'utf8');
    assert(code.includes('Message handler error'), '_handleMessage missing error catch');
});

test('dashboardPanel.js: has all 7 tabs', () => {
    const code = fs.readFileSync(path.join(srcDir, 'dashboardPanel.js'), 'utf8');
    assert(code.includes("data-tab=\"copilot\""), 'Missing Copilot tab');
    assert(code.includes("data-tab=\"aistats\""), 'Missing AI Stats tab');
    assert(code.includes("data-tab=\"sessions\""), 'Missing Chat Sessions tab');
    assert(code.includes("data-tab=\"accounts\""), 'Missing Accounts tab');
    assert(code.includes("data-tab=\"models\""), 'Missing Models tab');
    assert(code.includes("data-tab=\"mcp\""), 'Missing MCP tab');
    assert(code.includes("data-tab=\"info\""), 'Missing Info tab');
});

test('dashboardPanel.js: openChatSession handler exists', () => {
    const code = fs.readFileSync(path.join(srcDir, 'dashboardPanel.js'), 'utf8');
    assert(code.includes("case 'openChatSession':"), 'Missing openChatSession handler');
    assert(code.includes('vscode-chat-session://local/'), 'Missing chat session URI strategy');
});

test('dashboardPanel.js: Chat Sessions tab has Filter By dropdown', () => {
    const code = fs.readFileSync(path.join(srcDir, 'dashboardPanel.js'), 'utf8');
    assert(code.includes('chatTypeFilter'), 'Missing chatTypeFilter dropdown');
    assert(code.includes('All Types'), 'Missing All Types option');
});

test('dashboardPanel.js: Chat Sessions workspace warning banner', () => {
    const code = fs.readFileSync(path.join(srcDir, 'dashboardPanel.js'), 'utf8');
    assert(code.includes('Session reopening is workspace-scoped'), 'Missing workspace warning banner');
});

test('dashboardPanel.js: footer has CodeFox sayings in sidebar only', () => {
    const code = fs.readFileSync(path.join(srcDir, 'dashboardPanel.js'), 'utf8');
    // Dashboard footer should NOT have foxQuote
    const footerSection = code.substring(code.indexOf('<footer class="footer">'));
    assert(!footerSection.includes('foxQuote1'), 'Dashboard footer should not have foxQuote');
});

// ═══════════════════════════════════════════
// 5. SIDEBAR PROVIDER CHECKS
// ═══════════════════════════════════════════
test('sidebarProvider.js: exports SidebarProvider', () => {
    const code = fs.readFileSync(path.join(srcDir, 'sidebarProvider.js'), 'utf8');
    assert(code.includes('module.exports = { SidebarProvider }'), 'Missing module.exports');
    assert(code.includes('class SidebarProvider'), 'Missing class definition');
});

test('sidebarProvider.js: _updateContent has loading screen with rotation', () => {
    const code = fs.readFileSync(path.join(srcDir, 'sidebarProvider.js'), 'utf8');
    assert(code.includes('loadingMessages'), 'Missing loading messages');
    assert(code.includes('setInterval'), 'Missing message rotation');
    assert(code.includes('CodeFox'), 'Missing CodeFox branding in loading');
});

test('sidebarProvider.js: _updateContent has error screen with CodeFox messages', () => {
    const code = fs.readFileSync(path.join(srcDir, 'sidebarProvider.js'), 'utf8');
    assert(code.includes('foxMessages'), 'Missing foxMessages array');
    assert(code.includes('fox-msg'), 'Missing fox-msg CSS class');
    assert(code.includes('sj.techconnect@gmail.com'), 'Missing contact email in error');
});

test('sidebarProvider.js: no duplicate refresh button', () => {
    const code = fs.readFileSync(path.join(srcDir, 'sidebarProvider.js'), 'utf8');
    const refreshButtonCount = (code.match(/data-command="refresh"/g) || []).length;
    // Should only be in the error retry button, not in main UI
    assert(refreshButtonCount <= 1, 'Duplicate refresh buttons found: ' + refreshButtonCount);
});

test('sidebarProvider.js: footer has CodeFox sayings', () => {
    const code = fs.readFileSync(path.join(srcDir, 'sidebarProvider.js'), 'utf8');
    assert(code.includes('foxSayings'), 'Missing foxSayings array');
    assert(code.includes('foxQuote1'), 'Missing foxQuote1');
    assert(code.includes('foxQuote2'), 'Missing foxQuote2');
});

// ═══════════════════════════════════════════
// 6. PACKAGE.JSON CHECKS  
// ═══════════════════════════════════════════
test('package.json: valid JSON and has required fields', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    assert(pkg.name, 'Missing name');
    assert(pkg.version, 'Missing version');
    assert(pkg.main === './src/extension.js', 'Wrong main entry point');
    assert(pkg.engines && pkg.engines.vscode, 'Missing vscode engine');
});

test('package.json: has all commands', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const cmds = pkg.contributes.commands.map(c => c.command);
    assert(cmds.includes('ghcpDashboard.open'), 'Missing open command');
    assert(cmds.includes('ghcpDashboard.refresh'), 'Missing refresh command');
    assert(cmds.includes('ghcpDashboard.switchAccount'), 'Missing switchAccount command');
});

test('package.json: has sidebar view', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const views = pkg.contributes.views['ghcp-dashboard'];
    assert(views && views.length > 0, 'Missing sidebar view');
    assert(views[0].id === 'ghcpDashboard.sidebarView', 'Wrong sidebar view ID');
});

test('package.json: description mentions sessions', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    assert(pkg.description.includes('session'), 'Description does not mention sessions');
});

// ═══════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════
console.log('\n═══════════════════════════════════════════');
console.log('  GHCP Dashboard — Verification Results');
console.log('═══════════════════════════════════════════\n');

for (const t of results.tests) {
    console.log(`  ${t.status}  ${t.name}${t.error ? '\n        → ' + t.error : ''}`);
}

console.log(`\n  ─────────────────────────────────────`);
console.log(`  Total: ${results.passed + results.failed} | Passed: ${results.passed} | Failed: ${results.failed}`);
console.log(`  ─────────────────────────────────────\n`);

process.exit(results.failed > 0 ? 1 : 0);
