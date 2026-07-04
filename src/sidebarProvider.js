/*
 * ----------------------------------------------------------------------------
 * Author      : Jadhav Shubhamm
 * Role        : AI Developer
 * Created On  : 27-Feb-2026
 * Description : Sidebar webview provider for the GHCP Dashboard extension.
 *               Renders a compact sidebar view showing weekly AI metrics,
 *               Copilot Chat status, language models, and MCP servers.
 *
 *   Methods:
 *     resolveWebviewView() - Initializes the sidebar webview and message handler
 *     refresh()            - Re-fetches data and re-renders the sidebar
 *     _updateContent()     - Fetches data via AccountDataFetcher and renders HTML
 *     _getHtml()           - Generates the sidebar HTML with all sections
 *
 *   Helper Functions:
 *     getNonce()    - Generates a random nonce for CSP
 *     escapeHtml()  - HTML-escapes strings for safe rendering
 *
 * \u00a9 2026 All rights reserved.
 * ----------------------------------------------------------------------------
 */
const vscode = require('vscode');
const { AccountDataFetcher } = require('./accountDataFetcher');

class SidebarProvider {
    constructor(extensionUri, context) {
        this._extensionUri = extensionUri;
        this._context = context;
        this._view = null;
        this._hasLoadedOnce = false;
    }

    /**
     * Called by VS Code when the sidebar view becomes visible.
     * Initializes webview options, renders content, and sets up message handling.
     *
     * @param {vscode.WebviewView} webviewView - The webview view instance
     * @see Registered in extension.js via registerWebviewViewProvider()
     */
    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
        this._updateContent().catch(err => console.error('GHCP Sidebar: Failed to load initial data', err));

        // Auto-refresh when sidebar becomes visible (prevents showing stale/cached data)
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._updateContent().catch(err => console.error('GHCP Sidebar: Failed to refresh on visibility change', err));
            }
        });

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'openDashboard': vscode.commands.executeCommand('ghcpDashboard.open'); break;
                case 'switchAccount': vscode.commands.executeCommand('ghcpDashboard.switchAccount'); break;
                case 'refresh': this.refresh(); break;
                case 'manageAccounts': vscode.commands.executeCommand('workbench.action.accounts.show'); break;
                case 'signInGithub':
                    try { await vscode.authentication.getSession('github', ['user:email'], { createIfNone: true }); this.refresh(); } catch (e) { }
                    break;
                case 'signInMicrosoft':
                    try { await vscode.authentication.getSession('microsoft', ['openid', 'profile', 'email'], { createIfNone: true }); this.refresh(); } catch (e) { }
                    break;
                case 'openSettings':
                    vscode.commands.executeCommand('workbench.action.openSettings', 'editor.aiStats.enabled'); break;
                case 'openChatSession':
                    if (message.sessionId) {
                        const sid = message.sessionId;
                        const title = message.title || sid;
                        let opened = false;
                        try { const b64 = Buffer.from(sid).toString('base64'); const uri = vscode.Uri.parse('vscode-chat-session://local/' + b64); await vscode.commands.executeCommand('vscode.open', uri); opened = true; } catch (e) { /* continue */ }
                        if (!opened) { try { await vscode.commands.executeCommand('workbench.action.chat.openSession', sid); opened = true; } catch (e) { /* continue */ } }
                        if (!opened) { try { await vscode.commands.executeCommand('workbench.action.chat.open', { query: '', sessionId: sid }); opened = true; } catch (e) { /* continue */ } }
                        if (!opened) { try { await vscode.commands.executeCommand('workbench.action.chat.open'); } catch (e) { /* continue */ } vscode.window.showInformationMessage(vscode.l10n.t('Session: ') + title + vscode.l10n.t(' \u2014 Look for this session in the Chat sidebar.'), vscode.l10n.t('Copy Session ID')).then(choice => { if (choice === vscode.l10n.t('Copy Session ID')) vscode.env.clipboard.writeText(sid); }); }
                    } break;

            }
        });
    }

    /**
     * Re-fetches all data and re-renders the sidebar content.
     *
     * @see Called by extension.js on ghcpDashboard.refresh command and auth change events
     */
    async refresh() { if (this._view) await this._updateContent(); }

    /**
     * Fetches data from AccountDataFetcher.getAllData() and renders the sidebar HTML.
     * Shows error UI with retry button and contact info on failure.
     *
     * @see Called by resolveWebviewView() and refresh()
     */
    async _updateContent() {
        if (!this._view) return;

        // On refresh (not first load), briefly show refreshing state on button
        if (this._hasLoadedOnce) {
            try {
                await this._view.webview.postMessage({ command: 'showRefreshing' });
            } catch (e) { /* webview may not be ready */ }
        } else {
        // Show skeleton loading screen — section headers visible, content loading
        const loadingNonce = getNonce();
        const cspSrc = this._view.webview.cspSource;
        this._view.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSrc} 'unsafe-inline'; script-src 'nonce-${loadingNonce}'; font-src ${cspSrc};">
<style>
    body { padding:0; margin:0; font-family:var(--vscode-font-family); font-size:var(--vscode-font-size); color:var(--vscode-foreground); background:var(--vscode-sideBar-background); display:flex; flex-direction:column; height:100vh; overflow:hidden; }
    .scroll-body { flex:1; overflow-y:auto; padding:12px; }
    .sticky-footer { flex-shrink:0; padding:8px 12px 16px; border-top:1px solid var(--vscode-panel-border); background:var(--vscode-sideBar-background); }
    .section { margin-bottom:14px; }
    .section-header { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:var(--vscode-descriptionForeground); margin-bottom:6px; padding:4px 0; border-bottom:1px solid var(--vscode-panel-border); display:flex; align-items:center; gap:6px; }
    .skeleton { height:10px; background:rgba(110,118,129,0.12); border-radius:4px; animation:pulse 1.5s ease-in-out infinite; }
    .skeleton-row { display:flex; gap:6px; margin-bottom:6px; }
    .skeleton-card { flex:1; height:36px; background:rgba(110,118,129,0.08); border:1px solid var(--vscode-panel-border); border-radius:6px; animation:pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }
    .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:6px 14px; border:none; border-radius:4px; font-size:11px; font-weight:500; cursor:pointer; width:100%; margin-top:3px; }
    .btn-primary { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
    .footer-sig { text-align:center; font-size:9px; color:var(--vscode-descriptionForeground); }
    .footer-sig .sig-name { font-weight:600; font-size:10px; color:var(--vscode-foreground); display:block; }
    .footer-sig .sig-tagline { font-size:8px; display:block; margin:1px 0; }
    .footer-sig a { color:var(--vscode-textLink-foreground); text-decoration:none; }
    .loading-toast { margin:0 0 8px; padding:8px 10px; border-radius:6px; background:var(--vscode-input-background, rgba(110,118,129,0.08)); border:1px solid var(--vscode-panel-border); font-size:10px; color:var(--vscode-foreground); line-height:1.5; text-align:center; }
    .loading-toast .toast-fox { display:inline-block; font-size:14px; vertical-align:middle; margin-right:6px; animation:bounce 1.2s ease-in-out infinite; }
    @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
    .loading-toast .toast-msg { font-size:9px; color:var(--vscode-descriptionForeground); font-style:italic; margin-top:3px; transition:opacity 0.3s; }
</style></head><body>
<div class="scroll-body">
    <div class="section">
        <div class="section-header"><span class="codicon codicon-graph"></span> ${vscode.l10n.t('AI Metrics')}</div>
        <div class="skeleton-row"><div class="skeleton-card"></div><div class="skeleton-card"></div></div>
        <div class="skeleton-row"><div class="skeleton-card"></div><div class="skeleton-card"></div></div>
        <div class="skeleton" style="width:80%;margin-bottom:4px;"></div>
        <div class="skeleton" style="width:60%;"></div>
    </div>
    <div class="section">
        <div class="section-header"><span class="codicon codicon-comment-discussion"></span> ${vscode.l10n.t('Copilot Chat')}</div>
        <div class="skeleton" style="width:70%;margin-bottom:6px;"></div>
        <div class="skeleton" style="width:50%;margin-bottom:6px;"></div>
        <div class="skeleton" style="width:60%;"></div>
    </div>
    <div class="section">
        <div class="section-header"><span class="codicon codicon-history"></span> ${vscode.l10n.t('Recent Chat Sessions')}</div>
        <div class="skeleton" style="width:90%;margin-bottom:6px;"></div>
        <div class="skeleton" style="width:75%;margin-bottom:6px;"></div>
        <div class="skeleton" style="width:85%;"></div>
    </div>
    <div class="section">
        <div class="section-header"><span class="codicon codicon-hubot"></span> ${vscode.l10n.t('Models')}</div>
        <div class="skeleton" style="width:65%;margin-bottom:6px;"></div>
        <div class="skeleton" style="width:50%;"></div>
    </div>
    <div class="section">
        <div class="section-header"><span class="codicon codicon-plug"></span> ${vscode.l10n.t('MCP Servers')}</div>
        <div class="skeleton" style="width:80%;margin-bottom:6px;"></div>
        <div class="skeleton" style="width:60%;"></div>
    </div>
</div>
<div class="loading-toast">
    <span class="toast-fox">\ud83e\udd8a</span>${vscode.l10n.t('Loading data\u2026')}
    <div class="toast-msg" id="loadMsg"></div>
</div>
<div class="sticky-footer">
    <button class="btn btn-primary" data-command="openDashboard"><span class="codicon codicon-graph"></span> ${vscode.l10n.t('Open Full Dashboard')}</button>
    <button class="btn btn-primary" data-command="refresh" disabled style="opacity:0.6;"><span class="codicon codicon-sync"></span> ${vscode.l10n.t('Loading\u2026')}</button>
    <div style="padding-top:4px;text-align:center;font-size:8px;color:var(--vscode-descriptionForeground);">
        <div>${vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 \ud83d\ude80 Driving AI-Powered Delivery Excellence')}</div>
    </div>
</div>
<script nonce="${loadingNonce}">
var vscode=acquireVsCodeApi();
document.addEventListener('click',function(e){var t=e.target.closest('[data-command]');if(t)vscode.postMessage({command:t.getAttribute('data-command')});});
var msgs=[
'${vscode.l10n.t('\ud83e\udd8a Preparing your workspace and tuning AI intelligence for you.')}',
'${vscode.l10n.t('\ud83e\udd8a Turning your data into actionable intelligence\u2026 almost ready.')}',
'${vscode.l10n.t('\ud83e\udd8a Learning your context to assist you smarter.')}',
'${vscode.l10n.t('\ud83e\udd8a Powering up AI boosters for maximum productivity.')}',
'${vscode.l10n.t('\ud83e\udd8a Analyzing patterns and organizing insights behind the scenes.')}',
'${vscode.l10n.t('\ud83e\udd8a Crafting smarter suggestions just for this session.')}',
'${vscode.l10n.t('\ud83e\udd8a Connecting intelligence, automation, and creativity.')}',
'${vscode.l10n.t('\ud83e\udd8a Optimizing your experience\u2026 one smart step at a time.')}',
'${vscode.l10n.t('\ud83e\udd8a Warming up neural engines\u2026 thinking intelligently.')}',
'${vscode.l10n.t('\ud83e\udd8a Tracking the best insights for your workflow.')}'
];
var el=document.getElementById('loadMsg');var last=-1;
if(el){el.textContent=msgs[Math.floor(Math.random()*msgs.length)];}
setInterval(function(){var idx;do{idx=Math.floor(Math.random()*msgs.length)}while(idx===last&&msgs.length>1);last=idx;if(el){el.style.opacity='0';setTimeout(function(){el.textContent=msgs[idx];el.style.opacity='1';},200);}},2000);
</script>
</body></html>`;
        } // end else (first load skeleton)

        try {
            const data = await AccountDataFetcher.getAllData();
            this._view.webview.html = this._getHtml(data);
            this._hasLoadedOnce = true;
        } catch (err) {
            console.error('GHCP Sidebar: Error fetching data', err);
            const nonce = getNonce();
            const foxMessages = [
                vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Oops, I hit an unexpected trail. Let\u2019s try that again.'),
                vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Hmm\u2026 something didn\u2019t load as planned. Retrying might help.'),
                vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 I lost the trail for a moment. Reloading should fix it.'),
                vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Even foxes miss a step sometimes. Let\u2019s reload.'),
                vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 I chased the data\u2026 but it escaped this time. Retry?')
            ];
            const foxMsg = foxMessages[Math.floor(Math.random() * foxMessages.length)];
            this._view.webview.html = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>
                body { padding:16px 12px; font-family:var(--vscode-font-family); color:var(--vscode-foreground); background:var(--vscode-sideBar-background); }
                .error-icon { font-size:28px; text-align:center; margin-bottom:10px; }
                h3 { font-size:13px; margin:0 0 8px; }
                .fox-msg { background:var(--vscode-input-background, rgba(245,158,11,0.08)); border:1px solid var(--vscode-panel-border); border-radius:6px; padding:10px; font-size:11px; color:var(--vscode-foreground); margin:8px 0; line-height:1.5; font-style:italic; }
                .error-detail { background:var(--vscode-input-background, rgba(239,68,68,0.08)); border:1px solid var(--vscode-panel-border); border-radius:6px; padding:8px; font-size:10px; color:var(--vscode-notificationsErrorIcon-foreground, #ef4444); margin:8px 0; font-family:monospace; word-break:break-all; }
                .help { font-size:10px; color:var(--vscode-descriptionForeground); line-height:1.6; margin:10px 0; }
                .help strong { color:var(--vscode-foreground); }
                .btn { margin-top:10px; padding:6px 14px; background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; border-radius:4px; cursor:pointer; font-size:11px; width:100%; font-family:inherit; }
                a { color:var(--vscode-textLink-foreground); }
            </style></head><body>
                <div class="error-icon">⚠️</div>
                <h3>${vscode.l10n.t('Sidebar Error')}</h3>
                <p style="font-size:11px;color:var(--vscode-descriptionForeground);margin:4px 0 8px;">${vscode.l10n.t('Could not load GitHub Copilot Insights Dashboard data')}</p>
                <div class="error-detail">${escapeHtml(err.message || 'Unknown error')}</div>
                <div class="help">
                    <strong>${vscode.l10n.t('What you can try:')}</strong><br>
                    • ${vscode.l10n.t('Click Retry below')}<br>
                    • ${vscode.l10n.t('Restart VS Code (Ctrl+Shift+P → Reload Window)')}<br>
                    • ${vscode.l10n.t('Check that GitHub Copilot Chat is installed')}<br>
                    • ${vscode.l10n.t('Verify editor.aiStats.enabled is true')}<br><br>
                    <strong>${vscode.l10n.t('Still having issues?')}</strong><br>
                    ${vscode.l10n.t('Please verify the extension version or contact admin:')}<br>
                    <a href="mailto:sj.techconnect@gmail.com">sj.techconnect@gmail.com</a>
                </div>
                <button class="btn" data-command="refresh">↻ ${vscode.l10n.t('Retry')}</button>
                <script nonce="${nonce}">const vscode=acquireVsCodeApi();document.addEventListener('click',e=>{const t=e.target.closest('[data-command]');if(t)vscode.postMessage({command:t.getAttribute('data-command')});});</script>
            </body></html>`;
        }
    }

    /**
     * Generates the complete sidebar HTML with weekly AI metrics, Copilot Chat status,
     * models summary, MCP servers, and author signature.
     *
     * @param {Object} data - The full data object from AccountDataFetcher.getAllData()
     * @returns {string} Complete HTML document string for the webview
     */
    _getHtml(data) {
        const nonce = getNonce();
        const totalAccounts = data.github.length + data.microsoft.length + data.githubEnterprise.length;
        const noAccounts = totalAccounts === 0;
        const noCopilot = !data.copilot.copilot.installed && !data.copilot.copilotChat.installed;
        const chatInstalled = data.copilot.copilotChat.installed;

        // Pick 2 random CodeFox sayings for the footer
        const foxSayings = [
            vscode.l10n.t('"Thinking smarter is always faster than working harder."'),
            vscode.l10n.t('"Behind every great outcome is intelligent assistance."'),
            vscode.l10n.t('"Patterns reveal answers before logic does."'),
            vscode.l10n.t('"Innovation starts with asking better questions."'),
            vscode.l10n.t('"The future belongs to collaborative intelligence."'),
            vscode.l10n.t('"Let intelligence do the heavy lifting."'),
            vscode.l10n.t('"Insight precedes innovation."'),
            vscode.l10n.t('"Smart thinking scales impact."'),
            vscode.l10n.t('"Learning never pauses."'),
            vscode.l10n.t('"Every moment is a chance to optimize."')
        ];
        const shuffled = foxSayings.sort(() => Math.random() - 0.5);
        const foxQuote1 = shuffled[0];
        const foxQuote2 = shuffled[1];

        // AI stats — this week
        const aiStats = data.aiStats || [];
        const aiStatsEnabled = data.aiStatsEnabled;
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const dayOfWeek = today.getDay();
        const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const weekStart = new Date(today); weekStart.setDate(today.getDate() - mondayOffset);
        const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
        const toDateStr = (d) => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        const wsStr = toDateStr(weekStart);
        const weStr = toDateStr(weekEnd);
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const weekLabel = weekStart.getDate() + ' ' + months[weekStart.getMonth()] + ' - ' + weekEnd.getDate() + ' ' + months[weekEnd.getMonth()] + ' ' + weekEnd.getFullYear();
        const weekStats = aiStats.filter(r => r.date >= wsStr && r.date <= weStr);
        const weekAi = weekStats.reduce((s,r) => s + (r.aiCharacters||0), 0);
        const weekTyped = weekStats.reduce((s,r) => s + (r.typedCharacters||0), 0);
        const weekTotal = weekAi + weekTyped;
        const weekPct = weekTotal > 0 ? Math.round(weekAi / weekTotal * 100) : 0;
        const weekSessions = weekStats.length;
        const weekSuggestions = weekStats.reduce((s,r) => s + (r.acceptedInlineSuggestions||0), 0);
        const weekChatEdits = weekStats.reduce((s,r) => s + (r.chatEditCount||0), 0);
        // Count unique days with data
        const weekDaysWithData = new Set(weekStats.map(r => r.date)).size;

        // MCP servers
        let mcpHtml = '';
        if (data.mcpServers.length > 0) {
            data.mcpServers.forEach(srv => {
                const icon = srv.name.toLowerCase().includes('devops') ? 'codicon-server-process' :
                             srv.name.toLowerCase().includes('doc') ? 'codicon-book' : 'codicon-plug';
                mcpHtml += `<div class="mcp-item"><span class="codicon ${icon}"></span><div class="mcp-info"><div class="mcp-name">${escapeHtml(srv.name)}</div><div class="mcp-detail">${escapeHtml(srv.type)}</div></div></div>`;
            });
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._view.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${this._view.webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        :root {
            --ghcp-success: var(--vscode-charts-green, var(--vscode-testing-iconPassed, #22c55e));
            --ghcp-info: var(--vscode-textLink-foreground, #58a6ff);
            --ghcp-warning: var(--vscode-notificationsWarningIcon-foreground, #f59e0b);
            --ghcp-error: var(--vscode-notificationsErrorIcon-foreground, #ef4444);
            --ghcp-accent: var(--vscode-textLink-foreground, #0078d4);
            --ghcp-subtle-bg: var(--vscode-input-background, rgba(110,118,129,0.08));
        }
        body { padding:0; margin:0; font-family:var(--vscode-font-family); font-size:var(--vscode-font-size); color:var(--vscode-foreground); background:var(--vscode-sideBar-background); display:flex; flex-direction:column; height:100vh; overflow:hidden; }
        .scroll-body { flex:1; overflow-y:auto; padding:12px; scroll-behavior:smooth; }
        .scroll-body::-webkit-scrollbar { width:6px; }
        .scroll-body::-webkit-scrollbar-thumb { background:var(--vscode-scrollbarSlider-background); border-radius:3px; }
        .scroll-body::-webkit-scrollbar-thumb:hover { background:var(--vscode-scrollbarSlider-hoverBackground); }
        .sticky-footer { flex-shrink:0; padding:8px 12px 16px; border-top:1px solid var(--vscode-panel-border); background:var(--vscode-sideBar-background); }
        .section { margin-bottom:14px; }
        .section-header { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:var(--vscode-descriptionForeground); margin-bottom:6px; padding:4px 0; border-bottom:1px solid var(--vscode-panel-border); display:flex; align-items:center; gap:6px; }
        .account-row { display:flex; align-items:center; gap:10px; padding:6px 8px; border-radius:6px; margin-bottom:3px; }
        .account-row .avatar { width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; flex-shrink:0; }
        .avatar.gh { background:var(--ghcp-subtle-bg); } .avatar.ms { background:var(--ghcp-subtle-bg); color:var(--ghcp-accent); }
        .account-row .info { flex:1; min-width:0; }
        .account-row .name { font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .account-row .meta { font-size:9px; color:var(--vscode-descriptionForeground); display:flex; align-items:center; gap:4px; }
        .status-dot { display:inline-block; width:6px; height:6px; border-radius:50%; }
        .status-dot.active { background:var(--ghcp-success); } .status-dot.inactive { background:var(--vscode-descriptionForeground); }
        .stat-grid { display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-bottom:4px; }
        .stat-card { padding:5px 6px; border:1px solid var(--vscode-panel-border); border-radius:6px; text-align:center; background:var(--ghcp-subtle-bg); transition:border-color 0.2s; }
        .stat-card:hover { border-color:var(--ghcp-info); }
        .stat-val { font-size:15px; font-weight:800; } .stat-lbl { font-size:8px; color:var(--vscode-descriptionForeground); margin-top:1px; }
        .copilot-row { display:flex; align-items:center; justify-content:space-between; padding:4px 0; font-size:11px; }
        .copilot-label { color:var(--vscode-descriptionForeground); } .copilot-value { display:flex; align-items:center; gap:4px; font-weight:500; font-size:10px; }
        .mcp-item { display:flex; align-items:center; gap:8px; padding:4px 8px; border-radius:4px; margin-bottom:2px; font-size:11px; }
        .mcp-item:hover { background:var(--vscode-list-hoverBackground); }
        .mcp-info { flex:1; min-width:0; } .mcp-name { font-weight:600; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .mcp-detail { font-size:9px; color:var(--vscode-descriptionForeground); }
        .stat-row { display:flex; justify-content:space-between; padding:3px 0; font-size:11px; }
        .stat-row-label { color:var(--vscode-descriptionForeground); } .stat-row-val { font-weight:600; }
        .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:6px 14px; border:none; border-radius:4px; font-size:11px; font-weight:500; cursor:pointer; width:100%; margin-top:3px; }
        .btn-primary { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
        .btn-primary:hover { background:var(--vscode-button-hoverBackground); }
        .btn-secondary { background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); border:1px solid var(--vscode-panel-border); }
        .btn-secondary:hover { background:var(--vscode-button-secondaryHoverBackground); }
        .actions { margin-top:10px; display:flex; flex-direction:column; gap:4px; }
        .empty-state { text-align:center; padding:10px; color:var(--vscode-descriptionForeground); font-size:11px; }
        .divider { height:1px; background:var(--vscode-panel-border); margin:10px 0; }
        .timestamp { font-size:9px; color:var(--vscode-descriptionForeground); text-align:center; margin-top:6px; display:flex; align-items:center; justify-content:center; gap:4px; }
        .freshness-dot { display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--ghcp-success); flex-shrink:0; transition:background 0.5s ease; padding:4px; background-clip:content-box; cursor:help; }
        .freshness-dot.stale { background:var(--ghcp-warning); animation:pulse 2s ease-in-out infinite; }
        .no-data-banner { text-align:center; padding:20px 12px; }
        .no-data-banner .codicon { font-size:28px; margin-bottom:8px; display:block; color:var(--vscode-descriptionForeground); }
        .no-data-banner p { font-size:11px; color:var(--vscode-descriptionForeground); margin-bottom:6px; }
        .ai-bar { height:4px; background:var(--ghcp-subtle-bg); border-radius:2px; overflow:hidden; margin-top:4px; }
        .ai-bar-fill { height:100%; border-radius:2px; background:var(--ghcp-success); transition:width 0.6s ease; }
        .sidebar-session-row { display:flex; align-items:center; gap:6px; padding:4px 8px; border-radius:4px; margin-bottom:2px; }
        .sidebar-session-row:hover { background:var(--vscode-list-hoverBackground); }
        .sidebar-session-info { flex:1; min-width:0; }
        .sidebar-session-title { font-size:11px; font-weight:600; word-wrap:break-word; overflow-wrap:break-word; white-space:normal; }
        .sidebar-session-meta { font-size:9px; color:var(--vscode-descriptionForeground); margin-top:1px; display:flex; align-items:center; gap:4px; }
        .sidebar-open-btn { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border:1px solid var(--vscode-panel-border); border-radius:4px; background:transparent; color:var(--vscode-foreground); cursor:pointer; flex-shrink:0; transition:all 0.15s; }
        .sidebar-open-btn:hover { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
        .workspace-banner { display:flex; align-items:center; gap:6px; padding:6px 8px; margin-bottom:10px; border-radius:6px; background:var(--ghcp-subtle-bg); border:1px solid var(--vscode-panel-border); }
        .workspace-banner .codicon { font-size:12px; color:var(--ghcp-info); flex-shrink:0; }
        .workspace-name { font-size:11px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .workspace-folders { font-size:9px; color:var(--vscode-descriptionForeground); }
        .section-header { cursor:pointer; user-select:none; }
        .section-header:hover { color:var(--vscode-foreground); }
        .section-header .chevron { margin-left:auto; flex-shrink:0; display:inline-block; width:0; height:0; border-left:4px solid transparent; border-right:4px solid transparent; border-top:5px solid var(--vscode-descriptionForeground); transition:transform 0.15s; }
        .section-header .chevron.collapsed { transform:rotate(-90deg); }
        .section-body { overflow:hidden; transition:max-height 0.25s ease, opacity 0.2s ease; }
        .section-body.collapsed { max-height:0 !important; overflow:hidden; opacity:0; }
        .skeleton { height:10px; background:rgba(110,118,129,0.12); border-radius:4px; animation:pulse 1.5s ease-in-out infinite; }
        .skeleton-row { display:flex; gap:6px; margin-bottom:6px; }
        .skeleton-card { flex:1; height:28px; background:rgba(110,118,129,0.08); border:1px solid var(--vscode-panel-border); border-radius:6px; animation:pulse 1.5s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }
        .loading-toast { display:none; margin:0 0 8px; padding:8px 10px; border-radius:6px; background:var(--ghcp-subtle-bg); border:1px solid var(--vscode-panel-border); font-size:10px; color:var(--vscode-foreground); line-height:1.5; text-align:center; }
        .loading-toast.visible { display:block; }
        .loading-toast .toast-spinner { display:inline-block; font-size:14px; vertical-align:middle; margin-right:6px; animation:bounce 1.2s ease-in-out infinite; }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
        .loading-toast .toast-msg { font-size:9px; color:var(--vscode-descriptionForeground); font-style:italic; margin-top:3px; transition:opacity 0.3s; }
        *:focus-visible { outline:1px solid var(--vscode-focusBorder); outline-offset:1px; border-radius:3px; }
        .btn:active { transform:scale(0.98); }
        .mcp-item { transition:background 0.15s; }
        .sidebar-session-row { transition:background 0.15s; }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration:0.01ms !important; transition-duration:0.01ms !important; } }
    </style>
</head>
<body>
<div class="scroll-body">
    ${noCopilot && noAccounts ? `
        <div class="no-data-banner">
            <span class="codicon codicon-warning"></span>
            <p><strong>${vscode.l10n.t('Setup Required')}</strong></p>
            <p>${vscode.l10n.t('Install GitHub Copilot Chat and sign in.')}</p>
            <button class="btn btn-primary" data-command="signInGithub"><span class="codicon codicon-sign-in"></span> ${vscode.l10n.t('Sign in to GitHub')}</button>
        </div>
    ` : `
        <!-- This Week's AI Metrics -->
        <div class="section">
            <div class="section-header" data-section="ai-metrics"><span class="codicon codicon-graph"></span> ${vscode.l10n.t('AI Metrics')} — ${weekLabel}<span class="chevron"></span></div>
            <div class="section-body" data-section-body="ai-metrics">
            ${!aiStatsEnabled ? `<div style="background:var(--ghcp-subtle-bg);border:1px solid var(--vscode-panel-border);border-radius:6px;padding:6px 8px;margin-bottom:6px;font-size:10px;display:flex;align-items:flex-start;gap:6px"><span class="codicon codicon-warning" style="color:var(--ghcp-warning);flex-shrink:0;margin-top:1px"></span><div><strong style="color:var(--ghcp-warning)">${vscode.l10n.t('AI Stats disabled')}</strong><br><a href="#" data-command="openSettings" style="color:var(--ghcp-warning);text-decoration:underline;cursor:pointer">${vscode.l10n.t('Open Settings')}</a> ${vscode.l10n.t('to enable')} <code>editor.aiStats.enabled</code>.</div></div>` : ''}
            ${weekStats.length > 0 ? `
                <div class="stat-grid">
                    <div class="stat-card"><div class="stat-val" style="color:var(--ghcp-success)">${weekPct}%</div><div class="stat-lbl">${vscode.l10n.t('AI Rate')}</div></div>
                    <div class="stat-card"><div class="stat-val">${weekSessions}</div><div class="stat-lbl">${vscode.l10n.t('Sessions')}</div></div>
                    <div class="stat-card"><div class="stat-val">${weekSuggestions}</div><div class="stat-lbl">${vscode.l10n.t('Suggestions')}</div></div>
                    <div class="stat-card"><div class="stat-val">${weekChatEdits}</div><div class="stat-lbl">${vscode.l10n.t('Chat Edits')}</div></div>
                </div>
                <div class="stat-row"><span class="stat-row-label">${vscode.l10n.t('AI Characters')}</span><span class="stat-row-val">${weekAi.toLocaleString()}</span></div>
                <div class="stat-row"><span class="stat-row-label">${vscode.l10n.t('Typed Characters')}</span><span class="stat-row-val">${weekTyped.toLocaleString()}</span></div>
                <div class="stat-row"><span class="stat-row-label">${vscode.l10n.t('Active Days')}</span><span class="stat-row-val">${weekDaysWithData} / 7</span></div>
                <div class="ai-bar"><div class="ai-bar-fill" style="width:${Math.round(weekDaysWithData / 7 * 100)}%;background:${weekDaysWithData >= 5 ? 'var(--ghcp-success)' : weekDaysWithData >= 3 ? 'var(--ghcp-info)' : 'var(--ghcp-warning)'};"></div></div>
                <div class="ai-bar" style="margin-top:3px;"><div class="ai-bar-fill" style="width:${weekPct}%"></div></div>
            ` : `<div class="empty-state" style="padding:6px;font-size:10px;">${aiStatsEnabled ? vscode.l10n.t('No data this week') : vscode.l10n.t('No data — AI Stats collection is off')}</div>`}
            </div>
        </div>

        <!-- Copilot Chat -->
        <div class="section">
            <div class="section-header" data-section="copilot-chat"><span class="codicon codicon-comment-discussion"></span> Copilot Chat<span class="chevron"></span></div>
            <div class="section-body" data-section-body="copilot-chat">
            ${chatInstalled ? `
                <div class="copilot-row"><span class="copilot-label">${vscode.l10n.t('Version')}</span><span class="copilot-value">${data.copilot.copilotChat.version}</span></div>
                <div class="copilot-row"><span class="copilot-label">${vscode.l10n.t('Status')}</span><span class="copilot-value">${data.copilot.copilotChat.active ? '<span class="status-dot active"></span> ' + vscode.l10n.t('Active') : '<span class="status-dot inactive"></span> ' + vscode.l10n.t('Inactive')}</span></div>
                <div class="copilot-row"><span class="copilot-label">${vscode.l10n.t('Last Used')}</span><span class="copilot-value">${data.activeCopilotAccount ? escapeHtml(data.activeCopilotAccount.label) + ' <span style="opacity:0.55;font-size:0.8em;">(' + escapeHtml(data.activeCopilotAccount.provider) + ')</span>' : '<em>' + vscode.l10n.t('Not signed in') + '</em>'}</span></div>
                <div class="copilot-row"><span class="copilot-label">${vscode.l10n.t('Workspace')}</span><span class="copilot-value" style="font-size:9px;" title="${escapeHtml(data.workspace.name)}">${escapeHtml(data.workspace.name)}</span></div>
            ` : `<div class="empty-state" style="padding:6px;font-size:10px;">${vscode.l10n.t('Not installed')}</div>`}
            </div>
        </div>

        <!-- Recent Chat Sessions -->
        ${chatInstalled ? (() => {
            const currentWsSessions = (data.chatSessions || []).filter(s => s.isCurrentWorkspace || (data.workspace.name && s.workspace === data.workspace.name));
            const recentSessions = currentWsSessions.slice(0, 5);
            return `
        <div class="section">
            <div class="section-header" data-section="recent-sessions"><span class="codicon codicon-history"></span> ${vscode.l10n.t('Recent Chat Sessions')} <span class="sidebar-info-icon" style="display:inline-flex;align-items:center;"><span style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:9px;font-weight:700;cursor:help;" title="${vscode.l10n.t('Shows recent Copilot Chat sessions from the current workspace. Click Open to resume a session.')}">?</span></span><span class="chevron" style="margin-left:auto;"></span></div>
            <div class="section-body" data-section-body="recent-sessions">
            ${recentSessions.length === 0 ? `<div class="empty-state" style="padding:6px;font-size:10px;">${vscode.l10n.t('No sessions in this workspace')}</div>` : recentSessions.map(s => {
                const title = escapeHtml(s.title || vscode.l10n.t('Untitled Session'));
                const typeLabel = (s.chatType === 'agent' || s.source === 'agentSession') ? vscode.l10n.t('Agent') : s.chatType === 'ask' ? vscode.l10n.t('Ask') : vscode.l10n.t('Chat');
                const dateObj = new Date(s.lastMessageDate || s.creationDate);
                const timeAgo = (() => { const d = Date.now() - dateObj.getTime(); if (d < 60000) return vscode.l10n.t('just now'); if (d < 3600000) return Math.floor(d / 60000) + vscode.l10n.t('m ago'); if (d < 86400000) return Math.floor(d / 3600000) + vscode.l10n.t('h ago'); return Math.floor(d / 86400000) + vscode.l10n.t('d ago'); })();
                return `<div class="sidebar-session-row">
                    <div class="sidebar-session-info">
                        <div class="sidebar-session-title" title="${title}">${title}</div>
                        <div class="sidebar-session-meta"><span style="font-size:8px;padding:1px 4px;border-radius:3px;background:var(--ghcp-subtle-bg);color:var(--vscode-descriptionForeground);">${typeLabel}</span> <span>${timeAgo}</span> <span>${s.messageCount || 0} ${vscode.l10n.t('msgs')}</span></div>
                    </div>
                    <button class="sidebar-open-btn" data-command="openChatSession" data-session-id="${escapeHtml(s.sessionId)}" data-session-title="${title}" title="${vscode.l10n.t('Open session')}"><span style="font-size:10px;">▶</span></button>
                </div>`;
            }).join('')}
            </div>
        </div>`;
        })() : ''}

        <!-- Models -->
        <div class="section">
            <div class="section-header" data-section="models"><span class="codicon codicon-hubot"></span> ${vscode.l10n.t('Models')} (${data.languageModels.length})<span class="chevron"></span></div>
            <div class="section-body" data-section-body="models">
            <div class="stat-row"><span class="stat-row-label">${vscode.l10n.t('Available')}</span><span class="stat-row-val">${data.languageModels.length}</span></div>
            ${data.languageModels.length > 0 ? `<div class="stat-row"><span class="stat-row-label">${vscode.l10n.t('Top Model')}</span><span class="stat-row-val" style="font-size:10px;">${escapeHtml((data.languageModels[0].name || data.languageModels[0].family))}</span></div>` : ''}
            </div>
        </div>

        ${data.mcpServers.length > 0 ? `
        <!-- MCP Servers -->
        <div class="section">
            <div class="section-header" data-section="mcp-servers"><span class="codicon codicon-plug"></span> ${vscode.l10n.t('MCP Servers')} (${data.mcpServers.length})<span class="chevron"></span></div>
            <div class="section-body" data-section-body="mcp-servers">
            ${mcpHtml}
            </div>
        </div>
        ` : ''}
    `}
</div>
<div id="loadingToast" class="loading-toast">
    <span class="toast-spinner">🦊</span>${vscode.l10n.t('Refreshing data\u2026')}
    <div class="toast-msg" id="toastMsg"></div>
</div>
<div class="sticky-footer">
    <div class="actions" style="margin-top:0;">
        <button class="btn btn-primary" data-command="openDashboard"><span class="codicon codicon-graph"></span> ${vscode.l10n.t('Open Full Dashboard')}</button>
        <button class="btn btn-primary" data-command="refresh"><span class="codicon codicon-refresh"></span> ${vscode.l10n.t('Refresh')}</button>
    </div>
    <div class="timestamp" data-updated-at="${data.timestamp}" title="${vscode.l10n.t('🟢 Green = Data is fresh (under 5 min)')}&#10;${vscode.l10n.t('🟠 Amber = Data may be stale (over 5 min) — click Refresh to update')}"><span class="freshness-dot" id="freshnessDot"></span>${vscode.l10n.t('Updated: ')}${new Date(data.timestamp).toLocaleTimeString()}</div>
    <div style="margin:6px 0 4px;text-align:center;font-size:10px;color:var(--vscode-descriptionForeground);font-style:italic;line-height:1.5;">
        <div>${foxQuote1} — 🦊</div>
    </div>
    <div style="text-align:center;font-size:8px;color:var(--vscode-descriptionForeground);margin-top:2px;">
        <div>${vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 \ud83d\ude80 Driving AI-Powered Delivery Excellence')}</div>
    </div>
</div>
<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    function post(cmd, data) { vscode.postMessage({ command: cmd, data: data }); }
    document.addEventListener('click', function(e) {
        var target = e.target.closest('[data-command]');
        if (target) {
            var cmd = target.getAttribute('data-command');
            if (cmd === 'openChatSession') {
                vscode.postMessage({ command: 'openChatSession', sessionId: target.getAttribute('data-session-id'), title: target.getAttribute('data-session-title') });
                return;
            }

            if (cmd === 'refresh') {
                var btn = target;
                btn.disabled = true;
                btn.style.opacity = '0.6';
                btn.innerHTML = '<span class="codicon codicon-sync"></span> ' + vscode.l10n.t('Refreshing\u2026');
            }
            post(cmd, target.getAttribute('data-arg') || undefined);
        }
    });

    // Listen for messages from extension host
    var foxMsgs = [
        '\ud83e\udd8a Preparing your workspace and tuning AI intelligence for you.',
        '\ud83e\udd8a Turning your data into actionable intelligence\u2026 almost ready.',
        '\ud83e\udd8a Learning your context to assist you smarter.',
        '\ud83e\udd8a Powering up AI boosters for maximum productivity.',
        '\ud83e\udd8a Analyzing patterns and organizing insights behind the scenes.',
        '\ud83e\udd8a Crafting smarter suggestions just for this session.',
        '\ud83e\udd8a Connecting intelligence, automation, and creativity.',
        '\ud83e\udd8a Optimizing your experience\u2026 one smart step at a time.',
        '\ud83e\udd8a Warming up neural engines\u2026 thinking intelligently.',
        '\ud83e\udd8a Tracking the best insights for your workflow.'
    ];
    var toastInterval = null;
    window.addEventListener('message', function(e) {
        if (e.data && e.data.command === 'showRefreshing') {
            // Show loading toast
            var toast = document.getElementById('loadingToast');
            var toastMsg = document.getElementById('toastMsg');
            if (toast) {
                toast.classList.add('visible');
                var msgIdx = 0;
                if (toastMsg) { toastMsg.textContent = foxMsgs[0]; }
                if (toastInterval) clearInterval(toastInterval);
                toastInterval = setInterval(function() {
                    msgIdx = (msgIdx + 1) % foxMsgs.length;
                    if (toastMsg) {
                        toastMsg.style.opacity = '0';
                        setTimeout(function() { toastMsg.textContent = foxMsgs[msgIdx]; toastMsg.style.opacity = '1'; }, 200);
                    }
                }, 1800);
            }
            // Update refresh button
            var btns = document.querySelectorAll('[data-command="refresh"]');
            btns.forEach(function(btn) {
                btn.disabled = true;
                btn.style.opacity = '0.6';
                btn.innerHTML = '<span class="codicon codicon-sync"></span> ${vscode.l10n.t('Refreshing\u2026')}';
            });
            // Replace section bodies with skeleton placeholders
            var skeletonMap = {
                'ai-metrics': '<div class="skeleton-row"><div class="skeleton-card"></div><div class="skeleton-card"></div></div><div class="skeleton-row"><div class="skeleton-card"></div><div class="skeleton-card"></div></div><div class="skeleton" style="width:80%;margin-bottom:4px;"></div><div class="skeleton" style="width:60%;"></div>',
                'copilot-chat': '<div class="skeleton" style="width:70%;margin-bottom:6px;"></div><div class="skeleton" style="width:50%;margin-bottom:6px;"></div><div class="skeleton" style="width:60%;"></div>',
                'recent-sessions': '<div class="skeleton" style="width:90%;margin-bottom:6px;"></div><div class="skeleton" style="width:75%;margin-bottom:6px;"></div><div class="skeleton" style="width:85%;"></div>',
                'models': '<div class="skeleton" style="width:65%;margin-bottom:6px;"></div><div class="skeleton" style="width:50%;"></div>',
                'mcp-servers': '<div class="skeleton" style="width:80%;margin-bottom:6px;"></div><div class="skeleton" style="width:60%;"></div>'
            };
            for (var key in skeletonMap) {
                var body = document.querySelector('[data-section-body="' + key + '"]');
                if (body && !body.classList.contains('collapsed')) {
                    body.innerHTML = skeletonMap[key];
                }
            }
        }
    });

    // Freshness indicator - green dot for fresh data, amber after 5 min
    (function() {
        var tsEl = document.querySelector('.timestamp');
        var dot = document.getElementById('freshnessDot');
        if (!tsEl || !dot) return;
        var raw = tsEl.getAttribute('data-updated-at');
        var updatedAt = new Date(raw).getTime();
        if (isNaN(updatedAt)) updatedAt = Date.now();
        function checkFreshness() {
            var age = Date.now() - updatedAt;
            if (age > 5 * 60 * 1000) {
                dot.classList.add('stale');
                dot.title = 'Data may be stale \u2014 click Refresh to update';
                tsEl.style.color = 'var(--ghcp-warning)';
            } else {
                dot.classList.remove('stale');
                dot.title = 'Data is fresh';
                tsEl.style.color = '';
            }
        }
        checkFreshness();
        setInterval(checkFreshness, 30000);
    })();

    // Collapsible sections
    (function() {
        var STATE_KEY = 'ghcp-sidebar-collapsed';
        var saved = {};
        try { var s = localStorage.getItem(STATE_KEY); if (s) saved = JSON.parse(s); } catch(e) {}

        function save() { try { localStorage.setItem(STATE_KEY, JSON.stringify(saved)); } catch(e) {} }

        document.querySelectorAll('.section-header[data-section]').forEach(function(header) {
            var key = header.getAttribute('data-section');
            var body = document.querySelector('[data-section-body="' + key + '"]');
            var chevron = header.querySelector('.chevron');
            if (!body) return;

            // Restore saved state
            if (saved[key]) {
                body.classList.add('collapsed');
                if (chevron) chevron.classList.add('collapsed');
            }

            header.addEventListener('click', function(e) {
                // Don't collapse if clicking info icon or open button
                if (e.target.closest('.sidebar-info-icon') || e.target.closest('.sidebar-open-btn')) return;
                var isCollapsed = body.classList.toggle('collapsed');
                if (chevron) chevron.classList.toggle('collapsed', isCollapsed);
                saved[key] = isCollapsed;
                save();
            });
        });
    })();
</script>
</body>
</html>`;
    }
}

/**
 * Generates a 32-character random alphanumeric nonce for Content Security Policy.
 * @returns {string}
 */
function getNonce() {
    let t = ''; const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) t += c.charAt(Math.floor(Math.random() * c.length));
    return t;
}
/**
 * Escapes HTML special characters to prevent XSS in webview content.
 * @param {string} s - Raw string to escape
 * @returns {string} HTML-safe string
 */
function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

module.exports = { SidebarProvider };
