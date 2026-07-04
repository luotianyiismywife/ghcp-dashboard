/*
 * ----------------------------------------------------------------------------
 * Author      : Jadhav Shubhamm
 * Role        : AI Developer
 * Created On  : 27-Feb-2026
 * Description : Full dashboard webview panel for the GHCP Dashboard extension.
 *               Renders the main dashboard UI with tabs for Copilot & Chat,
 *               AI Stats, Accounts, Models, and MCP Servers. All data is
 *               real — sourced from VS Code APIs and local state databases.
 *
 *   Methods:
 *     DashboardPanel.createOrShow() - Creates or reveals the dashboard panel
 *     refresh()                     - Re-fetches all data and re-renders
 *     _handleMessage()              - Handles webview-to-extension messages
 *     _update()                     - Fetches data and renders HTML
 *     _getHtml()                    - Generates the full dashboard HTML
 *     dispose()                     - Cleans up the panel
 *
 *   Helper Functions:
 *     getNonce()   - Generates a random nonce for CSP
 *     esc()        - HTML-escapes strings
 *     getCSS()     - Returns all dashboard CSS styles
 *     getJS()      - Returns all dashboard client-side JavaScript
 *
 * \u00a9 2026 All rights reserved.
 * ----------------------------------------------------------------------------
 */
const vscode = require('vscode');
const { AccountDataFetcher } = require('./accountDataFetcher');
const { getTrendsTabHTML, getTrendsJS, getTrendsCSS } = require('./trendsPanel');

class DashboardPanel {
    static currentPanel = null;
    static viewType = 'ghcpDashboard';

    constructor(panel, extensionUri, context) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._context = context;
        this._disposed = false;
        this._panel.onDidDispose(() => this.dispose());
        this._panel.webview.onDidReceiveMessage(async (msg) => await this._handleMessage(msg));
        this._update().catch(err => console.error('GHCP Dashboard: Failed to load initial data', err));
    }

    /**
     * Creates a new dashboard panel or reveals the existing one.
     *
     * @param {vscode.Uri} extensionUri - The URI of the extension directory
     * @param {vscode.ExtensionContext} context - The extension context
     * @see Called by extension.js on ghcpDashboard.open command
     */
    static createOrShow(extensionUri, context) {
        const column = vscode.ViewColumn.One;
        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel._panel.reveal(column);
            DashboardPanel.currentPanel.refresh();
            return;
        }
        const panel = vscode.window.createWebviewPanel(DashboardPanel.viewType, 'GitHub Copilot Insights Dashboard', column, {
            enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri]
        });
        panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'GHCP_dash_icon_circle.png');
        DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri, context);
    }

    /**
     * Re-fetches all data and re-renders the dashboard.
     * @see Called by extension.js on ghcpDashboard.refresh command and auth change events
     */
    async refresh() { try { await this._update(); } catch (e) { console.error('GHCP Dashboard: Refresh error', e); } }

    /**
     * Handles messages sent from the webview JavaScript to the extension host.
     * Supports: switchAccount, manageAccounts, refresh, signInGithub,
     * signInMicrosoft, openMcpConfig, copyAccountInfo.
     *
     * @param {Object} message - Message object with command and optional path/text
     */
    async _handleMessage(message) {
        try {
        switch (message.command) {
            case 'switchAccount': vscode.commands.executeCommand('ghcpDashboard.switchAccount'); break;
            case 'manageAccounts': vscode.commands.executeCommand('workbench.action.accounts.show'); break;
            case 'refresh': await this.refresh(); break;
            case 'signInGithub':
                try { await vscode.authentication.getSession('github', ['user:email'], { createIfNone: true }); await this.refresh(); } catch (e) { } break;
            case 'signInMicrosoft':
                try { await vscode.authentication.getSession('microsoft', ['openid', 'profile', 'email'], { createIfNone: true }); await this.refresh(); } catch (e) { } break;
            case 'openMcpConfig':
                if (message.path) { vscode.window.showTextDocument(vscode.Uri.file(message.path)); } break;
            case 'copyAccountInfo':
                if (message.text) { vscode.env.clipboard.writeText(message.text); vscode.window.showInformationMessage(vscode.l10n.t('Copied to clipboard')); } break;
            case 'openSettings':
                vscode.commands.executeCommand('workbench.action.openSettings', 'editor.aiStats.enabled'); break;
            case 'openChatSession':
                if (message.sessionId) {
                    const sid = message.sessionId;
                    const title = message.title || sid;
                    let opened = false;
                    // Strategy 1: Try opening via chat session URI
                    try {
                        const b64 = Buffer.from(sid).toString('base64');
                        const uri = vscode.Uri.parse('vscode-chat-session://local/' + b64);
                        await vscode.commands.executeCommand('vscode.open', uri);
                        opened = true;
                    } catch (e) { /* continue */ }
                    // Strategy 2: Try workbench.action.chat.openSession
                    if (!opened) {
                        try {
                            await vscode.commands.executeCommand('workbench.action.chat.openSession', sid);
                            opened = true;
                        } catch (e) { /* continue */ }
                    }
                    // Strategy 3: Try workbench.action.chat.open with sessionId
                    if (!opened) {
                        try {
                            await vscode.commands.executeCommand('workbench.action.chat.open', { query: '', sessionId: sid });
                            opened = true;
                        } catch (e) { /* continue */ }
                    }
                    // Strategy 4: Open the Chat view and show a message
                    if (!opened) {
                        try {
                            await vscode.commands.executeCommand('workbench.action.chat.open');
                        } catch (e) { /* continue */ }
                        vscode.window.showInformationMessage(
                            vscode.l10n.t('Session: ') + title + vscode.l10n.t(' \u2014 Look for this session in the Chat sidebar.'),
                            vscode.l10n.t('Copy Session ID')
                        ).then(choice => {
                            if (choice === vscode.l10n.t('Copy Session ID')) vscode.env.clipboard.writeText(sid);
                        });
                    }
                } break;
        }
        } catch (e) { console.error('GHCP Dashboard: Message handler error', e); }
    }

    /**
     * Fetches all data from AccountDataFetcher and renders the full dashboard HTML.
     * Shows a styled error page with contact info on failure.
     */
    async _update() {
        if (this._disposed) return;

        // Show loading screen with random AI inspiration message
        const loadingMessages = [
            vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Preparing your workspace and tuning AI intelligence for you.'),
            vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Turning your data into actionable intelligence\u2026 almost ready.'),
            vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Learning your context to assist you smarter.'),
            vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Powering up AI boosters for maximum productivity.'),
            vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Analyzing patterns and organizing insights behind the scenes.'),
            vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Crafting smarter suggestions just for this session.'),
            vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Connecting intelligence, automation, and creativity.'),
            vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Optimizing your experience\u2026 one smart step at a time.'),
            vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Warming up neural engines\u2026 thinking intelligently.'),
            vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Exploring smarter paths to help you faster.'),
            vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Preparing intelligent recommendations for you.')
        ];
        const loadingMsg = loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
        const loadingMsgsJson = JSON.stringify(loadingMessages);
        const loadingNonce = getNonce();
        this._panel.webview.html = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${loadingNonce}';"><style>
            body { margin:0; padding:0; font-family:var(--vscode-font-family); color:var(--vscode-foreground); background:var(--vscode-editor-background); display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; text-align:center; }
            .loader-container { display:flex; flex-direction:column; align-items:center; gap:20px; }
            .loader { width:48px; height:48px; border:4px solid rgba(110,118,129,0.2); border-top:4px solid var(--vscode-focusBorder); border-radius:50%; animation:spin 1s linear infinite; display:flex; align-items:center; justify-content:center; }
            .loader .fox-icon { animation:counter-spin 1s linear infinite; font-size:22px; }
            @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
            @keyframes counter-spin { from{transform:rotate(0deg)} to{transform:rotate(-360deg)} }
            .title { font-size:16px; font-weight:600; }
            .msg { font-size:13px; color:var(--vscode-descriptionForeground); line-height:1.6; max-width:400px; transition:opacity 0.3s; }
            .dots::after { content:''; animation:dots 1.5s infinite; }
            @keyframes dots { 0%{content:''} 25%{content:'.'} 50%{content:'..'} 75%{content:'...'} }
            .sub { font-size:11px; color:var(--vscode-descriptionForeground); margin-top:8px; opacity:0.7; }
        </style></head><body>
            <div class="loader-container">
                <div class="loader"><span class="fox-icon">🦊</span></div>
                <div class="title">${vscode.l10n.t('Loading GitHub Copilot Insights Dashboard')}<span class="dots"></span></div>
                <div class="msg" id="loadMsg">${loadingMsg}</div>
                <div class="sub">${vscode.l10n.t('Fetching accounts, sessions, AI stats, models & MCP data')}</div>
            </div>
            <script nonce="${loadingNonce}">var msgs=${loadingMsgsJson};var el=document.getElementById('loadMsg');var last=-1;setInterval(function(){var idx;do{idx=Math.floor(Math.random()*msgs.length)}while(idx===last&&msgs.length>1);last=idx;el.style.opacity='0';setTimeout(function(){el.textContent=msgs[idx];el.style.opacity='1'},300)},2000);</script>
        </body></html>`;

        try {
            const data = await AccountDataFetcher.getAllData();
            this._panel.webview.html = this._getHtml(data);
        } catch (err) {
            console.error('GHCP Dashboard: Error fetching data', err);
            const foxMessages = [
                vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Oops, I hit an unexpected trail. Let\u2019s try that again.'),
                vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Hmm\u2026 something didn\u2019t load as planned. Retrying might help.'),
                vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 I lost the trail for a moment. Reloading should fix it.'),
                vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 Even foxes miss a step sometimes. Let\u2019s reload.'),
                vscode.l10n.t('\ud83e\udd8a CodeFox \u2014 I chased the data\u2026 but it escaped this time. Retry?')
            ];
            const foxMsg = foxMessages[Math.floor(Math.random() * foxMessages.length)];
            this._panel.webview.html = `<!DOCTYPE html>
<html><head><style>
    body { font-family:var(--vscode-font-family); color:var(--vscode-foreground); background:var(--vscode-editor-background); padding:40px; text-align:center; }
    .error-card { max-width:500px; margin:40px auto; padding:32px; border:1px solid var(--vscode-panel-border); border-radius:12px; background:var(--vscode-editor-background); }
    .error-icon { font-size:48px; margin-bottom:16px; color:#ef4444; }
    .fox-msg { max-width:500px; margin:0 auto 16px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.2); border-radius:8px; padding:14px; font-size:13px; color:var(--vscode-foreground); line-height:1.6; font-style:italic; text-align:center; }
    h2 { margin-bottom:8px; font-size:18px; } p { color:var(--vscode-descriptionForeground); font-size:13px; margin-bottom:8px; line-height:1.6; }
    .error-detail { background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:8px; padding:12px; font-size:12px; color:#ef4444; margin:16px 0; text-align:left; font-family:monospace; word-break:break-all; }
    .info-box { background:rgba(88,166,255,0.08); border:1px solid rgba(88,166,255,0.2); border-radius:8px; padding:14px; margin:16px 0; text-align:left; font-size:12px; }
    .info-box strong { color:var(--vscode-foreground); }
    .btn { display:inline-flex; align-items:center; gap:6px; padding:8px 20px; border:none; border-radius:6px; font-size:13px; cursor:pointer; margin:4px; }
    .btn-primary { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
    .btn-secondary { background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); }
    a { color:var(--vscode-textLink-foreground); }
</style></head><body>
<div class="error-card">
    <div class="error-icon">⚠</div>
    <h2>${vscode.l10n.t('Dashboard Could Not Load')}</h2>
    <div class="fox-msg">${foxMsg}</div>
    <p>${vscode.l10n.t('An error occurred while gathering your account and usage data. This extension works entirely offline using local VS Code data — no internet connection is required.')}</p>
    <div class="error-detail">${err.message || 'Unknown error'}</div>
    <div class="info-box">
        <strong>${vscode.l10n.t('What you can try:')}</strong><br>
        • ${vscode.l10n.t('Click Retry to reload the dashboard')}<br>
        • ${vscode.l10n.t('Restart VS Code (Ctrl+Shift+P → Developer: Reload Window)')}<br>
        • ${vscode.l10n.t('Ensure GitHub Copilot Chat extension is installed')}<br>
        • ${vscode.l10n.t('Check that editor.aiStats.enabled is set to true in settings')}<br><br>
        <strong>${vscode.l10n.t('Still having issues?')}</strong><br>
        ${vscode.l10n.t('Contact')}: <a href="mailto:sj.techconnect@gmail.com">sj.techconnect@gmail.com</a>
    </div>
    <button class="btn btn-primary" id="retryBtn">↻ ${vscode.l10n.t('Retry')}</button>
</div>
<script>const vscode=acquireVsCodeApi();document.getElementById('retryBtn').addEventListener('click',()=>vscode.postMessage({command:'refresh'}));</script>
</body></html>`;
        }
    }

    /**
     * Generates the complete dashboard HTML including all tabs:
     * Accounts, Copilot & Chat, AI Stats, Models, MCP Servers.
     *
     * @param {Object} data - The full data object from AccountDataFetcher.getAllData()
     * @returns {string} Complete HTML document string for the webview panel
     */
    _getHtml(data) {
        const nonce = getNonce();
        const csp = this._panel.webview.cspSource;
        const iconUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'GHCP_dash_icon_circle.png'));
        const r = data.readiness;
        const totalAccounts = data.github.length + data.microsoft.length + data.githubEnterprise.length;

        // Pick 2 random CodeFox sayings for the footer
        const foxSayings = [
            '"Thinking smarter is always faster than working harder."',
            '"Behind every great outcome is intelligent assistance."',
            '"Patterns reveal answers before logic does."',
            '"Innovation starts with asking better questions."',
            '"The future belongs to collaborative intelligence."',
            '"Let intelligence do the heavy lifting."',
            '"Insight precedes innovation."',
            '"Smart thinking scales impact."',
            '"Learning never pauses."',
            '"Every moment is a chance to optimize."'
        ];
        const shuffled = foxSayings.sort(() => Math.random() - 0.5);
        const foxQuote1 = shuffled[0];
        const foxQuote2 = shuffled[1];
        const noAccounts = totalAccounts === 0;
        const noCopilot = !data.copilot.copilot.installed && !data.copilot.copilotChat.installed;
        const chatInstalled = data.copilot.copilotChat.installed;
        const copilotInstalled = data.copilot.copilot.installed;
        const aiStatsEnabled = data.aiStatsEnabled;
        // Detect stale data: setting is off but old data exists, and last record is >24h old
        const aiStatsStale = !aiStatsEnabled && data.aiStats.length > 0 && (Date.now() - data.aiStats[data.aiStats.length - 1].startTime > 86400000);
        const mcpToolsCount = data.registeredTools.filter(t => t.name.startsWith('mcp_')).length;
        const nonMcpTools = data.registeredTools.filter(t => !t.name.startsWith('mcp_'));

        // Readiness banner removed — clean UI

        // No-data fallback
        let noDataHtml = '';
        if (noCopilot && noAccounts) {
            noDataHtml = `
            <div class="full-empty-state">
                <div class="empty-icon-large"><span class="codicon codicon-github"></span></div>
                <h2>${vscode.l10n.t('GitHub Copilot is Not Set Up')}</h2>
                <p>${vscode.l10n.t('No Copilot extensions installed and no accounts are linked to this VS Code instance.')}</p>
                <p>${vscode.l10n.t('To get started:')}</p>
                <ol>
                    <li>${vscode.l10n.t('Install GitHub Copilot and GitHub Copilot Chat extensions')}</li>
                    <li>${vscode.l10n.t('Sign in with your GitHub account')}</li>
                    <li>${vscode.l10n.t('Optionally, link a Microsoft account for MCP servers')}</li>
                </ol>
                <div class="empty-actions">
                    <button class="btn btn-primary" data-command="signInGithub"><span class="codicon codicon-sign-in"></span> ${vscode.l10n.t('Sign in to GitHub')}</button>
                    <button class="btn btn-secondary" data-command="manageAccounts"><span class="codicon codicon-settings-gear"></span> ${vscode.l10n.t('Manage Accounts')}</button>
                </div>
            </div>`;
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${csp}; img-src ${csp};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GHCP Dashboard</title>
    <style>${getCSS()}</style>
</head>
<body>
<div class="dashboard">
    <header class="header">
        <div class="header-left">
            <h1 class="title"><img src="${iconUri}" alt="GHCP" style="width:24px;height:24px;vertical-align:middle;margin-right:6px;border-radius:4px;"> ${vscode.l10n.t('GitHub Copilot Insights Dashboard')}</h1>
            <span class="subtitle">${vscode.l10n.t('Accounts, Copilot extensions, MCP servers, models & tools')}</span>
        </div>
        <div class="header-right">
            <button class="btn btn-primary" id="refreshBtn" data-command="refresh" title="${vscode.l10n.t('Refresh Dashboard')}"><span class="codicon codicon-refresh" id="refreshIcon"></span> <span id="refreshText">${vscode.l10n.t('Refresh')}</span></button>
        </div>
    </header>

    ${(noCopilot && noAccounts) ? noDataHtml : `
    <nav class="tabs">
        <button class="tab active" data-tab="copilot"><span class="codicon codicon-github"></span> ${vscode.l10n.t('Overview')}</button>
        <button class="tab" data-tab="sessions"><span class="codicon codicon-comment-discussion"></span> ${vscode.l10n.t('Chat Sessions')}</button>
        <button class="tab" data-tab="aistats"><span class="codicon codicon-graph-line"></span> ${vscode.l10n.t('AI Stats')}</button>
        <button class="tab" data-tab="accounts"><span class="codicon codicon-account"></span> ${vscode.l10n.t('Accounts')}</button>
        <button class="tab" data-tab="infra"><span class="codicon codicon-server"></span> ${vscode.l10n.t('Models & MCP')}</button>
        <button class="tab" data-tab="info"><span class="codicon codicon-info"></span> ${vscode.l10n.t('Info')}</button>
    </nav>

    <div class="tab-content">

        <!-- ACCOUNTS -->
        <div class="tab-panel" id="panel-accounts">
            ${noAccounts ? `
                <div class="card"><div class="card-body">
                    <div class="full-empty-state small">
                        <span class="codicon codicon-person" style="font-size:24px"></span>
                        <h3>${vscode.l10n.t('No Accounts Linked')}</h3>
                        <p>${vscode.l10n.t('No GitHub or Microsoft accounts are signed in to VS Code.')}</p>
                        <div class="empty-actions">
                            <button class="btn btn-primary" data-command="signInGithub"><span class="codicon codicon-github"></span> ${vscode.l10n.t('Sign in to GitHub')}</button>
                            <button class="btn btn-secondary" data-command="signInMicrosoft"><span class="codicon codicon-azure"></span> ${vscode.l10n.t('Sign in to Microsoft')}</button>
                        </div>
                    </div>
                </div></div>
            ` : `<div class="acct-layout">
                <div class="acct-list-col">
                    <div class="card" style="height:100%;">
                        <div class="card-header"><div class="card-title"><span class="codicon codicon-account"></span> ${vscode.l10n.t('All Accounts')}</div><span class="badge">${totalAccounts}</span></div>
                        <div class="card-body" style="padding:8px;" id="acctListBody">
                            ${data.github.map((acc, i) => `<div class="acct-list-item${i === 0 ? ' selected' : ''}" data-acct-idx="${i}" data-acct-provider="github"><div class="avatar gh" style="width:24px;height:24px;font-size:14px;"><span>🐙</span></div><div style="flex:1;min-width:0;"><div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(acc.label)}</div><div style="font-size:9px;color:var(--vscode-descriptionForeground);display:flex;align-items:center;gap:4px;"><span class="status-dot ${acc.hasSession ? 'active' : 'inactive'}"></span> GitHub${data.activeCopilotAccount && data.activeCopilotAccount.provider === 'github' && data.activeCopilotAccount.label === acc.label ? ' \u00b7 <span style="color:#a78bfa;">Copilot</span>' : ''}</div></div></div>`).join('')}
                            ${data.microsoft.map((acc, i) => `<div class="acct-list-item" data-acct-idx="${i}" data-acct-provider="microsoft"><div class="avatar ms" style="width:24px;height:24px;font-size:14px;"><span>🌐</span></div><div style="flex:1;min-width:0;"><div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(acc.label)}</div><div style="font-size:9px;color:var(--vscode-descriptionForeground);display:flex;align-items:center;gap:4px;"><span class="status-dot ${acc.hasSession ? 'active' : 'inactive'}"></span> Microsoft${data.activeCopilotAccount && data.activeCopilotAccount.provider === 'microsoft' && data.activeCopilotAccount.label === acc.label ? ' \u00b7 <span style="color:#a78bfa;">Copilot</span>' : ''}</div></div></div>`).join('')}
                        </div>
                    </div>
                </div>
                <div class="acct-detail-col" id="acctDetailCol">
                    <div class="card" style="height:100%;"><div class="card-body" style="display:flex;align-items:center;justify-content:center;color:var(--vscode-descriptionForeground);font-size:12px;"><span class="codicon codicon-arrow-left" style="margin-right:6px;"></span> ${vscode.l10n.t('Select an account')}</div></div>
                </div>
            </div>
            <div id="acctDataStore" style="display:none;">${esc(JSON.stringify({
                github: data.github.map(a => ({label:a.label,id:a.id,hasSession:a.hasSession,scopes:a.scopes})),
                microsoft: data.microsoft.map(a => ({label:a.label,id:a.id,hasSession:a.hasSession,scopes:a.scopes})),
                ghTrusted: (data.trustedExtensions && data.trustedExtensions.github) || {},
                msTrusted: (data.trustedExtensions && data.trustedExtensions.microsoft) || {},
                mcpTrusted: (data.trustedExtensions && data.trustedExtensions.mcpServers) || [],
                mcpConfigured: data.mcpServers.map(s => ({name:s.name, type:s.type, source:s.source, command:s.command})),
                copilotPolicy: (data.trustedExtensions && data.trustedExtensions.copilotPolicy) || null,
                activeCopilot: data.activeCopilotAccount
            }))}</div>
            `}
        </div>

        <!-- COPILOT & CHAT -->
        <div class="tab-panel active" id="panel-copilot">
            <div class="card">
                <div class="card-header"><div class="card-title"><span class="codicon codicon-comment-discussion"></span> ${vscode.l10n.t('Copilot Chat')}</div><span class="badge ${chatInstalled ? 'green' : 'red'}">${chatInstalled ? vscode.l10n.t('Installed') : vscode.l10n.t('Not Installed')}</span></div>
                <div class="card-body">
                    ${chatInstalled ? `<div class="info-grid">
                        <div class="info-row"><span class="info-label">${vscode.l10n.t('Version')}</span><span class="info-value">${data.copilot.copilotChat.version}</span></div>
                        <div class="info-row"><span class="info-label">${vscode.l10n.t('Status')}</span><span class="info-value">${data.copilot.copilotChat.active ? '<span class="status-ind active">' + vscode.l10n.t('Active') + '</span>' : '<span class="status-ind inactive">' + vscode.l10n.t('Inactive') + '</span>'}</span></div>
                        <div class="info-row"><span class="info-label">${vscode.l10n.t('Extension ID')}</span><span class="info-value">GitHub.copilot-chat</span></div>
                        <div class="info-row"><span class="info-label">${vscode.l10n.t('Last Used Account')}</span><span class="info-value">${data.activeCopilotAccount ? esc(data.activeCopilotAccount.label) + ' <span class="tag ' + (data.activeCopilotAccount.provider === 'github' ? 'tag-purple' : 'tag-orange') + '" style="margin-left:6px;font-size:0.72em;">' + esc(data.activeCopilotAccount.provider) + '</span> <span style="font-size:10px;color:var(--vscode-descriptionForeground);margin-left:4px;">' + new Date(data.activeCopilotAccount.lastUsed).toLocaleString() + '</span>' : '<em>' + vscode.l10n.t('Not signed in') + '</em>'}</span></div>
                    </div>` : `<div class="empty-state"><div class="empty-icon"><span class="codicon codicon-comment-discussion"></span></div><p>${vscode.l10n.t('GitHub Copilot Chat is not installed')}</p><p class="hint">${vscode.l10n.t('Without Copilot Chat, you cannot use the AI chat panel, inline chat, or voice features.')}</p><p class="hint">${vscode.l10n.t('No usage data or reports are available.')}</p></div>`}
                </div>
            </div>
            ${(!chatInstalled && !copilotInstalled) ? `
                <div class="card mt"><div class="card-body"><div class="info-banner warning"><span class="codicon codicon-warning"></span> <strong>${vscode.l10n.t('No Copilot extensions found.')}</strong> ${vscode.l10n.t('Without GitHub Copilot and Copilot Chat, no AI-powered features, usage reports, or suggestion data are available. Install them from the Extensions marketplace.')}</div></div></div>
            ` : ''}
            ${(chatInstalled || copilotInstalled) ? (() => {
                const currentWsSessions = data.chatSessions.filter(s => s.isCurrentWorkspace || (data.workspace.name && s.workspace === data.workspace.name));
                const recentWsSessions = currentWsSessions.slice(0, 5);
                return `
                <div class="card mt">
                    <div class="card-header"><div class="card-title"><span class="codicon codicon-comment-discussion"></span> ${vscode.l10n.t('Recent Chat Sessions')} <span class="recent-sessions-info-icon"><span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(88,166,255,0.15);color:#58a6ff;font-size:11px;font-weight:700;cursor:help;">?</span><div class="recent-sessions-info-tooltip">${vscode.l10n.t('Shows recent Copilot Chat sessions from the current workspace.')}<br><br>\u2022 ${vscode.l10n.t('Only sessions belonging to this workspace are displayed.')}<br>\u2022 ${vscode.l10n.t('Click Open to resume a session in the Chat panel.')}<br>\u2022 ${vscode.l10n.t('For all sessions across workspaces, see the Chat Sessions tab.')}<br><br>${vscode.l10n.t('Session types: Agent (Copilot agent mode), Ask (question mode), Chat (standard chat).')}</div></span></div><span class="badge">${recentWsSessions.length > 0 ? vscode.l10n.t('Latest ') + recentWsSessions.length : vscode.l10n.t('0 sessions')}</span></div>
                    <div class="card-body" style="padding:12px 16px;">
                        ${recentWsSessions.length === 0 ? '<div class="empty-state" style="padding:16px;"><div class="empty-icon"><span class="codicon codicon-comment-discussion"></span></div><p>' + vscode.l10n.t('No chat sessions found for this workspace') + '</p><p class="hint">' + vscode.l10n.t('Start a Copilot Chat conversation in this workspace to see your recent sessions here.') + '</p></div>' : `
                        <div class="recent-sessions-list">
                            ${recentWsSessions.map(s => {
                                const title = esc(s.title || vscode.l10n.t('Untitled Session'));
                                const typeLabel = (s.chatType === 'agent' || s.source === 'agentSession') ? vscode.l10n.t('Agent') : s.chatType === 'ask' ? vscode.l10n.t('Ask') : s.chatType === 'custom-agent' ? '@' + esc(s.agentName || 'custom') : vscode.l10n.t('Chat');
                                const typeClass = (s.chatType === 'agent' || s.source === 'agentSession') ? 'agent' : s.chatType === 'ask' ? 'ask' : s.chatType === 'custom-agent' ? 'custom' : 'chat';
                                const dateObj = new Date(s.lastMessageDate || s.creationDate);
                                const dateStr = dateObj.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
                                const timeStr = dateObj.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
                                const statusLabel = s.statusLabel || 'completed';
                                const statusClass = statusLabel;
                                return `<div class="recent-session-row">
                                    <div class="recent-session-info">
                                        <div class="recent-session-title" title="${title}">${title}</div>
                                        <div class="recent-session-meta">
                                            <span class="chat-source-badge ${typeClass}" style="font-size:8px;padding:1px 5px;">${typeLabel}</span>
                                            <span class="chat-status-badge ${statusClass}" style="font-size:8px;padding:1px 5px;">${statusLabel}</span>
                                            <span style="font-size:10px;color:var(--vscode-descriptionForeground);">${dateStr}, ${timeStr}</span>
                                            <span style="font-size:10px;color:var(--vscode-descriptionForeground);">${s.messageCount || 0} ${vscode.l10n.t('prompts')}</span>
                                        </div>
                                    </div>
                                    <button class="chat-open-btn" data-command="openChatSession" data-session-id="${esc(s.sessionId)}" data-session-title="${title}" title="${vscode.l10n.t('Open this session in VS Code Chat')}"><span class="codicon codicon-link-external"></span> ${vscode.l10n.t('Open')}</button>
                                </div>`;
                            }).join('')}
                        </div>
                        `}
                    </div>
                </div>
            `;})() : ''}
            ${(chatInstalled || copilotInstalled) ? `
                <div class="card mt">
                    <div class="card-header"><div class="card-title"><span class="codicon codicon-graph"></span> ${vscode.l10n.t('AI Usage Metrics')}</div><div class="card-header-actions"><span class="period-label" id="usagePeriodLabel"></span><button class="btn btn-sm btn-secondary btn-refresh-chart" id="refreshUsageBtn" title="${vscode.l10n.t('Refresh charts')}"><span class="codicon codicon-refresh"></span> ${vscode.l10n.t('Refresh')}</button></div></div>
                    <div class="card-body">
                        ${!aiStatsEnabled ? `<div class="info-banner warning" style="margin-bottom:12px;display:flex;align-items:flex-start;gap:8px;padding:10px 14px;border-radius:6px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25)"><span class="codicon codicon-warning" style="color:#f59e0b;flex-shrink:0;margin-top:2px"></span><div><strong style="color:#f59e0b">AI Stats collection is disabled</strong><br><span style="font-size:12px">The setting <code>editor.aiStats.enabled</code> is currently <strong>false</strong>. No new AI usage data is being recorded. <a href="#" data-command="openSettings" style="color:#f59e0b;text-decoration:underline;cursor:pointer">Open Settings</a> to enable it.${aiStatsStale ? '<br><br><span class="codicon codicon-info" style="margin-right:4px"></span>The data shown below is <strong>stale</strong> — last recorded on <strong>' + new Date(data.aiStats[data.aiStats.length - 1].startTime).toLocaleDateString() + '</strong>. Any coding activity since then has not been captured.' : ''}</span></div></div>` : ''}
                        ${data.aiStats.length === 0 && aiStatsEnabled ? '<div class="empty-state"><div class="empty-icon"><span class="codicon codicon-graph"></span></div><p>No AI usage data found yet</p><p class="hint">AI Stats collection is enabled. Data will appear after your first coding session.</p></div>' : data.aiStats.length === 0 ? '<div class="empty-state"><div class="empty-icon"><span class="codicon codicon-graph"></span></div><p>No AI usage data found</p><p class="hint"><a href="#" data-command="openSettings" style="text-decoration:underline;cursor:pointer">Open Settings</a> to enable <code>editor.aiStats.enabled</code> and start collecting real usage data.</p></div>' : '<div class="filter-bar"><div class="filter-group"><label class="filter-label"><span class="codicon codicon-calendar"></span> Period</label><div class="period-filters" id="usagePeriodFilters"><button class="period-btn" data-usage-period="today">Today</button><button class="period-btn active" data-usage-period="week">This Week</button><button class="period-btn" data-usage-period="last7">Last 7 Days</button><button class="period-btn" data-usage-period="last30">Last 30 Days</button><button class="period-btn" data-usage-period="month">This Month</button><button class="period-btn" data-usage-period="all">All</button></div></div></div><div class="usage-stats" id="usageStats"></div><div class="chart-section"><div class="chart-header"><h3 id="usageChartTitle">AI Acceptance Rate</h3><div class="chart-legend" id="usageChartLegend"></div></div><div class="chart-desc"><span class="info-icon">\u2139\ufe0f</span> Shows what percentage of your total code was generated by AI (Copilot) each day. Green bars = high AI usage (>70%), blue = moderate (40-70%), amber = low (<40%). Empty bars mean no coding activity on that day.</div><div class="bar-chart" id="usageBarChart"></div></div>'}
                    </div>
                </div>
            ` : ''}
        </div>

        <!-- TRENDS embedded in AI STATS below -->

        <!-- AI STATS (Real Data from state.vscdb) -->
        <div class="tab-panel" id="panel-aistats">
            <div class="aistats-layout">
            <div class="aistats-main">
                <div class="card-header"><div class="card-title"><span class="codicon codicon-graph-line"></span> AI Stats — Real Usage Data</div><div class="card-header-actions"><span class="period-label" id="aiStatsPeriodLabel"></span><span class="badge">${data.aiStats.length} records</span><button class="btn btn-sm btn-secondary btn-refresh-chart" id="refreshAiStatsBtn" title="Refresh charts"><span class="codicon codicon-refresh"></span> Refresh</button></div></div>
                <div class="card-body">
                    ${!aiStatsEnabled ? `<div class="info-banner warning" style="margin-bottom:12px;display:flex;align-items:flex-start;gap:8px;padding:10px 14px;border-radius:6px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25)"><span class="codicon codicon-warning" style="color:#f59e0b;flex-shrink:0;margin-top:2px"></span><div><strong style="color:#f59e0b">AI Stats collection is disabled</strong><br><span style="font-size:12px">The setting <code>editor.aiStats.enabled</code> is currently <strong>false</strong>. No new data is being recorded.${aiStatsStale ? ' The data below is <strong>stale</strong> — last recorded on <strong>' + new Date(data.aiStats[data.aiStats.length - 1].startTime).toLocaleDateString() + '</strong>.' : ''} <a href="#" data-command="openSettings" style="color:#f59e0b;text-decoration:underline;cursor:pointer">Open Settings</a> to enable it.</span></div></div>` : ''}
                    ${data.aiStats.length === 0 && aiStatsEnabled ? `<div class="empty-state"><div class="empty-icon"><span class="codicon codicon-graph-line"></span></div><p>No AI stats data found yet</p><p class="hint">AI Stats collection is enabled. Data will appear after your first coding session.</p></div>` : data.aiStats.length === 0 ? `<div class="empty-state"><div class="empty-icon"><span class="codicon codicon-graph-line"></span></div><p>No AI stats data found</p><p class="hint"><a href="#" data-command="openSettings" style="text-decoration:underline;cursor:pointer">Open Settings</a> to enable <code>editor.aiStats.enabled</code> and start collecting usage data.</p></div>` : `
                    <div class="filter-bar">
                        <div class="filter-group">
                            <label class="filter-label"><span class="codicon codicon-calendar"></span> Period</label>
                            <div class="period-filters" id="aiStatsPeriodFilters">
                                <button class="period-btn" data-ai-period="today">Today</button>
                                <button class="period-btn active" data-ai-period="week">This Week</button>
                                <button class="period-btn" data-ai-period="last7">Last 7 Days</button>
                                <button class="period-btn" data-ai-period="last30">Last 30 Days</button>
                                <button class="period-btn" data-ai-period="month">This Month</button>
                                <button class="period-btn" data-ai-period="all">All</button>
                            </div>
                        </div>
                        <div class="filter-group">
                            <label class="filter-label"><span class="codicon codicon-server"></span> Workspace</label>
                            <select id="aiStatsWsFilter" class="filter-select">
                                <option value="all">All Workspaces</option>
                            </select>
                        </div>
                    </div>

                    <!-- Scoreboard Row -->
                    <div class="ai-scoreboard" id="aiScoreboard"></div>

                    <!-- Heatmap Calendar -->
                    <div class="card mt" style="margin-top:16px;">
                        <div class="card-header collapsible-header" data-collapse="heatmap-section" style="cursor:pointer;">
                            <div class="card-title"><span class="codicon codicon-calendar"></span> Activity Heatmap</div>
                            <div class="card-header-actions"><span class="collapse-chevron" data-collapse-icon="heatmap-section" style="display:inline-block;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--vscode-descriptionForeground);transition:transform 0.15s;"></span></div>
                        </div>
                        <div data-collapse-body="heatmap-section" style="padding:12px;overflow-x:auto;">
                            <div class="heatmap-container" id="aiHeatmap"></div>
                        </div>
                    </div>

                    <!-- AI Rate Chart -->
                    <div class="card mt" style="margin-top:16px;">
                        <div class="card-header collapsible-header" data-collapse="airate-section" style="cursor:pointer;">
                            <div class="card-title"><span class="codicon codicon-graph-line"></span> <span id="aiStatsChartTitle">AI Rate</span></div>
                            <div class="card-header-actions"><div class="chart-legend" id="aiStatsLegend"></div><span class="collapse-chevron" data-collapse-icon="airate-section" style="display:inline-block;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--vscode-descriptionForeground);transition:transform 0.15s;margin-left:8px;"></span></div>
                        </div>
                        <div data-collapse-body="airate-section">
                            <div class="chart-section" style="padding:0 16px 16px;">
                                <div class="chart-desc"><span class="info-icon">\u2139\ufe0f</span> AI-generated code percentage per day. Green = high (>70%), blue = moderate, amber = low.</div>
                                <div class="bar-chart" id="aiStatsBarChart"></div>
                            </div>
                        </div>
                    </div>

                    <!-- AI vs Typed Characters -->
                    <div class="card mt" style="margin-top:16px;">
                        <div class="card-header collapsible-header" data-collapse="chars-section" style="cursor:pointer;">
                            <div class="card-title"><span class="codicon codicon-code"></span> AI vs Typed Characters</div>
                            <div class="card-header-actions"><span class="collapse-chevron" data-collapse-icon="chars-section" style="display:inline-block;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--vscode-descriptionForeground);transition:transform 0.15s;transform:rotate(-90deg);"></span></div>
                        </div>
                        <div data-collapse-body="chars-section" style="display:none;">
                            <div class="chart-section" style="padding:0 16px 16px;">
                                <div class="chart-desc"><span class="info-icon">\u2139\ufe0f</span> Compares AI-generated characters (blue) against manually typed characters (purple).</div>
                                <div class="bar-chart" id="aiStatsStackedChart"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Accepted Inline Suggestions -->
                    <div class="card mt" style="margin-top:16px;">
                        <div class="card-header collapsible-header" data-collapse="suggestions-section" style="cursor:pointer;">
                            <div class="card-title"><span class="codicon codicon-lightbulb"></span> Accepted Inline Suggestions</div>
                            <div class="card-header-actions"><div class="chart-legend" id="suggestionsLegend"></div><span class="collapse-chevron" data-collapse-icon="suggestions-section" style="display:inline-block;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--vscode-descriptionForeground);transition:transform 0.15s;transform:rotate(-90deg);"></span></div>
                        </div>
                        <div data-collapse-body="suggestions-section" style="display:none;">
                            <div class="chart-section" style="padding:0 16px 16px;">
                                <div class="chart-desc"><span class="info-icon">\u2139\ufe0f</span> How many times you pressed Tab to accept a Copilot inline suggestion.</div>
                                <div class="bar-chart" id="aiStatsSuggestionsChart"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Chat Edits -->
                    <div class="card mt" style="margin-top:16px;">
                        <div class="card-header collapsible-header" data-collapse="chatedits-section" style="cursor:pointer;">
                            <div class="card-title"><span class="codicon codicon-comment-discussion"></span> Chat Edits</div>
                            <div class="card-header-actions"><div class="chart-legend" id="chatEditsLegend"></div><span class="collapse-chevron" data-collapse-icon="chatedits-section" style="display:inline-block;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--vscode-descriptionForeground);transition:transform 0.15s;transform:rotate(-90deg);"></span></div>
                        </div>
                        <div data-collapse-body="chatedits-section" style="display:none;">
                            <div class="chart-section" style="padding:0 16px 16px;">
                                <div class="chart-desc"><span class="info-icon">\u2139\ufe0f</span> Code changes made through Copilot Chat.</div>
                                <div class="bar-chart" id="aiStatsChatEditsChart"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Sessions Activity -->
                    <div class="card mt" style="margin-top:16px;">
                        <div class="card-header collapsible-header" data-collapse="sessions-section" style="cursor:pointer;">
                            <div class="card-title"><span class="codicon codicon-history"></span> Sessions Activity</div>
                            <div class="card-header-actions"><div class="chart-legend" id="sessionsLegend"></div><span class="collapse-chevron" data-collapse-icon="sessions-section" style="display:inline-block;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--vscode-descriptionForeground);transition:transform 0.15s;transform:rotate(-90deg);"></span></div>
                        </div>
                        <div data-collapse-body="sessions-section" style="display:none;">
                            <div class="chart-section" style="padding:0 16px 16px;">
                                <div class="chart-desc"><span class="info-icon">\u2139\ufe0f</span> Number of coding sessions per day.</div>
                                <div class="bar-chart" id="aiStatsSessionsChart"></div>
                            </div>
                        </div>
                    </div>
                    `}
                </div>
            </div>

            <!-- Right Column: Usage Trends & Insights (collapsible side panel) -->
            <div class="aistats-trends-col collapsed" id="trendsSidePanel">
                <div class="trends-sidebar-tab" id="trendsSidebarTab" title="Toggle Usage Trends & Insights">
                    <span class="tab-arrow" id="trendsSideArrow" style="font-size:14px;">◀</span>
                    <span class="tab-icon">📈</span>
                    <span class="tab-label">Usage Trends & Insights</span>
                </div>
                <div class="trends-panel-content">
                    <div style="padding:12px;">
                        <div style="font-size:13px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:6px;"><span class="codicon codicon-pulse"></span> Usage Trends &amp; Insights</div>
                        ${data.aiStats && data.aiStats.length > 0 ? getTrendsTabHTML(data, aiStatsEnabled) : '<div class="empty-state" style="padding:16px;">No trend data available</div>'}
                    </div>
                </div>
            </div>
            </div>
        </div>

        <!-- SESSIONS & HISTORY -->
        <div class="tab-panel" id="panel-sessions">
            <div class="card">
                <div class="card-header">
                    <div class="card-title"><span class="codicon codicon-comment-discussion"></span> Copilot Chat Sessions</div>
                    <div class="card-header-actions">
                        <span class="badge">${data.chatSessions.length} sessions</span>
                    </div>
                </div>
                <div class="card-body">
                    ${data.chatSessions.length === 0 ? `<div class="empty-state"><div class="empty-icon"><span class="codicon codicon-comment-discussion"></span></div><p>No chat sessions found</p><p class="hint">Start a Copilot Chat conversation to see your session history here.</p></div>` : `
                    <div class="filter-bar" style="flex-wrap:wrap;">
                        <div class="filter-group">
                            <label class="filter-label"><span class="codicon codicon-filter"></span> Filter By</label>
                            <select id="chatTypeFilter" class="filter-select" style="min-width:150px;">
                                <option value="all">All Types</option>
                            </select>
                        </div>
                        <div class="filter-group">
                            <label class="filter-label"><span class="codicon codicon-server"></span> Workspace</label>
                            <select id="chatWsFilter" class="filter-select">
                                <option value="all">All Workspaces</option>
                            </select>
                        </div>
                        <div class="filter-group">
                            <label class="filter-label"><span class="codicon codicon-sort-precedence"></span> Sort By</label>
                            <select id="chatSortBy" class="filter-select" style="min-width:140px;">
                                <option value="newest">Newest First</option>
                                <option value="oldest">Oldest First</option>
                                <option value="most-msgs">Most Messages</option>
                                <option value="name-asc">Name A\u2192Z</option>
                            </select>
                        </div>
                        <div class="filter-group">
                            <label class="filter-label"><span class="codicon codicon-search"></span> Search</label>
                            <input type="text" id="chatSearchInput" class="filter-select" placeholder="Search sessions..." style="min-width:200px;" />
                        </div>
                    </div>
                    <div class="chat-sessions-summary" id="chatSessionsSummary"></div>
                    <div class="info-banner warning" style="margin-bottom:16px;font-size:11px;">
                        <span class="codicon codicon-info" style="flex-shrink:0;margin-top:2px;"></span>
                        <div>
                            <strong>Session reopening is workspace-scoped.</strong> You can only reopen sessions that belong to the currently active workspace. Sessions from other workspaces are shown for reference but must be opened from their original workspace. Current workspace sessions are highlighted with a left border.
                        </div>
                    </div>
                    <div class="chat-sessions-list" id="chatSessionsList"></div>
                    <div class="sessions-pagination" id="chatSessionsPagination"></div>
                    `}
                </div>
            </div>
        </div>

        <!-- MODELS & MCP -->
        <div class="tab-panel" id="panel-infra">
            <div class="card">
                <div class="card-header"><div class="card-title"><span class="codicon codicon-plug"></span> MCP Servers</div><span class="badge">${data.mcpServers.length} found</span></div>
                <div class="card-body" style="max-height:280px;overflow-y:auto;">
                    ${data.mcpServers.length === 0 ? `<div class="empty-state"><div class="empty-icon"><span class="codicon codicon-plug"></span></div><p>No MCP server configurations found</p><p class="hint">MCP servers are configured in <code>.vscode/mcp.json</code>, workspace <code>mcp.json</code>, or VS Code settings.</p></div>` : `
                    <div class="mcp-server-list">
                        ${data.mcpServers.map(srv => {
                            return `
                            <div class="mcp-server-card">
                                <div class="mcp-server-left">
                                    <div class="mcp-server-icon default"><span class="codicon codicon-plug"></span></div>
                                    <div class="mcp-server-details">
                                        <div class="mcp-server-name">${esc(srv.name)}</div>
                                        <div class="mcp-server-meta">
                                            <span class="tag tag-blue">${esc(srv.type)}</span>
                                            <span class="tag ${srv.source === 'settings' ? 'tag-purple' : 'tag-gray'}">${srv.source === 'settings' ? 'settings.json' : 'mcp.json'}</span>
                                        </div>
                                        <div class="mcp-server-path">Config: ${esc(srv.configPath)}</div>
                                    </div>
                                </div>
                                ${srv.source === 'file' ? `<button class="btn btn-sm btn-secondary" data-command="openMcpConfig" data-arg="${esc(srv.configPath)}"><span class="codicon codicon-go-to-file"></span> Open</button>` : ''}
                            </div>`;
                        }).join('')}
                    </div>`}
                </div>
            </div>

            <div class="card mt">
                <div class="card-header"><div class="card-title"><span class="codicon codicon-hubot"></span> Language Models</div><span class="badge">${data.languageModels.length} models</span></div>
                <div class="card-body" style="max-height:280px;overflow-y:auto;padding:0;">
                    ${data.languageModels.length === 0 ? `<div class="empty-state"><div class="empty-icon"><span class="codicon codicon-hubot"></span></div><p>No language models available</p><p class="hint">${!copilotInstalled ? 'Install GitHub Copilot to access models' : !data.readiness.hasGithubSession ? 'Sign in to GitHub to access Copilot models' : 'Models may take a moment to load after sign-in'}</p></div>` : `
                    <div class="models-table">
                        <table class="data-table">
                            <thead><tr><th>Model</th><th>Vendor</th><th>Family</th><th>Version</th><th>Max Input</th></tr></thead>
                            <tbody>
                                ${data.languageModels.map(m => `<tr><td><strong>${esc(m.name || m.id)}</strong></td><td>${esc(m.vendor)}</td><td><span class="tag tag-blue">${esc(m.family)}</span></td><td>${esc(m.version)}</td><td>${m.maxInputTokens ? (m.maxInputTokens/1000).toFixed(0)+'K tokens' : 'N/A'}</td></tr>`).join('')}
                            </tbody>
                        </table>
                    </div>`}
                </div>
            </div>
            ${mcpToolsCount > 0 ? `
            <div class="card mt">
                <div class="card-header"><div class="card-title"><span class="codicon codicon-tools"></span> MCP-Provided Tools</div><span class="badge">${mcpToolsCount} tools</span></div>
                <div class="card-body" style="max-height:280px;overflow-y:auto;">
                    <div class="tools-list">${data.registeredTools.filter(t=>t.name.startsWith('mcp_')).map(t => `
                        <div class="tool-item"><div class="tool-name">${esc(t.name)}</div><div class="tool-desc">${esc(t.description.substring(0,120))}${t.description.length>120?'...':''}</div><div class="tool-tags">${t.tags.map(tag=>`<span class="tag tag-gray">${esc(tag)}</span>`).join('')}</div></div>
                    `).join('')}</div>
                </div>
            </div>` : ''}
        </div>

        <!-- INFO -->
        <div class="tab-panel" id="panel-info">
            <div class="info-tab-header">
                <span class="codicon codicon-info" style="font-size:28px;color:var(--vscode-textLink-foreground)"></span>
                <div>
                    <h2 style="font-size:18px;font-weight:700;margin-bottom:2px">About GitHub Copilot Insights Dashboard</h2>
                    <p style="font-size:12px;color:var(--vscode-descriptionForeground)">Prerequisites, data sources &amp; important notes</p>
                </div>
            </div>

            <!-- What happens without extensions/accounts -->
            <div class="card mt">
                <div class="card-header"><div class="card-title"><span class="codicon codicon-warning"></span> What If Something Is Missing?</div></div>
                <div class="card-body">
                    <div class="impact-table">
                        <div class="impact-row impact-header">
                            <div class="impact-cell">Missing Item</div>
                            <div class="impact-cell">Impact on Dashboard</div>
                        </div>
                        <div class="impact-row">
                            <div class="impact-cell"><strong>No GitHub Copilot extension</strong></div>
                            <div class="impact-cell">Copilot &amp; Chat tab shows "not installed". No inline suggestion data.</div>
                        </div>
                        <div class="impact-row">
                            <div class="impact-cell"><strong>No GitHub Copilot Chat extension</strong></div>
                            <div class="impact-cell">AI Stats charts will be empty. No chat edit counts, no agent mode tracking.</div>
                        </div>
                        <div class="impact-row">
                            <div class="impact-cell"><strong>No GitHub account signed in</strong></div>
                            <div class="impact-cell">Accounts tab is empty. Active Copilot account cannot be determined. Extension trust data unavailable.</div>
                        </div>
                        <div class="impact-row">
                            <div class="impact-cell"><strong>No Microsoft account signed in</strong></div>
                            <div class="impact-cell">MCP server auth shows "No Microsoft account linked". Azure DevOps MCP tools won't authenticate.</div>
                        </div>
                        <div class="impact-row">
                            <div class="impact-cell"><strong>Both extensions + accounts missing</strong></div>
                            <div class="impact-cell">Full "not set up" screen is shown instead of all tabs. No data available.</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Data Sources -->
            <div class="card mt">
                <div class="card-header"><div class="card-title"><span class="codicon codicon-database"></span> Data Sources</div></div>
                <div class="card-body">
                    <div class="info-banner warning" style="margin-bottom:16px">
                        <span class="codicon codicon-info" style="flex-shrink:0;margin-top:2px"></span>
                        <div>
                            <strong>All data is sourced locally from VS Code.</strong><br>
                            This dashboard reads data directly from VS Code APIs and local state databases on your machine. It does <strong>not</strong> call any external server or GitHub API. Because of this, the data reflects your <strong>local VS Code state</strong> and may differ from what you see on github.com or other server-side dashboards.
                        </div>
                    </div>
                    <div class="impact-table">
                        <div class="impact-row impact-header">
                            <div class="impact-cell">Tab / Data</div>
                            <div class="impact-cell">Source</div>
                            <div class="impact-cell">Notes</div>
                        </div>
                        <div class="impact-row">
                            <div class="impact-cell"><strong>Copilot &amp; Chat</strong></div>
                            <div class="impact-cell"><code>vscode.extensions</code> API + State DB</div>
                            <div class="impact-cell">Extension install status, version, active account, AI usage metrics with period filters and charts.</div>
                        </div>
                        <div class="impact-row">
                            <div class="impact-cell"><strong>AI Stats</strong></div>
                            <div class="impact-cell">Workspace Storage <code>state.vscdb</code></div>
                            <div class="impact-cell">Real AI data — AI code rate, typed vs AI characters, accepted suggestions, chat edits, sessions activity. Filterable by workspace and period.</div>
                        </div>
                        <div class="impact-row">
                            <div class="impact-cell"><strong>Chat Sessions</strong></div>
                            <div class="impact-cell"><code>agentSessions.model.cache</code> + <code>chatSessions/*.json</code> + <code>chatEditingSessions/</code></div>
                            <div class="impact-cell">All Copilot chat sessions across workspaces — Agent, Ask, Chat &amp; Custom Agent modes. View session history, code changes, files touched. Reopen sessions from the current workspace. Filter by type, workspace, and search.</div>
                        </div>
                        <div class="impact-row">
                            <div class="impact-cell"><strong>Accounts</strong></div>
                            <div class="impact-cell"><code>vscode.authentication</code> API + State DB</div>
                            <div class="impact-cell">All GitHub / Microsoft / GHE accounts, session status, trusted extensions per account, Copilot policy data.</div>
                        </div>
                        <div class="impact-row">
                            <div class="impact-cell"><strong>Models</strong></div>
                            <div class="impact-cell"><code>vscode.lm</code> API</div>
                            <div class="impact-cell">Available language models with vendor, family, version, and max input token limits.</div>
                        </div>
                        <div class="impact-row">
                            <div class="impact-cell"><strong>MCP Servers</strong></div>
                            <div class="impact-cell"><code>.vscode/mcp.json</code> + Settings</div>
                            <div class="impact-cell">All configured MCP servers, their registered tools, config file paths, and authentication status.</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Important Notes -->
            <div class="card mt">
                <div class="card-header"><div class="card-title"><span class="codicon codicon-lightbulb"></span> Important Notes</div></div>
                <div class="card-body">
                    <div class="notes-list">
                        <div class="note-item">
                            <span class="note-icon"><span class="codicon codicon-clock"></span></span>
                            <div>
                                <strong>Data may be delayed</strong>
                                <p>VS Code writes AI stats at the end of coding sessions. If you're actively coding, the latest session data won't appear until VS Code flushes it to disk. Try refreshing after switching workspaces or restarting VS Code.</p>
                            </div>
                        </div>
                        <div class="note-item">
                            <span class="note-icon"><span class="codicon codicon-sync"></span></span>
                            <div>
                                <strong>Local data only — not server data</strong>
                                <p>The numbers shown here reflect data stored on <strong>this machine only</strong>. If you use Copilot across multiple machines, each machine has its own local data. This will not match server-side totals on github.com.</p>
                            </div>
                        </div>
                        <div class="note-item">
                            <span class="note-icon"><span class="codicon codicon-folder-opened"></span></span>
                            <div>
                                <strong>AI Stats are per-workspace</strong>
                                <p>VS Code stores AI stats in individual workspace storage folders. The dashboard aggregates across all workspaces, but the "Workspace" filter lets you drill into specific ones.</p>
                            </div>
                        </div>
                        <div class="note-item">
                            <span class="note-icon"><span class="codicon codicon-shield"></span></span>
                            <div>
                                <strong>No external calls</strong>
                                <p>This extension makes <strong>zero network requests</strong>. All data is read from local VS Code APIs and files. Your data stays on your machine.</p>
                            </div>
                        </div>
                        <div class="note-item">
                            <span class="note-icon"><span class="codicon codicon-calendar"></span></span>
                            <div>
                                <strong>Zero data on some days is normal</strong>
                                <p>If no coding sessions were recorded on a particular day (weekends, holidays, no VS Code usage), charts will show zero. This is expected behavior, not a bug.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- FAQ -->
            <div class="card mt">
                <div class="card-header"><div class="card-title"><span class="codicon codicon-question"></span> Frequently Asked Questions</div></div>
                <div class="card-body">
                    <div class="notes-list">
                        <div class="note-item">
                            <span class="note-icon"><span class="codicon codicon-settings-gear"></span></span>
                            <div>
                                <strong>What is <code>editor.aiStats.enabled</code>?</strong>
                                <p>This is a VS Code setting that controls whether AI usage data (typed characters, AI-generated characters, accepted suggestions, chat edits) is collected and stored locally. When <strong>disabled</strong>, no new data is recorded and the dashboard cannot show current activity.</p>
                            </div>
                        </div>
                        <div class="note-item">
                            <span class="note-icon"><span class="codicon codicon-warning"></span></span>
                            <div>
                                <strong>Why is my AI data showing only old records?</strong>
                                <p>If <code>editor.aiStats.enabled</code> was turned off (or reset to <code>false</code>), VS Code stops recording AI usage. The dashboard will continue to show previously collected data, but no new data is captured. You may see a gap in your charts. To fix this, open Settings (<code>Ctrl+,</code>), search for <code>editor.aiStats.enabled</code>, and set it to <code>true</code>. New data will start appearing after your next coding session.</p>
                            </div>
                        </div>
                        <div class="note-item">
                            <span class="note-icon"><span class="codicon codicon-history"></span></span>
                            <div>
                                <strong>Can I recover data from when the setting was off?</strong>
                                <p>No. When <code>editor.aiStats.enabled</code> is <code>false</code>, VS Code does not record any AI metrics. Data for the period when the setting was disabled is permanently lost and cannot be recovered.</p>
                            </div>
                        </div>
                        <div class="note-item">
                            <span class="note-icon"><span class="codicon codicon-refresh"></span></span>
                            <div>
                                <strong>Why does the setting keep getting disabled?</strong>
                                <p>This can happen if VS Code updates reset the setting, if Settings Sync overwrites it from another machine, or if a workspace-level setting overrides the global value. Check both your User and Workspace settings to ensure it is <code>true</code> at the correct level.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Version Info -->
            <div class="card mt" style="margin-bottom:16px">
                <div class="card-header"><div class="card-title"><span class="codicon codicon-versions"></span> Extension Info</div></div>
                <div class="card-body">
                    <div class="info-grid">
                        <div class="info-row"><span class="info-label">Extension</span><span class="info-value">${esc(this._context.extension.packageJSON.displayName || this._context.extension.packageJSON.name)}</span></div>
                        <div class="info-row"><span class="info-label">Version</span><span class="info-value">${esc(this._context.extension.packageJSON.version)}</span></div>
                        <div class="info-row"><span class="info-label">Publisher</span><span class="info-value">${esc(this._context.extension.packageJSON.publisher)}</span></div>
                        <div class="info-row"><span class="info-label">Extension ID</span><span class="info-value">${esc(this._context.extension.id)}</span></div>
                        <div class="info-row"><span class="info-label">Author</span><span class="info-value">Jadhav Shubhamm</span></div>
                        <div class="info-row"><span class="info-label">License</span><span class="info-value">${esc(this._context.extension.packageJSON.license || 'N/A')}</span></div>
                        <div class="info-row"><span class="info-label">VS Code Engine</span><span class="info-value">${esc((this._context.extension.packageJSON.engines && this._context.extension.packageJSON.engines.vscode) || 'N/A')}</span></div>
                        <div class="info-row"><span class="info-label">Data</span><span class="info-value">100% Local — No simulated or dummy data</span></div>
                        <div class="info-row"><span class="info-label">Last Refresh</span><span class="info-value">${new Date(data.timestamp).toLocaleString()}</span></div>
                    </div>
                </div>
            </div>
        </div>


    </div>
    `}

    <footer class="footer">
        <div class="footer-top"><span>Last refreshed: ${new Date(data.timestamp).toLocaleString()}</span><span>·</span><span>Workspace: ${esc(data.workspace.name)}</span></div>
        <div class="footer-sig">
            <span class="sig-name">Author — Jadhav Shubhamm</span>
            <span class="sig-tagline">🦊 CodeFox — 🚀 Driving AI-Powered Delivery Excellence</span>
            <span class="sig-links"><a href="mailto:sj.techconnect@gmail.com">sj.techconnect@gmail.com</a></span>
        </div>
    </footer>
</div>
<script nonce="${nonce}">${getJS(sanitizeJsonForScript(data.aiStats), sanitizeJsonForScript(data.chatSessions), sanitizeJsonForScript(data.workspace.name))}</script>
</body>
</html>`;
    }

    /**
     * Disposes the panel and clears the static reference.
     * @see Called automatically when the panel is closed
     */
    dispose() { DashboardPanel.currentPanel = null; this._disposed = true; this._panel.dispose(); }
}

/**
 * Generates a 32-character random alphanumeric nonce for Content Security Policy.
 * @returns {string}
 */
function getNonce() {
    let t=''; const c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for(let i=0;i<32;i++) t+=c.charAt(Math.floor(Math.random()*c.length)); return t;
}
/**
 * Safely serializes data to JSON for embedding inside a <script> template literal.
 * Escapes </script>, backticks, and ${} to prevent breaking out of the script context.
 * @param {*} data - Any JSON-serializable data
 * @returns {string} Safe JSON string for script embedding
 */
function sanitizeJsonForScript(data) {
    return JSON.stringify(data)
        .replace(/<\//g, '<\\/')       // prevent </script> closing the tag
        .replace(/`/g, '\\`')          // escape backticks (template literal delimiter)
        .replace(/\$\{/g, '\\${');     // escape ${} (template literal interpolation)
}

/**
 * Escapes HTML special characters (&, <, >, ", ') for safe webview rendering.
 * @param {string} s - Raw string
 * @returns {string} HTML-escaped string
 */
function esc(s) {
    if(!s)return''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/**
 * Returns all CSS styles for the dashboard webview panel.
 * Uses VS Code CSS variables for theme-aware styling.
 * @returns {string} CSS stylesheet content
 */
function getCSS() {
    return `
        :root { --card-bg:var(--vscode-editor-background); --card-border:var(--vscode-panel-border); --hover-bg:var(--vscode-list-hoverBackground); }
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:var(--vscode-font-family); font-size:13px; color:var(--vscode-foreground); background:var(--vscode-editor-background); }
        .dashboard { max-width:1200px; margin:0 auto; padding:20px; }
        .header { display:flex; align-items:center; justify-content:space-between; padding:16px 0; margin-bottom:8px; flex-wrap:wrap; gap:8px; }
        .title { font-size:18px; font-weight:700; display:flex; align-items:center; gap:8px; }
        .subtitle { font-size:12px; color:var(--vscode-descriptionForeground); margin-top:2px; display:block; }
        .header-right { display:flex; gap:8px; align-items:center; }
        .btn { display:inline-flex; align-items:center; gap:6px; padding:6px 14px; border:none; border-radius:4px; font-size:12px; font-weight:500; cursor:pointer; font-family:inherit; }
        .btn-primary { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
        .btn-primary:hover { background:var(--vscode-button-hoverBackground); }
        .btn-secondary { background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); }
        .btn-secondary:hover { background:var(--vscode-button-secondaryHoverBackground); }
        .btn-icon { padding:6px 8px; background:transparent; color:var(--vscode-foreground); border:1px solid var(--card-border); border-radius:4px; }
        .btn-icon:hover { background:var(--hover-bg); }
        .btn-sm { padding:4px 8px; font-size:11px; }
        .alert { padding:10px 14px; border-radius:6px; margin-bottom:12px; font-size:12px; display:flex; align-items:center; gap:8px; }
        .alert-success { background:rgba(34,197,94,0.08); border:1px solid rgba(34,197,94,0.25); color:#22c55e; }
        .alert-warning { background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.25); color:#f59e0b; }
        .alert-error { background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); color:#ef4444; }
        .issues-box { margin-bottom:12px; padding:8px 14px; background:rgba(245,158,11,0.05); border-radius:4px; }
        .issue-row { font-size:12px; padding:3px 0; color:var(--vscode-descriptionForeground); display:flex; align-items:center; gap:8px; }
        .issue-row .codicon { font-size:6px; color:#f59e0b; }
        .tabs { display:flex; gap:4px; margin-bottom:20px; flex-wrap:wrap; padding:4px; background:rgba(110,118,129,0.06); border-radius:10px; }
        .tab { flex:1 1 auto; padding:8px 14px; background:none; border:none; border-left:3px solid transparent; color:var(--vscode-descriptionForeground); font-size:11px; font-weight:500; cursor:pointer; border-radius:8px; font-family:inherit; transition:all 0.2s; display:inline-flex; align-items:center; justify-content:center; gap:5px; position:relative; white-space:nowrap; }
        .tab:hover { color:var(--vscode-foreground); background:rgba(110,118,129,0.1); }
        .tab.active { color:var(--vscode-button-foreground); background:var(--vscode-button-background); box-shadow:0 2px 6px rgba(0,0,0,0.18); font-weight:600; border-left-color:transparent; }
        .tab.active:hover { background:var(--vscode-button-hoverBackground); }
        .tab-panel { display:none; }
        .tab-panel.active { display:block; }
        .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        @media(max-width:700px){.grid-2{grid-template-columns:1fr}}
        .card { background:var(--card-bg); border:1px solid var(--card-border); border-radius:8px; }
        .card-header { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid var(--card-border); }
        .card-header-actions { display:flex; align-items:center; gap:8px; }
        .period-label { font-size:12px; font-weight:600; color:var(--vscode-foreground); padding:3px 10px; background:rgba(88,166,255,0.1); border-radius:10px; }
        .btn-refresh-chart { padding:4px 6px !important; min-width:auto; }
        .btn-refresh-chart .codicon { font-size:12px; }
        .card-title { font-size:14px; font-weight:600; display:flex; align-items:center; gap:8px; }
        .card-body { padding:16px 18px; }
        .mt { margin-top:16px; }
        .badge { padding:3px 10px; border-radius:12px; font-size:11px; font-weight:600; background:rgba(110,118,129,0.15); color:var(--vscode-descriptionForeground); }
        .badge.green { background:rgba(34,197,94,0.15); color:#22c55e; }
        .badge.red { background:rgba(239,68,68,0.15); color:#ef4444; }
        .badge.blue { background:rgba(88,166,255,0.15); color:#58a6ff; }
        .badge.purple { background:rgba(167,139,250,0.15); color:#a78bfa; }
        .account-card { display:flex; align-items:center; justify-content:space-between; padding:14px; border:1px solid var(--card-border); border-radius:6px; margin-bottom:8px; transition:background 0.15s; }
        .account-card:hover { background:var(--hover-bg); }
        .account-card.primary { border-left:3px solid var(--vscode-focusBorder); }
        .account-card-left { display:flex; align-items:center; gap:12px; flex:1; min-width:0; }
        .avatar { width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0; }
        .avatar.gh { background:rgba(110,118,129,0.2); }
        .avatar.ms { background:rgba(0,120,212,0.2); color:#0078d4; }
        .avatar.ghe { background:rgba(167,139,250,0.2); color:#a78bfa; }
        .account-details { min-width:0; }
        .account-name { font-size:14px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .account-sub { font-size:11px; color:var(--vscode-descriptionForeground); margin-top:2px; }
        .account-tags { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
        .tag { padding:2px 8px; border-radius:10px; font-size:10px; font-weight:600; }
        .tag-green { background:rgba(34,197,94,0.15); color:#22c55e; }
        .tag-gray { background:rgba(110,118,129,0.15); color:var(--vscode-descriptionForeground); }
        .tag-blue { background:rgba(88,166,255,0.15); color:#58a6ff; }
        .tag-purple { background:rgba(167,139,250,0.15); color:#a78bfa; }
        .tag-orange { background:rgba(245,158,11,0.15); color:#f59e0b; }
        .summary-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:12px; }
        .summary-grid.sm { grid-template-columns:repeat(3,1fr); }
        .summary-item { text-align:center; padding:16px; border:1px solid var(--card-border); border-radius:6px; }
        .summary-value { font-size:28px; font-weight:800; }
        .summary-label { font-size:11px; color:var(--vscode-descriptionForeground); margin-top:4px; }
        .info-grid { display:flex; flex-direction:column; }
        .info-row { display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--card-border); }
        .info-row:last-child { border-bottom:none; }
        .info-label { color:var(--vscode-descriptionForeground); }
        .info-value { font-weight:600; }
        .status-ind { padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; }
        .status-ind.active { background:rgba(34,197,94,0.15); color:#22c55e; }
        .status-ind.inactive { background:rgba(239,68,68,0.15); color:#ef4444; }
        .usage-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:24px; }
        @media(max-width:700px){.usage-stats{grid-template-columns:1fr 1fr}}
        .ai-scoreboard { display:flex; gap:4px; margin-bottom:16px; padding:10px 14px; background:rgba(110,118,129,0.04); border:1px solid var(--card-border); border-radius:8px; flex-wrap:wrap; align-items:center; }
        .ai-scoreboard .sb-item { display:flex; align-items:center; gap:6px; padding:0 10px; border-right:1px solid var(--card-border); font-size:12px; white-space:nowrap; }
        .ai-scoreboard .sb-item:last-child { border-right:none; }
        .ai-scoreboard .sb-val { font-weight:800; font-size:16px; }
        .ai-scoreboard .sb-lbl { font-size:10px; color:var(--vscode-descriptionForeground); }
        .ai-scoreboard .sb-delta { font-size:9px; font-weight:600; margin-left:2px; }
        .ai-scoreboard .sb-delta.up { color:#22c55e; }
        .ai-scoreboard .sb-delta.down { color:#ef4444; }
        .ai-scoreboard .sb-delta.flat { color:var(--vscode-descriptionForeground); }
        .heatmap-container { display:flex; flex-direction:column; gap:2px; }
        .heatmap-row { display:flex; gap:2px; align-items:center; }
        .heatmap-label { width:24px; font-size:8px; color:var(--vscode-descriptionForeground); text-align:right; padding-right:4px; flex-shrink:0; }
        .heatmap-cell { width:12px; height:12px; border-radius:2px; background:rgba(88,166,255,0.08); border:1px solid rgba(110,118,129,0.12); }
        .heatmap-cell.ai-high { background:#22c55e; border-color:#22c55e; }
        .heatmap-cell.ai-med { background:rgba(34,197,94,0.55); border-color:rgba(34,197,94,0.55); }
        .heatmap-cell.ai-low { background:#f59e0b; border-color:#f59e0b; }
        .heatmap-cell.ai-none { background:rgba(167,139,250,0.35); border-color:rgba(167,139,250,0.35); }
        .heatmap-cell.chat-only { background:rgba(88,166,255,0.45); border-color:rgba(88,166,255,0.55); }
        .heatmap-cell.weekend { background:rgba(110,118,129,0.18); border-color:rgba(110,118,129,0.25); }
        .heatmap-cell.weekend.ai-high { background:#22c55e; opacity:0.6; }
        .heatmap-cell.weekend.ai-med { background:rgba(34,197,94,0.55); opacity:0.6; }
        .heatmap-cell.weekend.ai-low { background:#f59e0b; opacity:0.6; }
        .heatmap-cell.weekend.ai-none { background:rgba(167,139,250,0.35); opacity:0.6; }
        .heatmap-cell.weekend.chat-only { background:rgba(88,166,255,0.45); opacity:0.6; }
        .heatmap-cell.today { box-shadow:0 0 0 2px #58a6ff; border-radius:3px; }
        .heatmap-cell.future { background:none; border:1px dashed rgba(110,118,129,0.15); }
        .heatmap-months { display:flex; gap:2px; padding-left:28px; margin-bottom:4px; }
        .heatmap-months span { font-size:8px; color:var(--vscode-descriptionForeground); }
        .heatmap-legend { display:flex; align-items:center; gap:4px; margin-top:6px; padding-left:28px; font-size:9px; color:var(--vscode-descriptionForeground); }
        .heatmap-legend .heatmap-cell { width:10px; height:10px; cursor:default; }
        .heatmap-summary { padding:6px 28px 0; font-size:10px; color:var(--vscode-descriptionForeground); line-height:1.6; }
        .heatmap-summary strong { color:var(--vscode-foreground); }
        .filter-bar { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:20px; padding:12px 16px; background:rgba(110,118,129,0.05); border-radius:8px; border:1px solid var(--card-border); flex-wrap:wrap; }
        .filter-group { display:flex; flex-direction:column; gap:4px; }
        .filter-label { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:var(--vscode-descriptionForeground); display:flex; align-items:center; gap:4px; }
        .filter-select { padding:5px 10px; border:1px solid var(--card-border); border-radius:4px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); font-size:11px; font-family:inherit; outline:none; cursor:pointer; min-width:180px; }
        .filter-select:focus { border-color:var(--vscode-focusBorder); }
        .period-filters { display:flex; gap:2px; background:rgba(110,118,129,0.1); border-radius:6px; padding:2px; }
        .period-btn { padding:5px 12px; border:none; border-radius:4px; background:transparent; color:var(--vscode-descriptionForeground); font-size:11px; font-weight:500; cursor:pointer; font-family:inherit; transition:all 0.15s; white-space:nowrap; }
        .period-btn:hover { background:var(--hover-bg); color:var(--vscode-foreground); }
        .period-btn.active { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
        .chart-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
        .chart-legend { display:flex; gap:12px; }
        .legend-item { display:flex; align-items:center; gap:4px; font-size:10px; color:var(--vscode-descriptionForeground); }
        .legend-dot { width:8px; height:8px; border-radius:50%; display:inline-block; }
        .usage-bar-fill.cyan { background:#06b6d4; }
        .usage-bar-fill.gray { background:#6e7681; }
        .usage-stat-card { padding:16px; border:1px solid var(--card-border); border-radius:6px; }
        .usage-stat-value { font-size:24px; font-weight:800; }
        .usage-stat-label { font-size:11px; color:var(--vscode-descriptionForeground); margin:4px 0 8px; }
        .usage-bar { height:4px; background:rgba(110,118,129,0.15); border-radius:2px; overflow:hidden; }
        .usage-bar-fill { height:100%; border-radius:2px; transition:width 0.8s; }
        .usage-bar-fill.green { background:#22c55e; } .usage-bar-fill.blue { background:#58a6ff; } .usage-bar-fill.purple { background:#a78bfa; } .usage-bar-fill.orange { background:#f59e0b; }
        .chart-section { margin-top:8px; } .chart-section h3 { font-size:13px; font-weight:600; margin-bottom:12px; }
        .bar-chart { display:flex; align-items:flex-end; gap:8px; height:180px; border-bottom:1px solid var(--card-border); padding:0 4px 24px; position:relative; }
        .bar-col { flex:1; display:flex; flex-direction:column; align-items:center; gap:2px; height:100%; justify-content:flex-end; position:relative; min-width:0; }
        .bar-fill { width:100%; max-width:40px; border-radius:6px 6px 2px 2px; transition:height 0.6s cubic-bezier(.4,0,.2,1); cursor:default; min-height:2px; position:relative; }
        .bar-value { font-size:9px; font-weight:700; color:var(--vscode-foreground); opacity:0.8; position:absolute; top:-16px; left:50%; transform:translateX(-50%); white-space:nowrap; }
        .bar-label { font-size:9px; color:var(--vscode-descriptionForeground); position:absolute; bottom:-18px; white-space:nowrap; }
        .bar-chart.stacked { display:flex; align-items:flex-end; gap:8px; height:200px; border-bottom:1px solid var(--card-border); padding:0 4px 24px; position:relative; }
        .stacked-col { display:flex; flex-direction:column; align-items:center; justify-content:flex-end; }
        .stacked-ai { border-radius:3px 3px 0 0 !important; }
        .stacked-typed { border-radius:0 !important; }
        .data-table { width:100%; border-collapse:separate; border-spacing:0; }
        .data-table th { text-align:left; padding:10px 12px; font-size:11px; font-weight:600; color:var(--vscode-descriptionForeground); text-transform:uppercase; border-bottom:2px solid var(--card-border); position:sticky; top:-1px; background:var(--vscode-editor-background, #1e1e1e); z-index:2; box-shadow:0 2px 4px rgba(0,0,0,0.15); }
        .data-table td { padding:10px 12px; font-size:12px; border-bottom:1px solid var(--card-border); }
        .data-table tr:hover td { background:var(--hover-bg); }
        .models-table { padding:0 12px 12px; }
        .aistats-layout { display:flex; flex-direction:row; height:calc(100vh - 180px); min-height:500px; }
        .aistats-main { flex:1; overflow-y:auto; overflow-x:hidden; min-width:0; }
        .aistats-trends-col { display:flex; flex-direction:row; flex-shrink:0; border-left:2px solid var(--vscode-textLink-foreground, #58a6ff); transition:width 0.25s ease; overflow:hidden; height:100%; }
        .aistats-trends-col.expanded { width:35%; min-width:300px; max-width:420px; }
        .aistats-trends-col.collapsed { width:36px; min-width:36px; max-width:36px; cursor:pointer; }
        .trends-sidebar-tab { width:36px; flex-shrink:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; background:rgba(88,166,255,0.06); cursor:pointer; user-select:none; height:100%; border-left:2px solid var(--vscode-textLink-foreground, #58a6ff); }
        .trends-sidebar-tab .tab-arrow { color:var(--vscode-textLink-foreground, #58a6ff); }
        .trends-sidebar-tab .tab-icon { font-size:16px; color:var(--vscode-textLink-foreground, #58a6ff); }
        .trends-sidebar-tab .tab-label { writing-mode:vertical-rl; text-orientation:mixed; font-size:10px; font-weight:600; color:var(--vscode-textLink-foreground, #58a6ff); letter-spacing:0.5px; text-transform:uppercase; }
        .trends-sidebar-tab:hover { background:rgba(88,166,255,0.14); }
        .trends-sidebar-tab:hover .tab-icon, .trends-sidebar-tab:hover .tab-label { color:var(--vscode-foreground); }
        .trends-panel-content { flex:1; overflow-y:auto; overflow-x:hidden; min-width:0; height:100%; }
        .aistats-trends-col.collapsed .trends-panel-content { display:none; }
        .context-window-info { display:flex; flex-direction:column; gap:16px; }
        .ctx-card { border:1px solid var(--card-border); border-radius:8px; padding:16px; }
        .ctx-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
        .ctx-meter { margin-bottom:12px; }
        .ctx-meter-bg { height:12px; background:rgba(110,118,129,0.12); border-radius:6px; overflow:hidden; }
        .ctx-meter-fill { height:100%; background:linear-gradient(90deg,#58a6ff,#a78bfa,#22c55e); border-radius:6px; transition:width 0.8s; }
        .ctx-meter-labels { display:flex; justify-content:space-between; margin-top:4px; font-size:10px; color:var(--vscode-descriptionForeground); }
        .ctx-breakdown { display:flex; flex-direction:column; gap:4px; }
        .ctx-row { display:flex; align-items:center; gap:8px; font-size:12px; padding:2px 0; }
        .ctx-row.total { border-top:1px solid var(--card-border); padding-top:6px; margin-top:4px; }
        .ctx-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
        .ctx-pct { margin-left:auto; font-weight:600; color:var(--vscode-descriptionForeground); font-size:11px; }
        .ctx-allocation { margin-bottom:16px; }
        .ctx-alloc-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
        .ctx-alloc-header h3 { font-size:14px; font-weight:600; } .ctx-alloc-total { font-size:16px; font-weight:800; color:var(--vscode-foreground); }
        .ctx-alloc-formula { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .ctx-formula-item { flex:1; min-width:100px; padding:14px; border:1px solid var(--card-border); border-radius:8px; text-align:center; }
        .ctx-formula-item.total { background:rgba(88,166,255,0.06); border-color:rgba(88,166,255,0.3); }
        .ctx-formula-value { font-size:20px; font-weight:800; color:var(--vscode-foreground); }
        .ctx-formula-label { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:var(--vscode-descriptionForeground); margin-top:4px; }
        .ctx-formula-bar { height:4px; background:rgba(110,118,129,0.12); border-radius:2px; margin-top:8px; overflow:hidden; }
        .ctx-formula-fill { height:100%; border-radius:2px; transition:width 0.6s; }
        .ctx-formula-pct { font-size:10px; color:var(--vscode-descriptionForeground); margin-top:2px; }
        .ctx-formula-op { font-size:20px; font-weight:300; color:var(--vscode-descriptionForeground); padding:0 4px; }
        .ctx-breakdown-section h3 { font-size:13px; font-weight:600; display:flex; align-items:center; gap:8px; }
        .ctx-stacked-meter { display:flex; height:16px; border-radius:8px; overflow:hidden; background:rgba(110,118,129,0.08); border:1px solid var(--card-border); margin-top:8px; }
        .ctx-stack-fill { height:100%; transition:width 0.6s; min-width:1px; }
        .ctx-stack-labels { display:flex; justify-content:space-between; margin-top:4px; font-size:10px; color:var(--vscode-descriptionForeground); }
        .ctx-info-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; }
        .ctx-info-item { display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border:1px solid var(--card-border); border-radius:6px; font-size:11px; }
        .ctx-info-label { color:var(--vscode-descriptionForeground); }
        .ctx-info-value { font-weight:700; }
        .mcp-server-list { display:flex; flex-direction:column; gap:12px; }
        .mcp-server-card { display:flex; align-items:flex-start; justify-content:space-between; padding:16px; border:1px solid var(--card-border); border-radius:6px; gap:12px; }
        .mcp-server-left { display:flex; gap:12px; flex:1; }
        .mcp-server-icon { width:40px; height:40px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0; }
        .mcp-server-icon.ado { background:rgba(0,120,212,0.15); color:#0078d4; } .mcp-server-icon.docs { background:rgba(88,166,255,0.15); color:#58a6ff; } .mcp-server-icon.default { background:rgba(110,118,129,0.15); }
        .mcp-server-name { font-size:14px; font-weight:600; } .mcp-server-meta { font-size:11px; color:var(--vscode-descriptionForeground); margin-top:4px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .mcp-server-path { font-size:10px; color:var(--vscode-descriptionForeground); margin-top:4px; } .mcp-server-auth { font-size:11px; margin-top:6px; display:flex; align-items:center; gap:4px; }
        .tools-list { display:flex; flex-direction:column; gap:6px; }
        .tool-item { padding:10px 12px; border:1px solid var(--card-border); border-radius:6px; }
        .tool-name { font-size:12px; font-weight:600; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .tool-desc { font-size:11px; color:var(--vscode-descriptionForeground); margin-top:3px; } .tool-tags { display:flex; gap:4px; margin-top:4px; flex-wrap:wrap; }
        .howto-section h3 { font-size:14px; font-weight:600; display:flex; align-items:center; gap:8px; margin-bottom:12px; }
        .steps { display:flex; flex-direction:column; gap:8px; }
        .step { display:flex; gap:12px; padding:12px; border:1px solid var(--card-border); border-radius:6px; }
        .step-num { width:28px; height:28px; border-radius:50%; background:var(--vscode-button-background); color:var(--vscode-button-foreground); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; flex-shrink:0; }
        .step-content h4 { font-size:13px; font-weight:600; margin-bottom:2px; } .step-content p { font-size:12px; color:var(--vscode-descriptionForeground); }
        kbd { display:inline-block; padding:2px 6px; background:var(--vscode-editor-background); border:1px solid var(--card-border); border-radius:3px; font-size:11px; font-family:monospace; }
        code { background:rgba(88,166,255,0.1); color:var(--vscode-textLink-foreground); padding:1px 4px; border-radius:3px; font-size:11px; }
        .quick-actions { display:flex; flex-wrap:wrap; gap:8px; }
        .info-banner { padding:14px; border-radius:6px; font-size:12px; line-height:1.6; display:flex; align-items:flex-start; gap:8px; }
        .info-banner.warning { background:rgba(245,158,11,0.06); border:1px solid rgba(245,158,11,0.2); }
        .raw-data { font-family:monospace; font-size:11px; background:var(--vscode-textCodeBlock-background); padding:14px; border-radius:6px; overflow-x:auto; white-space:pre; max-height:400px; overflow-y:auto; }
        .empty-state { text-align:center; padding:24px; } .empty-icon { font-size:32px; margin-bottom:8px; color:var(--vscode-descriptionForeground); }
        .empty-state p { margin-bottom:8px; } .hint { font-size:11px; color:var(--vscode-descriptionForeground); } .hint-text { font-size:10px; color:var(--vscode-descriptionForeground); font-style:italic; }
        .full-empty-state { text-align:center; padding:40px 20px; }
        .full-empty-state.small { padding:20px; }
        .full-empty-state h2, .full-empty-state h3 { margin-bottom:8px; }
        .full-empty-state p { color:var(--vscode-descriptionForeground); font-size:13px; margin-bottom:6px; }
        .full-empty-state ol { text-align:left; display:inline-block; margin:12px 0; font-size:12px; color:var(--vscode-descriptionForeground); }
        .full-empty-state ol li { margin-bottom:4px; }
        .empty-icon-large { font-size:40px; color:var(--vscode-descriptionForeground); margin-bottom:12px; }
        .empty-actions { display:flex; gap:8px; justify-content:center; margin-top:12px; }
        .footer { display:flex; flex-direction:column; gap:8px; align-items:center; padding:16px 0; margin-top:24px; font-size:11px; color:var(--vscode-descriptionForeground); border-top:1px solid var(--card-border); }
        .footer-top { display:flex; gap:8px; align-items:center; }
        .footer-sig { display:flex; flex-direction:column; align-items:center; gap:2px; margin-top:4px; padding-top:8px; border-top:1px dashed var(--card-border); width:100%; text-align:center; }
        .sig-name { font-weight:600; font-size:11px; color:var(--vscode-foreground); }
        .sig-links { font-size:10px; } .sig-links a { color:var(--vscode-textLink-foreground); text-decoration:none; } .sig-links a:hover { text-decoration:underline; }
        .sig-tagline { font-size:10px; font-style:italic; color:var(--vscode-descriptionForeground); }
        .status-dot { display:inline-block; width:6px; height:6px; border-radius:50%; } .status-dot.active { background:#22c55e; } .status-dot.inactive { background:#6e7681; }
        @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        .spin { animation:spin 0.8s linear infinite; display:inline-block; }
        .info-tip { cursor:help; display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; border-radius:50%; background:rgba(88,166,255,0.12); color:var(--vscode-descriptionForeground); font-size:9px; font-weight:700; font-style:normal; line-height:1; vertical-align:middle; margin-left:4px; position:relative; border:1px solid rgba(88,166,255,0.2); }
        .info-tip:hover { background:rgba(88,166,255,0.25); color:var(--vscode-textLink-foreground); border-color:var(--vscode-textLink-foreground); }
        .chart-desc { font-size:11px; color:var(--vscode-descriptionForeground); margin:-8px 0 12px; padding:0 2px; font-style:italic; line-height:1.5; display:flex; align-items:flex-start; gap:6px; }
        .chart-desc .info-icon { font-size:13px; flex-shrink:0; opacity:0.5; margin-top:1px; }
        .grouped-bar-col { flex:1; display:flex; flex-direction:column; align-items:center; gap:2px; height:100%; justify-content:flex-end; position:relative; min-width:0; }
        .grouped-bars { display:flex; gap:2px; align-items:flex-end; height:100%; }
        .grouped-bar { border-radius:4px 4px 1px 1px; transition:height 0.6s cubic-bezier(.4,0,.2,1); min-height:1px; min-width:12px; max-width:20px; position:relative; }
        .grouped-bar .bar-value { position:absolute; top:-14px; left:50%; transform:translateX(-50%); white-space:nowrap; font-size:8px; font-weight:700; }
        .acct-layout { display:grid; grid-template-columns:280px 1fr; gap:16px; min-height:400px; }
        @media(max-width:700px){.acct-layout{grid-template-columns:1fr;min-height:auto;}}
        .acct-list-col { min-width:0; }
        .acct-detail-col { min-width:0; }
        .acct-list-item { display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:6px; cursor:pointer; transition:background 0.15s; margin-bottom:2px; border:1px solid transparent; }
        .acct-list-item:hover { background:var(--vscode-list-hoverBackground); }
        .acct-list-item.selected { background:var(--vscode-list-activeSelectionBackground); color:var(--vscode-list-activeSelectionForeground); border-color:var(--vscode-focusBorder); }
        .info-tab-header { display:flex; align-items:center; gap:14px; margin-bottom:8px; }
        .info-intro { font-size:12px; color:var(--vscode-descriptionForeground); margin-bottom:16px; line-height:1.6; }
        .prereq-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        @media(max-width:700px){.prereq-grid{grid-template-columns:1fr}}
        .prereq-card { display:flex; gap:12px; padding:14px; border:1px solid var(--card-border); border-radius:8px; transition:all 0.15s; }
        .prereq-card.ok { border-left:3px solid #22c55e; }
        .prereq-card.missing { border-left:3px solid #f59e0b; background:rgba(245,158,11,0.04); }
        .prereq-card.optional { border-left:3px solid #58a6ff; }
        .prereq-icon { width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:14px; flex-shrink:0; }
        .prereq-card.ok .prereq-icon { background:rgba(34,197,94,0.15); color:#22c55e; }
        .prereq-card.missing .prereq-icon { background:rgba(245,158,11,0.15); color:#f59e0b; }
        .prereq-card.optional .prereq-icon { background:rgba(88,166,255,0.15); color:#58a6ff; }
        .prereq-name { font-size:13px; font-weight:600; margin-bottom:4px; }
        .prereq-desc { font-size:11px; color:var(--vscode-descriptionForeground); line-height:1.5; margin-bottom:6px; }
        .prereq-status { font-size:11px; }
        .impact-table { display:flex; flex-direction:column; gap:0; border:1px solid var(--card-border); border-radius:6px; overflow:hidden; }
        .impact-row { display:flex; gap:0; }
        .impact-row.impact-header { background:rgba(110,118,129,0.08); }
        .impact-row.impact-header .impact-cell { font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.3px; color:var(--vscode-descriptionForeground); }
        .impact-cell { flex:1; padding:10px 14px; font-size:12px; border-bottom:1px solid var(--card-border); line-height:1.5; }
        .impact-row:last-child .impact-cell { border-bottom:none; }
        .impact-cell:not(:last-child) { border-right:1px solid var(--card-border); }
        .notes-list { display:flex; flex-direction:column; gap:14px; }
        .note-item { display:flex; gap:12px; padding:12px 14px; border:1px solid var(--card-border); border-radius:8px; }
        .note-item:hover { background:var(--hover-bg); }
        .note-icon { width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; background:rgba(88,166,255,0.1); color:var(--vscode-textLink-foreground); flex-shrink:0; font-size:14px; }
        .note-item strong { font-size:13px; display:block; margin-bottom:4px; }
        .note-item p { font-size:12px; color:var(--vscode-descriptionForeground); line-height:1.6; margin:0; }
        /* Chat Sessions & History tab */
        .chat-sessions-summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin-bottom:20px; }
        .chat-summary-stat { padding:14px; border:1px solid var(--card-border); border-radius:6px; text-align:center; }
        .chat-summary-value { font-size:22px; font-weight:800; }
        .chat-summary-label { font-size:10px; color:var(--vscode-descriptionForeground); margin-top:4px; text-transform:uppercase; letter-spacing:0.3px; }
        .chat-sessions-list { display:flex; flex-direction:column; gap:8px; }
        .chat-session-card { border:1px solid var(--card-border); border-radius:8px; overflow:hidden; transition:all 0.15s; }
        .chat-session-card.current-ws { border-left:3px solid var(--vscode-focusBorder); }
        .chat-session-card.other-ws { opacity:0.75; }
        .chat-session-card:hover { border-color:var(--vscode-focusBorder); }
        .chat-session-header { display:flex; align-items:center; gap:12px; padding:14px 16px; cursor:pointer; transition:background 0.15s; }
        .chat-session-header:hover { background:var(--hover-bg); }
        .chat-session-icon { width:36px; height:36px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; background:rgba(88,166,255,0.1); color:var(--vscode-textLink-foreground); }
        .chat-session-icon.panel { background:rgba(88,166,255,0.1); color:#58a6ff; }
        .chat-session-icon.editor { background:rgba(167,139,250,0.1); color:#a78bfa; }
        .chat-session-icon.inline { background:rgba(34,197,94,0.1); color:#22c55e; }
        .chat-session-info { flex:1; min-width:0; }
        .chat-session-title { font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .chat-session-meta { font-size:10px; color:var(--vscode-descriptionForeground); margin-top:3px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .chat-session-stats { display:flex; align-items:center; gap:6px; flex-shrink:0; }
        .chat-msg-count { padding:2px 8px; border-radius:10px; font-size:10px; font-weight:600; background:rgba(88,166,255,0.12); color:#58a6ff; }
        .chat-expand-icon { font-size:12px; color:var(--vscode-descriptionForeground); transition:transform 0.2s; flex-shrink:0; }
        .chat-session-card.expanded .chat-expand-icon { transform:rotate(90deg); }
        .chat-session-body { display:none; border-top:1px solid var(--card-border); padding:0; overflow-y:auto; }
        .chat-session-card.expanded .chat-session-body { display:block; }
        .chat-no-messages { padding:16px; text-align:center; color:var(--vscode-descriptionForeground); font-size:12px; font-style:italic; }
        .chat-status-badge { padding:2px 6px; border-radius:8px; font-size:9px; font-weight:600; }
        .chat-status-badge.active { background:rgba(88,166,255,0.15); color:#58a6ff; }
        .chat-status-badge.completed { background:rgba(34,197,94,0.15); color:#22c55e; }
        .chat-status-badge.stopped { background:rgba(239,68,68,0.15); color:#ef4444; }
        .chat-source-badge { padding:2px 6px; border-radius:8px; font-size:9px; font-weight:600; }
        .chat-source-badge.agent { background:rgba(167,139,250,0.12); color:#a78bfa; }
        .chat-source-badge.chat { background:rgba(88,166,255,0.12); color:#58a6ff; }
        .chat-source-badge.ask { background:rgba(34,197,94,0.12); color:#22c55e; }
        .chat-source-badge.custom { background:rgba(245,158,11,0.12); color:#f59e0b; }
        .chat-source-badge.empty { background:rgba(110,118,129,0.12); color:var(--vscode-descriptionForeground); }
        .chat-type-filters { display:flex; gap:4px; flex-wrap:wrap; }
        .type-btn { display:inline-flex; align-items:center; gap:4px; padding:5px 12px; border:1px solid var(--card-border); border-radius:6px; background:transparent; color:var(--vscode-descriptionForeground); font-size:11px; font-weight:500; cursor:pointer; font-family:inherit; transition:all 0.15s; white-space:nowrap; }
        .type-btn:hover { background:var(--hover-bg); color:var(--vscode-foreground); }
        .type-btn.active { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border-color:var(--vscode-button-background); }
        .type-btn .codicon { font-size:12px; }
        .type-count { font-size:9px; opacity:0.7; margin-left:2px; }
        .type-btn.active .type-count { opacity:0.9; }
        .clickable-tile { transition:all 0.15s; }
        .chat-open-btn { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border:1px solid var(--card-border); border-radius:4px; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); font-size:10px; font-weight:500; cursor:pointer; font-family:inherit; transition:all 0.15s; white-space:nowrap; margin-left:auto; flex-shrink:0; }
        .chat-open-btn:hover { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
        .chat-open-btn .codicon { font-size:11px; }

        .recent-sessions-list { display:flex; flex-direction:column; gap:6px; }
        .recent-session-row { display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--card-border); border-radius:6px; transition:background 0.15s; }
        .recent-session-row:hover { background:var(--hover-bg); }
        .recent-session-info { flex:1; min-width:0; }
        .recent-session-title { font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .recent-session-meta { font-size:10px; color:var(--vscode-descriptionForeground); margin-top:3px; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .recent-sessions-info-icon { position:static; display:inline-flex; align-items:center; margin-left:6px; }
        .recent-sessions-info-tooltip { display:none; position:fixed; z-index:9999; width:340px; background:var(--vscode-editorHoverWidget-background, #1e1e1e); color:var(--vscode-editorHoverWidget-foreground, #ccc); border:1px solid var(--vscode-editorHoverWidget-border, #454545); border-radius:8px; padding:14px 18px; font-size:12px; font-weight:400; line-height:1.7; box-shadow:0 6px 20px rgba(0,0,0,0.35); white-space:normal; pointer-events:none; }

        .sessions-pagination { display:flex; align-items:center; justify-content:center; gap:6px; padding:12px 0; }
        .sessions-pagination .page-btn { padding:4px 10px; border:1px solid var(--card-border); border-radius:4px; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); font-size:11px; cursor:pointer; font-family:inherit; }
        .sessions-pagination .page-btn:hover { background:var(--hover-bg); }
        .sessions-pagination .page-btn.active { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border-color:var(--vscode-button-background); }
        .sessions-pagination .page-btn:disabled { opacity:0.4; cursor:default; }
        .sessions-pagination .page-info { font-size:11px; color:var(--vscode-descriptionForeground); }
        ${getTrendsCSS()}
    `;
}

/**
 * Returns all client-side JavaScript for the dashboard webview.
 * Handles tab switching, period filters, chart rendering, and account selection.
 *
 * @param {string} aiStatsJson - JSON-stringified AI stats array from accountDataFetcher
 * @returns {string} JavaScript code to be injected into the webview
 */
function getJS(aiStatsJson, chatSessionsJson, workspaceNameJson) {
    return `
        const vscode = acquireVsCodeApi();
        const AI_STATS_RAW = ${aiStatsJson || '[]'};
        const CHAT_SESSIONS_RAW = ${chatSessionsJson || '[]'};
        const CURRENT_WORKSPACE = ${workspaceNameJson || '""'};

        // ========== SHARED UTILITIES ==========
        function toLocalDateStr(d) {
            // Always use local timezone date string YYYY-MM-DD
            return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        }
        function getDateRangeForPeriod(period) {
            var now = new Date();
            var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            var start, end = new Date(today);
            switch(period) {
                case 'today': start = new Date(today); break;
                case 'week': {
                    start = new Date(today);
                    var day = start.getDay();
                    var diff = day === 0 ? 6 : day - 1;
                    start.setDate(start.getDate() - diff);
                    end = new Date(start); end.setDate(end.getDate() + 6);
                    break;
                }
                case 'last7': {
                    start = new Date(today);
                    start.setDate(start.getDate() - 6);
                    break;
                }
                case 'last30': {
                    start = new Date(today);
                    start.setDate(start.getDate() - 29);
                    break;
                }
                case 'month': start = new Date(today.getFullYear(), today.getMonth(), 1); end = new Date(today.getFullYear(), today.getMonth() + 1, 0); break;
                case 'all': default: start = new Date(2020, 0, 1); break;
            }
            return { start: toLocalDateStr(start), end: toLocalDateStr(end), startDate: start, endDate: end };
        }
        function getAllDatesInRange(startStr, endStr) {
            // Returns array of YYYY-MM-DD strings for every day from start to end inclusive
            // Caps at today — never returns future dates
            var dates = [];
            var cur = new Date(startStr + 'T00:00:00');
            var last = new Date(endStr + 'T00:00:00');
            var now = new Date();
            var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (last > today) last = today;
            while (cur <= last) {
                dates.push(toLocalDateStr(cur));
                cur.setDate(cur.getDate() + 1);
            }
            return dates;
        }

        function getPeriodLabel(period) {
            var now = new Date();
            var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            switch(period) {
                case 'today': return today.getDate().toString().padStart(2,'0') + ' ' + months[today.getMonth()] + ' ' + today.getFullYear();
                case 'week': {
                    var start = new Date(today);
                    var day = start.getDay(); var diff = day === 0 ? 6 : day - 1;
                    start.setDate(start.getDate() - diff);
                    var end = new Date(start); end.setDate(end.getDate() + 6);
                    return start.getDate().toString().padStart(2,'0') + ' ' + months[start.getMonth()] + ' - ' + end.getDate().toString().padStart(2,'0') + ' ' + months[end.getMonth()] + ' ' + end.getFullYear();
                }
                case 'last7': {
                    var s7 = new Date(today); s7.setDate(s7.getDate() - 6);
                    return s7.getDate().toString().padStart(2,'0') + ' ' + months[s7.getMonth()] + ' - ' + today.getDate().toString().padStart(2,'0') + ' ' + months[today.getMonth()] + ' ' + today.getFullYear();
                }
                case 'last30': {
                    var s30 = new Date(today); s30.setDate(s30.getDate() - 29);
                    return s30.getDate().toString().padStart(2,'0') + ' ' + months[s30.getMonth()] + ' - ' + today.getDate().toString().padStart(2,'0') + ' ' + months[today.getMonth()] + ' ' + today.getFullYear();
                }
                case 'month': return months[today.getMonth()] + ' ' + today.getFullYear();
                case 'all': default: return 'All Time';
            }
        }

        // ========== COPILOT USAGE METRICS (Real Data) ==========
        var usagePeriod = 'week';

        function getFilteredUsageStats() {
            var range = getDateRangeForPeriod(usagePeriod);
            return AI_STATS_RAW.filter(function(r) {
                return r.date >= range.start && r.date <= range.end;
            });
        }

        function aggregateByDay(records, period) {
            var byDate = {};
            for (var i = 0; i < records.length; i++) {
                var r = records[i];
                if (!byDate[r.date]) byDate[r.date] = { date: r.date, typedCharacters: 0, aiCharacters: 0, acceptedInlineSuggestions: 0, chatEditCount: 0, sessions: 0 };
                byDate[r.date].typedCharacters += r.typedCharacters;
                byDate[r.date].aiCharacters += r.aiCharacters;
                byDate[r.date].acceptedInlineSuggestions += r.acceptedInlineSuggestions;
                byDate[r.date].chatEditCount += r.chatEditCount;
                byDate[r.date].sessions++;
            }
            // Fill all dates so every day shows as a bar (empty bar = no data)
            var range = getDateRangeForPeriod(period);
            var fillStart = range.start;
            var fillEnd = range.end;
            // For 'all': fill from first record to last record (not from 2020)
            if (period === 'all' && records.length > 0) {
                var sortedDates = Object.keys(byDate).sort();
                fillStart = sortedDates[0];
                fillEnd = sortedDates[sortedDates.length - 1];
                // Extend to today if last record is before today
                var todayStr = toLocalDateStr(new Date());
                if (fillEnd < todayStr) fillEnd = todayStr;
            }
            var allDates = getAllDatesInRange(fillStart, fillEnd);
            for (var j = 0; j < allDates.length; j++) {
                if (!byDate[allDates[j]]) byDate[allDates[j]] = { date: allDates[j], typedCharacters: 0, aiCharacters: 0, acceptedInlineSuggestions: 0, chatEditCount: 0, sessions: 0 };
            }
            return Object.values(byDate).sort(function(a,b) { return a.date.localeCompare(b.date); });
        }

        function renderUsageMetrics(days) {
            var el = document.getElementById('usageStats');
            if (!el) return;
            var totalTyped = 0, totalAi = 0, totalSugg = 0, totalChats = 0, totalSessions = 0;
            for (var i = 0; i < days.length; i++) {
                totalTyped += days[i].typedCharacters;
                totalAi += days[i].aiCharacters;
                totalSugg += days[i].acceptedInlineSuggestions;
                totalChats += days[i].chatEditCount;
                totalSessions += days[i].sessions;
            }
            var totalChars = totalTyped + totalAi;
            var aiPct = totalChars > 0 ? Math.round(totalAi / totalChars * 100) : 0;
            el.innerHTML =
                '<div class="usage-stat-card"><div class="usage-stat-value">' + aiPct + '%</div><div class="usage-stat-label">AI Code Rate <span class="info-tip" title="Percentage of code generated by AI vs all code written (AI + manual typing). Higher means more AI assistance.">i</span></div><div class="usage-bar"><div class="usage-bar-fill green" style="width:' + aiPct + '%"></div></div></div>' +
                '<div class="usage-stat-card"><div class="usage-stat-value">' + totalAi.toLocaleString() + '</div><div class="usage-stat-label">AI Characters <span class="info-tip" title="Total characters of code generated by GitHub Copilot and accepted by you.">i</span></div><div class="usage-bar"><div class="usage-bar-fill blue" style="width:' + (totalChars > 0 ? Math.round(totalAi/totalChars*100) : 0) + '%"></div></div></div>' +
                '<div class="usage-stat-card"><div class="usage-stat-value">' + totalTyped.toLocaleString() + '</div><div class="usage-stat-label">Typed Characters <span class="info-tip" title="Total characters you typed manually without AI assistance.">i</span></div><div class="usage-bar"><div class="usage-bar-fill purple" style="width:' + (totalChars > 0 ? Math.round(totalTyped/totalChars*100) : 0) + '%"></div></div></div>' +
                '<div class="usage-stat-card"><div class="usage-stat-value">' + totalSugg.toLocaleString() + '</div><div class="usage-stat-label">Accepted Suggestions <span class="info-tip" title="Number of inline code suggestions shown by Copilot that you accepted (Tab key).">i</span></div><div class="usage-bar"><div class="usage-bar-fill orange" style="width:' + Math.min(100, totalSugg) + '%"></div></div></div>' +
                '<div class="usage-stat-card"><div class="usage-stat-value">' + totalChats.toLocaleString() + '</div><div class="usage-stat-label">Chat Edits <span class="info-tip" title="Number of code changes applied from Copilot Chat conversations (inline chat, chat panel edits).">i</span></div><div class="usage-bar"><div class="usage-bar-fill cyan" style="width:' + Math.min(100, totalChats * 5) + '%"></div></div></div>' +
                '<div class="usage-stat-card"><div class="usage-stat-value">' + totalSessions.toLocaleString() + '</div><div class="usage-stat-label">Sessions <span class="info-tip" title="Number of coding sessions recorded. Each session is a time interval where you were actively coding.">i</span></div><div class="usage-bar"><div class="usage-bar-fill gray" style="width:' + Math.min(100, totalSessions * 3) + '%"></div></div></div>';
        }

        function renderUsageChart(days) {
            var chart = document.getElementById('usageBarChart');
            var title = document.getElementById('usageChartTitle');
            var legend = document.getElementById('usageChartLegend');
            if (!chart) return;
            chart.innerHTML = '';
            if (days.length === 0) {
                chart.innerHTML = '<div style="text-align:center;padding:40px;color:var(--vscode-descriptionForeground);font-size:12px;">No data for this period</div>';
                return;
            }
            var chartData = days;
            var labelFn;
            if (days.length <= 7) {
                labelFn = function(d) { var dt = new Date(d.date + 'T00:00:00'); return dt.toLocaleDateString('en-US',{weekday:'short',day:'numeric'}); };
            } else if (days.length <= 31) {
                labelFn = function(d) { return new Date(d.date + 'T00:00:00').getDate().toString(); };
            } else {
                labelFn = function(d) { var dt = new Date(d.date + 'T00:00:00'); return (dt.getMonth()+1) + '/' + dt.getDate(); };
            }
            if (title) title.textContent = 'AI % by Day';
            if (legend) {
                legend.innerHTML = '<span class="legend-item"><span class="legend-dot" style="background:#22c55e"></span> &gt;70%</span><span class="legend-item"><span class="legend-dot" style="background:#58a6ff"></span> 40-70%</span><span class="legend-item"><span class="legend-dot" style="background:#f59e0b"></span> &lt;40%</span>';
            }
            chartData.forEach(function(item, i) {
                var total = item.aiCharacters + item.typedCharacters;
                var rate = total > 0 ? Math.round(item.aiCharacters / total * 100) : 0;
                var col = document.createElement('div'); col.className = 'bar-col';
                var fill = document.createElement('div'); fill.className = 'bar-fill';
                fill.style.background = rate > 70 ? 'linear-gradient(180deg,#22c55e,#16a34a)' : rate > 40 ? 'linear-gradient(180deg,#58a6ff,#3b82f6)' : 'linear-gradient(180deg,#f59e0b,#d97706)';
                fill.style.height = '0%';
                fill.title = rate + '% AI (' + item.aiCharacters.toLocaleString() + ' / ' + total.toLocaleString() + ' chars)';
                var valSpan = document.createElement('span'); valSpan.className = 'bar-value'; valSpan.textContent = rate + '%';
                fill.appendChild(valSpan);
                var label = document.createElement('span'); label.className = 'bar-label';
                label.textContent = labelFn(item);
                col.appendChild(fill); col.appendChild(label); chart.appendChild(col);
                setTimeout(function() { fill.style.height = Math.max(rate, 3) + '%'; }, 60 + i * 30);
            });
        }

        function updateUsageDashboard() {
            var filtered = getFilteredUsageStats();
            var days = aggregateByDay(filtered, usagePeriod);
            renderUsageMetrics(days);
            renderUsageChart(days);
            var lbl = document.getElementById('usagePeriodLabel');
            if (lbl) lbl.textContent = getPeriodLabel(usagePeriod);
        }

        // Usage period filter buttons
        document.querySelectorAll('[data-usage-period]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('[data-usage-period]').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                usagePeriod = btn.dataset.usagePeriod;
                updateUsageDashboard();
            });
        });

        // Command handler
        function post(cmd, data) { vscode.postMessage({ command: cmd, path: data, text: data }); }
        document.addEventListener('click', function(e) {
            var target = e.target.closest('[data-command]');
            if (target) {
                var cmd = target.getAttribute('data-command');
                if (cmd === 'openChatSession') {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'openChatSession', sessionId: target.getAttribute('data-session-id'), title: target.getAttribute('data-session-title') });
                    return;
                }
                if (cmd === 'refresh') {
                    var btn = document.getElementById('refreshBtn');
                    var icon = document.getElementById('refreshIcon');
                    var text = document.getElementById('refreshText');
                    if (btn && !btn.disabled) {
                        btn.disabled = true;
                        btn.style.opacity = '0.7';
                        icon.classList.add('spin');
                        text.textContent = 'Refreshing...';
                    }
                }
                post(cmd, target.getAttribute('data-arg') || undefined);
            }
        });

        // Tab switching
        document.querySelectorAll('.tab').forEach(function(tab) {
            tab.addEventListener('click', function() {
                document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
                document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
                tab.classList.add('active');
                document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
            });
        });

        // Initial render
        updateUsageDashboard();

        // ========== AI STATS TAB (Real Data) ==========
        var aiStatsPeriod = 'week';
        var aiStatsWs = 'all';

        // Populate workspace filter
        (function() {
            var sel = document.getElementById('aiStatsWsFilter');
            if (!sel || AI_STATS_RAW.length === 0) return;
            var wsSet = {};
            for (var i = 0; i < AI_STATS_RAW.length; i++) { wsSet[AI_STATS_RAW[i].workspace] = true; }
            var wsNames = Object.keys(wsSet).sort();
            for (var i = 0; i < wsNames.length; i++) {
                var opt = document.createElement('option');
                opt.value = wsNames[i]; opt.textContent = wsNames[i];
                sel.appendChild(opt);
            }
        })();

        function getFilteredAiStats() {
            var range = getDateRangeForPeriod(aiStatsPeriod);
            return AI_STATS_RAW.filter(function(r) {
                if (aiStatsWs !== 'all' && r.workspace !== aiStatsWs) return false;
                return r.date >= range.start && r.date <= range.end;
            });
        }

        function aggregateAiStatsByDay(records) {
            return aggregateByDay(records, aiStatsPeriod);
        }

        function renderAiStatsSummary(days) {
            var el = document.getElementById('aiScoreboard');
            if (!el) return;
            var totalTyped = 0, totalAi = 0, totalSuggestions = 0, totalChats = 0, totalSessions = 0;
            for (var i = 0; i < days.length; i++) {
                totalTyped += days[i].typedCharacters;
                totalAi += days[i].aiCharacters;
                totalSuggestions += days[i].acceptedInlineSuggestions;
                totalChats += days[i].chatEditCount;
                totalSessions += days[i].sessions;
            }
            var totalChars = totalTyped + totalAi;
            var aiPct = totalChars > 0 ? Math.round(totalAi / totalChars * 100) : 0;
            var activeDays = days.filter(function(d) { return d.aiCharacters > 0 || d.typedCharacters > 0; }).length;
            var pctColor = aiPct >= 70 ? '#22c55e' : aiPct >= 40 ? '#58a6ff' : '#f59e0b';
            el.innerHTML =
                '<div class="sb-item"><span class="sb-val" style="color:' + pctColor + ';">' + aiPct + '%</span><span class="sb-lbl">AI Rate</span></div>' +
                '<div class="sb-item"><span class="sb-val">' + totalAi.toLocaleString() + '</span><span class="sb-lbl">AI Chars</span></div>' +
                '<div class="sb-item"><span class="sb-val">' + totalTyped.toLocaleString() + '</span><span class="sb-lbl">Typed</span></div>' +
                '<div class="sb-item"><span class="sb-val">' + totalSuggestions + '</span><span class="sb-lbl">Suggestions</span></div>' +
                '<div class="sb-item"><span class="sb-val">' + totalChats + '</span><span class="sb-lbl">Chat Edits</span></div>' +
                '<div class="sb-item"><span class="sb-val">' + activeDays + '/' + days.length + '</span><span class="sb-lbl">Active Days</span></div>' +
                '<div class="sb-item"><span class="sb-val">' + totalSessions + '</span><span class="sb-lbl">Sessions</span></div>';
        }

        function renderAiHeatmap() {
            var el = document.getElementById('aiHeatmap');
            if (!el) return;
            var now = new Date();
            var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            var todayStr = toLocalDateStr(today);
            var dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
            var startDate = new Date(today);
            startDate.setDate(startDate.getDate() - (15 * 7) - today.getDay());
            // Build day-indexed data
            var dayMap = {};
            for (var s = 0; s < AI_STATS_RAW.length; s++) {
                var r = AI_STATS_RAW[s];
                var d = r.date || (r.startTime ? toLocalDateStr(new Date(r.startTime)) : null);
                if (!d) continue;
                if (!dayMap[d]) dayMap[d] = { ai: 0, typed: 0 };
                dayMap[d].ai += (r.aiCharacters || 0);
                dayMap[d].typed += (r.typedCharacters || 0);
            }
            // Chat-only day-indexed data: days where the user used Copilot Chat
            // but VS Code didn't record an AI Stats session (e.g. pure Q&A, no
            // inline accept or code apply). Surfacing these prevents the heatmap
            // from misleadingly showing "inactive" days when the user was active.
            var chatDayMap = {};
            if (typeof CHAT_SESSIONS_RAW !== 'undefined' && CHAT_SESSIONS_RAW && CHAT_SESSIONS_RAW.length) {
                for (var ci = 0; ci < CHAT_SESSIONS_RAW.length; ci++) {
                    var cs = CHAT_SESSIONS_RAW[ci];
                    var ts = cs.lastMessageDate || cs.creationDate;
                    if (!ts) continue;
                    var cd = toLocalDateStr(new Date(ts));
                    if (!chatDayMap[cd]) chatDayMap[cd] = 0;
                    chatDayMap[cd]++;
                }
            }
            // Stats for summary
            var activeDays = 0, currentStreak = 0, longestStreak = 0, bestRate = 0, bestRateDate = '';
            var streakCounting = true;
            // Walk backwards from today to count streak and stats
            for (var sd = new Date(today); sd >= startDate; sd.setDate(sd.getDate() - 1)) {
                var sds = toLocalDateStr(sd);
                var dd = dayMap[sds];
                var total = dd ? dd.ai + dd.typed : 0;
                if (total > 0) {
                    activeDays++;
                    if (streakCounting) currentStreak++;
                    var rate = Math.round(dd.ai / total * 100);
                    if (rate > bestRate) { bestRate = rate; bestRateDate = sds; }
                } else {
                    if (streakCounting && sds !== todayStr) streakCounting = false;
                }
            }
            // Longest streak (scan all days forward)
            var tempStreak = 0;
            for (var ls = new Date(startDate); ls <= today; ls.setDate(ls.getDate() + 1)) {
                var lss = toLocalDateStr(ls);
                var ld = dayMap[lss];
                if (ld && (ld.ai + ld.typed) > 0) { tempStreak++; if (tempStreak > longestStreak) longestStreak = tempStreak; }
                else { tempStreak = 0; }
            }
            // Month labels
            var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            var monthsHtml = '<div class="heatmap-months">';
            var lastMonth = -1;
            var weekCount = 16;
            for (var w = 0; w < weekCount; w++) {
                var wd = new Date(startDate);
                wd.setDate(wd.getDate() + w * 7);
                var m = wd.getMonth();
                if (m !== lastMonth) { monthsHtml += '<span>' + months[m] + '</span>'; lastMonth = m; }
                else { monthsHtml += '<span style="min-width:14px;"></span>'; }
            }
            monthsHtml += '</div>';
            // Grid
            var gridHtml = monthsHtml;
            for (var row = 0; row < 7; row++) {
                gridHtml += '<div class="heatmap-row"><span class="heatmap-label">' + dayNames[row] + '</span>';
                for (var col = 0; col < weekCount; col++) {
                    var cellDate = new Date(startDate);
                    cellDate.setDate(cellDate.getDate() + col * 7 + row);
                    var ds = toLocalDateStr(cellDate);
                    var isFuture = cellDate > today;
                    var isToday = ds === todayStr;
                    var isWeekend = (row === 0 || row === 6);
                    if (isFuture) {
                        gridHtml += '<div class="heatmap-cell future"></div>';
                    } else {
                        var data = dayMap[ds];
                        var total = data ? data.ai + data.typed : 0;
                        var aiRate = total > 0 ? Math.round(data.ai / total * 100) : -1;
                        var chatCount = chatDayMap[ds] || 0;
                        var cls = 'heatmap-cell';
                        var tip;
                        if (total > 0) {
                            if (aiRate >= 70) cls += ' ai-high';
                            else if (aiRate >= 40) cls += ' ai-med';
                            else if (aiRate >= 0) cls += ' ai-low';
                            else cls += ' ai-none';
                            tip = ds + ': ' + aiRate + '% AI rate \u2022 ' + total.toLocaleString() + ' chars (' + data.ai.toLocaleString() + ' AI / ' + data.typed.toLocaleString() + ' typed)' + (chatCount > 0 ? ' \u2022 ' + chatCount + ' chat session' + (chatCount === 1 ? '' : 's') : '');
                        } else if (chatCount > 0) {
                            cls += ' chat-only';
                            tip = ds + ': Chat only \u2022 ' + chatCount + ' chat session' + (chatCount === 1 ? '' : 's') + ' (no inline accepts or code applies)';
                        } else {
                            tip = ds + ': No activity';
                        }
                        if (isWeekend) cls += ' weekend';
                        if (isToday) cls += ' today';
                        gridHtml += '<div class="' + cls + '" title="' + tip + '"></div>';
                    }
                }
                gridHtml += '</div>';
            }
            // Count chat-only days inside the visible window for the legend/summary
            var chatOnlyDays = 0;
            for (var coKey in chatDayMap) {
                if (!Object.prototype.hasOwnProperty.call(chatDayMap, coKey)) continue;
                if (coKey < toLocalDateStr(startDate) || coKey > todayStr) continue;
                var coData = dayMap[coKey];
                if (!coData || (coData.ai + coData.typed) === 0) chatOnlyDays++;
            }
            // Legend
            gridHtml += '<div class="heatmap-legend"><div class="heatmap-cell" style="border:1px solid rgba(110,118,129,0.25);"></div> Inactive &nbsp;<div class="heatmap-cell chat-only" style="border:none;"></div> Chat only &nbsp;<div class="heatmap-cell ai-low" style="border:none;"></div> Mixed &nbsp;<div class="heatmap-cell ai-med" style="border:none;"></div> <div class="heatmap-cell ai-high" style="border:none;"></div> AI-assisted &nbsp;&nbsp;<div class="heatmap-cell today" style="width:10px;height:10px;"></div> Today &nbsp;<div class="heatmap-cell weekend" style="width:10px;height:10px;"></div> Weekend</div>';
            // Summary
            var bestDateFmt = bestRateDate ? new Date(bestRateDate + 'T00:00:00').toLocaleDateString('en-GB', {day:'2-digit',month:'short'}) : '';
            gridHtml += '<div class="heatmap-summary"><strong>' + activeDays + '</strong> active days';
            if (chatOnlyDays > 0) gridHtml += ' \u2022 <strong>' + chatOnlyDays + '</strong> chat-only day' + (chatOnlyDays === 1 ? '' : 's');
            if (currentStreak > 0) gridHtml += ' \u2022 \ud83d\udd25 <strong>' + currentStreak + '-day</strong> streak';
            if (longestStreak > currentStreak) gridHtml += ' \u2022 Best streak: ' + longestStreak + ' days';
            if (bestRate > 0) gridHtml += ' \u2022 Peak: <strong>' + bestRate + '%</strong> AI rate on ' + bestDateFmt;
            gridHtml += '</div>';
            el.innerHTML = gridHtml;
        }

        function renderAiStatsChart(days) {
            var chart = document.getElementById('aiStatsBarChart');
            var title = document.getElementById('aiStatsChartTitle');
            var legend = document.getElementById('aiStatsLegend');
            if (!chart) return;
            chart.innerHTML = '';
            if (days.length === 0) {
                chart.innerHTML = '<div style="text-align:center;padding:40px;color:var(--vscode-descriptionForeground);font-size:12px;">No data for this period</div>';
                return;
            }
            var chartData = days;
            var labelFn;
            if (days.length <= 7) {
                labelFn = function(d) { var dt = new Date(d.date + 'T00:00:00'); return dt.toLocaleDateString('en-US',{weekday:'short',day:'numeric'}); };
            } else if (days.length <= 31) {
                labelFn = function(d) { return new Date(d.date + 'T00:00:00').getDate().toString(); };
            } else {
                labelFn = function(d) { var dt = new Date(d.date + 'T00:00:00'); return (dt.getMonth()+1) + '/' + dt.getDate(); };
            }
            if (title) title.textContent = 'AI Rate by Day';
            if (legend) {
                legend.innerHTML = '<span class="legend-item"><span class="legend-dot" style="background:#58a6ff"></span> AI Rate</span><span class="legend-item"><span class="legend-dot" style="background:rgba(110,118,129,0.3)"></span> Sessions</span>';
            }
            chartData.forEach(function(item, i) {
                var total = item.aiCharacters + item.typedCharacters;
                var rate = total > 0 ? Math.round(item.aiCharacters / total * 100) : 0;
                var col = document.createElement('div'); col.className = 'bar-col';
                var fill = document.createElement('div'); fill.className = 'bar-fill';
                fill.style.background = 'linear-gradient(180deg,#58a6ff,#3b82f6)';
                fill.style.height = '0%';
                fill.title = rate + '% AI rate · ' + (item.sessions || 0) + ' sessions · ' + item.aiCharacters.toLocaleString() + ' AI / ' + total.toLocaleString() + ' total chars';
                var valSpan = document.createElement('span'); valSpan.className = 'bar-value'; valSpan.textContent = rate + '%';
                fill.appendChild(valSpan);
                var sessLabel = document.createElement('span');
                sessLabel.style.cssText = 'font-size:8px;color:var(--vscode-descriptionForeground);opacity:0.7;margin-top:1px;';
                sessLabel.textContent = (item.sessions || 0) + ' sess';
                var label = document.createElement('span'); label.className = 'bar-label';
                label.textContent = labelFn(item);
                col.appendChild(fill); col.appendChild(sessLabel); col.appendChild(label); chart.appendChild(col);
                setTimeout(function() { fill.style.height = Math.max(rate, 3) + '%'; }, 60 + i * 30);
            });
        }

        function renderAiStatsStackedChart(days) {
            var chart = document.getElementById('aiStatsStackedChart');
            if (!chart) return;
            chart.innerHTML = '';
            if (days.length === 0) {
                chart.innerHTML = '<div style="text-align:center;padding:40px;color:var(--vscode-descriptionForeground);font-size:12px;">No data for this period</div>';
                return;
            }
            var chartData = days;
            var labelFn;
            if (days.length <= 7) {
                labelFn = function(d) { var dt = new Date(d.date + 'T00:00:00'); return dt.toLocaleDateString('en-US',{weekday:'short',day:'numeric'}); };
            } else if (days.length <= 31) {
                labelFn = function(d) { return new Date(d.date + 'T00:00:00').getDate().toString(); };
            } else {
                labelFn = function(d) { var dt = new Date(d.date + 'T00:00:00'); return (dt.getMonth()+1) + '/' + dt.getDate(); };
            }
            // Find max for scaling
            var maxVal = 0;
            for (var i = 0; i < chartData.length; i++) {
                if (chartData[i].aiCharacters > maxVal) maxVal = chartData[i].aiCharacters;
                if (chartData[i].typedCharacters > maxVal) maxVal = chartData[i].typedCharacters;
            }
            if (maxVal === 0) maxVal = 1;
            // Render grouped bars (side-by-side)
            chartData.forEach(function(item, idx) {
                var total = item.aiCharacters + item.typedCharacters;
                var aiPct = Math.round(item.aiCharacters / maxVal * 100);
                var typedPct = Math.round(item.typedCharacters / maxVal * 100);
                var col = document.createElement('div'); col.className = 'grouped-bar-col';
                // Percentage label
                var valSpan = document.createElement('span'); valSpan.className = 'bar-value';
                valSpan.style.position = 'relative'; valSpan.style.top = '0'; valSpan.style.left = 'auto'; valSpan.style.transform = 'none';
                valSpan.textContent = total > 0 ? Math.round(item.aiCharacters / total * 100) + '% AI' : '-';
                // Bar pair container
                var barPair = document.createElement('div'); barPair.className = 'grouped-bars';
                var aiBar = document.createElement('div'); aiBar.className = 'grouped-bar';
                aiBar.style.background = 'linear-gradient(180deg,#58a6ff,#3b82f6)';
                aiBar.style.height = '0%';
                aiBar.title = 'AI: ' + item.aiCharacters.toLocaleString() + ' characters';
                var typedBar = document.createElement('div'); typedBar.className = 'grouped-bar';
                typedBar.style.background = 'linear-gradient(180deg,#a78bfa,#7c3aed)';
                typedBar.style.height = '0%';
                typedBar.title = 'Typed: ' + item.typedCharacters.toLocaleString() + ' characters';
                barPair.appendChild(aiBar); barPair.appendChild(typedBar);
                var label = document.createElement('span'); label.className = 'bar-label';
                label.textContent = labelFn(item);
                col.appendChild(valSpan); col.appendChild(barPair); col.appendChild(label); chart.appendChild(col);
                setTimeout(function() { aiBar.style.height = Math.max(aiPct, 2) + '%'; typedBar.style.height = Math.max(typedPct, 2) + '%'; }, 60 + idx * 30);
            });
            // Legend
            var legendDiv = chart.parentElement.querySelector('.stacked-legend');
            if (!legendDiv) {
                legendDiv = document.createElement('div');
                legendDiv.className = 'stacked-legend';
                legendDiv.style.cssText = 'display:flex;gap:16px;justify-content:center;margin-top:8px;font-size:11px;';
                legendDiv.innerHTML = '<span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:3px;background:linear-gradient(180deg,#58a6ff,#3b82f6);display:inline-block;"></span> AI Characters</span>' +
                    '<span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:3px;background:linear-gradient(180deg,#a78bfa,#7c3aed);display:inline-block;"></span> Typed Characters</span>';
                chart.parentElement.appendChild(legendDiv);
            }
        }

        function renderAiStatsMetricChart(days, field, chartId, legendId, label, color1, color2, unit) {
            var chart = document.getElementById(chartId);
            if (!chart) return;
            chart.innerHTML = '';
            if (days.length === 0) {
                chart.innerHTML = '<div style="text-align:center;padding:40px;color:var(--vscode-descriptionForeground);font-size:12px;">No data for this period</div>';
                return;
            }
            var chartData = [];
            for (var i = 0; i < days.length; i++) {
                chartData.push({ date: days[i].date, val: days[i][field] || 0 });
            }
            var labelFn;
            if (days.length <= 7) {
                labelFn = function(d) { var dt = new Date(d.date + 'T00:00:00'); return dt.toLocaleDateString('en-US',{weekday:'short',day:'numeric'}); };
            } else if (days.length <= 31) {
                labelFn = function(d) { return new Date(d.date + 'T00:00:00').getDate().toString(); };
            } else {
                labelFn = function(d) { var dt = new Date(d.date + 'T00:00:00'); return (dt.getMonth()+1) + '/' + dt.getDate(); };
            }
            var maxVal = 0;
            for (var i = 0; i < chartData.length; i++) { if (chartData[i].val > maxVal) maxVal = chartData[i].val; }
            if (maxVal === 0) maxVal = 1;
            var legendEl = document.getElementById(legendId);
            if (legendEl) {
                legendEl.innerHTML = '<span class="legend-item"><span class="legend-dot" style="background:' + color1 + '"></span> ' + label + '</span>';
            }
            chartData.forEach(function(item, i) {
                var pct = Math.round(item.val / maxVal * 100);
                var col = document.createElement('div'); col.className = 'bar-col';
                var fill = document.createElement('div'); fill.className = 'bar-fill';
                fill.style.background = 'linear-gradient(180deg,' + color1 + ',' + color2 + ')';
                fill.style.height = '0%';
                fill.title = item.val.toLocaleString() + ' ' + unit;
                var valSpan = document.createElement('span'); valSpan.className = 'bar-value';
                valSpan.textContent = item.val.toLocaleString();
                fill.appendChild(valSpan);
                var lbl = document.createElement('span'); lbl.className = 'bar-label';
                lbl.textContent = labelFn(item);
                col.appendChild(fill); col.appendChild(lbl); chart.appendChild(col);
                setTimeout(function() { fill.style.height = Math.max(pct, 3) + '%'; }, 60 + i * 30);
            });
        }

        function updateAiStats() {
            var filtered = getFilteredAiStats();
            var days = aggregateAiStatsByDay(filtered);
            renderAiStatsSummary(days);
            renderAiHeatmap();
            renderAiStatsChart(days);
            renderAiStatsStackedChart(days);
            renderAiStatsMetricChart(days, 'acceptedInlineSuggestions', 'aiStatsSuggestionsChart', 'suggestionsLegend', 'Accepted Inline Suggestions', '#22c55e', '#16a34a', 'suggestions');
            renderAiStatsMetricChart(days, 'chatEditCount', 'aiStatsChatEditsChart', 'chatEditsLegend', 'Chat Edits', '#f59e0b', '#d97706', 'edits');
            renderAiStatsMetricChart(days, 'sessions', 'aiStatsSessionsChart', 'sessionsLegend', 'Sessions', '#a78bfa', '#7c3aed', 'sessions');
            var lbl = document.getElementById('aiStatsPeriodLabel');
            if (lbl) lbl.textContent = getPeriodLabel(aiStatsPeriod);
        }

        // AI Stats period filter buttons
        document.querySelectorAll('[data-ai-period]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('[data-ai-period]').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                aiStatsPeriod = btn.dataset.aiPeriod;
                updateAiStats();
            });
        });

        // AI Stats workspace filter
        var aiWsSel = document.getElementById('aiStatsWsFilter');
        if (aiWsSel) {
            aiWsSel.addEventListener('change', function() {
                aiStatsWs = this.value;
                updateAiStats();
            });
        }

        // Chart refresh buttons — use IDs directly, no data-command to avoid conflict
        var refreshUsageBtn = document.getElementById('refreshUsageBtn');
        if (refreshUsageBtn) {
            refreshUsageBtn.addEventListener('click', function(e) {
                e.preventDefault(); e.stopPropagation();
                var icon = refreshUsageBtn.querySelector('.codicon');
                if (icon) icon.classList.add('spin');
                setTimeout(function() { updateUsageDashboard(); if (icon) icon.classList.remove('spin'); }, 400);
            });
        }
        var refreshAiBtn = document.getElementById('refreshAiStatsBtn');
        if (refreshAiBtn) {
            refreshAiBtn.addEventListener('click', function(e) {
                e.preventDefault(); e.stopPropagation();
                var icon = refreshAiBtn.querySelector('.codicon');
                if (icon) icon.classList.add('spin');
                setTimeout(function() { updateAiStats(); if (icon) icon.classList.remove('spin'); }, 400);
            });
        }

        // Initial AI Stats render
        updateAiStats();

        // ========== CHAT SESSIONS & HISTORY TAB ==========
        var chatWs = 'all';
        var chatSort = 'newest';
        var chatSearch = '';
        var chatSource = 'all';
        var chatType = 'all';
        var chatPage = 1;
        var chatPerPage = 15;

        // Populate chat workspace filter + dynamic type filter buttons
        (function() {
            var sel = document.getElementById('chatWsFilter');
            if (sel && CHAT_SESSIONS_RAW.length > 0) {
                var wsSet = {};
                for (var i = 0; i < CHAT_SESSIONS_RAW.length; i++) { wsSet[CHAT_SESSIONS_RAW[i].workspace] = true; }
                var wsNames = Object.keys(wsSet).sort();
                for (var i = 0; i < wsNames.length; i++) {
                    var opt = document.createElement('option');
                    opt.value = wsNames[i]; opt.textContent = wsNames[i];
                    sel.appendChild(opt);
                }
            }
            // Build dynamic type filter dropdown from actual data
            var typeSel = document.getElementById('chatTypeFilter');
            if (typeSel && CHAT_SESSIONS_RAW.length > 0) {
                var typeCounts = {};
                var customAgents = {};
                var total = CHAT_SESSIONS_RAW.length;
                for (var i = 0; i < CHAT_SESSIONS_RAW.length; i++) {
                    var s = CHAT_SESSIONS_RAW[i];
                    var ct = s.chatType || 'chat';
                    if (ct === 'agent' || s.source === 'agentSession') ct = 'agent';
                    if (!typeCounts[ct]) typeCounts[ct] = 0;
                    typeCounts[ct]++;
                    if (s.agentName && s.agentName !== 'agent') {
                        if (!customAgents[s.agentName]) customAgents[s.agentName] = 0;
                        customAgents[s.agentName]++;
                    }
                }
                var typeLabels = { 'agent': 'Agent', 'ask': 'Ask', 'chat': 'Chat', 'plan': 'Plan' };
                var typeOrder = ['agent', 'ask', 'chat', 'plan'];
                for (var t = 0; t < typeOrder.length; t++) {
                    var typ = typeOrder[t];
                    if (typeCounts[typ]) {
                        var opt = document.createElement('option');
                        opt.value = typ;
                        opt.textContent = typeLabels[typ] || typ;
                        typeSel.appendChild(opt);
                    }
                }
                // Add individual custom agents
                var agentNames = Object.keys(customAgents).sort();
                for (var a = 0; a < agentNames.length; a++) {
                    var opt2 = document.createElement('option');
                    opt2.value = 'custom:' + agentNames[a];
                    opt2.textContent = '@' + agentNames[a];
                    typeSel.appendChild(opt2);
                }
            }
        })();

        function escChat(s) { if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

        function getFilteredChatSessions() {
            var filtered = CHAT_SESSIONS_RAW.filter(function(s) {
                if (chatWs !== 'all' && s.workspace !== chatWs) return false;
                if (chatType !== 'all') {
                    var st = s.chatType || 'chat';
                    if (s.source === 'agentSession') st = 'agent';
                    // Handle custom:agentName filter
                    if (chatType.indexOf('custom:') === 0) {
                        if (s.agentName !== chatType.substring(7)) return false;
                    } else {
                        if (chatType === 'agent' && st !== 'agent') return false;
                        if (chatType === 'ask' && st !== 'ask') return false;
                        if (chatType === 'chat' && st !== 'chat') return false;
                        if (chatType === 'plan' && st !== 'plan') return false;
                    }
                }
                if (chatSearch) {
                    var q = chatSearch.toLowerCase();
                    var inTitle = (s.title || '').toLowerCase().indexOf(q) >= 0;
                    var inWs = (s.workspace || '').toLowerCase().indexOf(q) >= 0;
                    var inDesc = (s.description || '').toLowerCase().indexOf(q) >= 0;
                    var inMsgs = false;
                    if (!inTitle && !inWs && !inDesc && s.messages) {
                        for (var m = 0; m < s.messages.length; m++) {
                            if ((s.messages[m].text || '').toLowerCase().indexOf(q) >= 0) { inMsgs = true; break; }
                        }
                    }
                    if (!inTitle && !inWs && !inDesc && !inMsgs) return false;
                }
                return true;
            });
            // Sort
            filtered.sort(function(a, b) {
                switch(chatSort) {
                    case 'oldest': return (a.creationDate || 0) - (b.creationDate || 0);
                    case 'most-msgs': return (b.messageCount || 0) - (a.messageCount || 0);
                    case 'name-asc': return (a.title || '').localeCompare(b.title || '');
                    case 'newest': default: return (b.lastMessageDate || b.creationDate || 0) - (a.lastMessageDate || a.creationDate || 0);
                }
            });
            return filtered;
        }

        function renderChatSummary(sessions) {
            var el = document.getElementById('chatSessionsSummary');
            if (!el) return;
            var totalMsgs = 0;
            var uniqueWs = {};
            var typeCounts = {};
            var activeCount = 0;
            for (var i = 0; i < sessions.length; i++) {
                totalMsgs += sessions[i].messageCount || 0;
                uniqueWs[sessions[i].workspace] = true;
                var ct = sessions[i].chatType || 'chat';
                if (sessions[i].source === 'agentSession') ct = 'agent';
                if (!typeCounts[ct]) typeCounts[ct] = 0;
                typeCounts[ct]++;
                if (sessions[i].status === 2) activeCount++;
            }
            var typeColors = { 'agent': '#a78bfa', 'ask': '#22c55e', 'chat': '#58a6ff', 'plan': '#06b6d4', 'custom-agent': '#f59e0b' };
            var typeIcons = { 'agent': 'codicon-robot', 'ask': 'codicon-question', 'chat': 'codicon-comment-discussion', 'plan': 'codicon-list-tree', 'custom-agent': 'codicon-extensions' };
            var typeLabels = { 'agent': 'Agent', 'ask': 'Ask', 'chat': 'Chat', 'plan': 'Plan', 'custom-agent': 'Custom Agent' };
            var html = '<div class="chat-summary-stat" title="Total sessions"><div class="chat-summary-value">' + sessions.length + '</div><div class="chat-summary-label">Total Sessions</div></div>';
            var typeOrder = ['agent', 'ask', 'chat', 'plan'];
            for (var t = 0; t < typeOrder.length; t++) {
                var typ = typeOrder[t];
                if (typeCounts[typ]) {
                    var clr = typeColors[typ] || '#6e7681';
                    var ico = typeIcons[typ] || '';
                    var lbl = typeLabels[typ] || typ;
                    html += '<div class="chat-summary-stat" title="' + lbl + ' sessions"><div class="chat-summary-value" style="color:' + clr + ';">' + typeCounts[typ] + '</div><div class="chat-summary-label"><span class="codicon ' + ico + '" style="font-size:10px;"></span> ' + lbl + '</div></div>';
                }
            }
            if (activeCount > 0) {
                html += '<div class="chat-summary-stat"><div class="chat-summary-value" style="color:#22c55e;"><span class="codicon codicon-pulse" style="font-size:14px;"></span> ' + activeCount + '</div><div class="chat-summary-label">Active Now</div></div>';
            }
            html += '<div class="chat-summary-stat"><div class="chat-summary-value">' + totalMsgs + '</div><div class="chat-summary-label">Total Prompts</div></div>';
            html += '<div class="chat-summary-stat"><div class="chat-summary-value">' + Object.keys(uniqueWs).length + '</div><div class="chat-summary-label">Workspaces</div></div>';
            el.innerHTML = html;
        }

        function fmtChatDate(ts) {
            if (!ts) return '\u2014';
            var d = new Date(ts);
            var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        function timeAgoCh(ts) {
            if (!ts) return '';
            var d = Date.now() - ts;
            if (d < 60000) return 'just now';
            if (d < 3600000) return Math.floor(d/60000) + 'm ago';
            if (d < 86400000) return Math.floor(d/3600000) + 'h ago';
            if (d < 2592000000) return Math.floor(d/86400000) + 'd ago';
            return Math.floor(d/2592000000) + 'mo ago';
        }

        function renderChatSessionsList(sessions) {
            var listEl = document.getElementById('chatSessionsList');
            if (!listEl) return;
            if (sessions.length === 0) {
                listEl.innerHTML = '<div style="text-align:center;padding:32px;color:var(--vscode-descriptionForeground);"><span class="codicon codicon-comment-discussion" style="font-size:24px;display:block;margin-bottom:8px;"></span>No sessions match your filters</div>';
                return;
            }
            var totalPages = Math.ceil(sessions.length / chatPerPage);
            if (chatPage > totalPages) chatPage = totalPages;
            var start = (chatPage - 1) * chatPerPage;
            var end = Math.min(start + chatPerPage, sessions.length);
            var pageData = sessions.slice(start, end);

            var html = '';
            for (var i = 0; i < pageData.length; i++) {
                var s = pageData[i];
                var locIcon = s.source === 'agentSession' ? 'editor' : s.chatType === 'custom-agent' ? 'inline' : s.initialLocation === 'editor' ? 'editor' : s.initialLocation === 'inline' ? 'inline' : 'panel';
                var locCodicon = s.source === 'agentSession' ? 'codicon-robot' : s.chatType === 'custom-agent' ? 'codicon-extensions' : s.chatType === 'ask' ? 'codicon-question' : locIcon === 'editor' ? 'codicon-edit' : locIcon === 'inline' ? 'codicon-code' : 'codicon-comment-discussion';
                var title = escChat(s.title || 'Untitled Session');
                var dateStr = fmtChatDate(s.lastMessageDate || s.creationDate);
                var ago = timeAgoCh(s.lastMessageDate || s.creationDate);
                var ws = escChat(s.workspace);
                // Type label
                var typeLabel = s.chatType === 'agent' || s.source === 'agentSession' ? 'Agent' : s.chatType === 'ask' ? 'Ask' : s.chatType === 'custom-agent' ? '@' + escChat(s.agentName || 'custom') : 'Chat';
                var typeClass = s.chatType === 'agent' || s.source === 'agentSession' ? 'agent' : s.chatType === 'ask' ? 'ask' : s.chatType === 'custom-agent' ? 'custom' : 'chat';
                var statusLabel = s.statusLabel || 'completed';
                var statusClass = statusLabel;

                var isCurrentWs = s.isCurrentWorkspace || (CURRENT_WORKSPACE && s.workspace === CURRENT_WORKSPACE);
                html += '<div class="chat-session-card ' + (isCurrentWs ? 'current-ws' : 'other-ws') + '" data-session-idx="' + (start + i) + '">';
                html += '<div class="chat-session-header">';
                html += '<div class="chat-session-icon ' + locIcon + '"><span class="codicon ' + locCodicon + '"></span></div>';
                html += '<div class="chat-session-info">';
                html += '<div class="chat-session-title" title="' + title + '">' + title + '</div>';
                html += '<div class="chat-session-meta">';
                html += '<span class="chat-source-badge ' + typeClass + '">' + typeLabel + '</span>';
                html += '<span class="chat-status-badge ' + statusClass + '">' + statusLabel + '</span>';
                html += '<span><span class="codicon codicon-folder" style="font-size:10px;"></span> ' + ws + '</span>';
                html += '<span><span class="codicon codicon-clock" style="font-size:10px;"></span> ' + dateStr + '</span>';
                if (ago) html += '<span style="opacity:0.7;">(' + ago + ')</span>';
                if (s.mode && s.mode !== 'chat' && s.chatType !== 'custom-agent') html += '<span class="tag tag-blue" style="font-size:9px;">' + escChat(s.mode) + '</span>';
                html += '</div>';
                html += '</div>';
                html += '<div class="chat-session-stats">';
                html += '<span class="chat-msg-count">' + (s.messageCount || 0) + ' prompt' + (s.messageCount !== 1 ? 's' : '') + '</span>';
                if (s.canReopen && s.sessionId) {
                    if (isCurrentWs) {
                        html += '<button class="chat-open-btn" data-command="openChatSession" data-session-id="' + escChat(s.sessionId) + '" data-session-title="' + title + '" title="Open this session in VS Code Chat"><span class="codicon codicon-link-external"></span> Open</button>';
                    } else {
                        html += '<span class="chat-open-btn" style="opacity:0.5;cursor:default;" title="Open this workspace (' + ws + ') first to reopen this session"><span class="codicon codicon-lock"></span> ' + ws + '</span>';
                    }
                }
                html += '</div>';
                html += '<span class="chat-expand-icon codicon codicon-chevron-right"></span>';
                html += '</div>'; // end header

                // Card body (expand on click)
                html += '<div class="chat-session-body">';
                if (s.source === 'agentSession') {
                    html += '<div class="chat-no-messages"><span class="codicon codicon-robot" style="margin-right:4px;"></span> Agent session \u2014 message history is managed by VS Code. Open this session in the Chat view to continue.</div>';
                } else {
                    html += '<div class="chat-no-messages"><span class="codicon codicon-comment-discussion" style="margin-right:4px;"></span> Chat session details are available in VS Code Chat. Use the Open button to view this session.</div>';
                }
                html += '</div>'; // end body
                html += '</div>'; // end card
            }
            listEl.innerHTML = html;

            // Pagination
            var pagEl = document.getElementById('chatSessionsPagination');
            if (pagEl) {
                if (totalPages <= 1) { pagEl.innerHTML = ''; }
                else {
                    var pHtml = '<button class="page-btn" ' + (chatPage <= 1 ? 'disabled' : '') + ' data-chat-page="' + (chatPage - 1) + '">\u25c0 Prev</button>';
                    pHtml += '<span class="page-info">Page ' + chatPage + ' of ' + totalPages + ' (' + sessions.length + ' sessions)</span>';
                    pHtml += '<button class="page-btn" ' + (chatPage >= totalPages ? 'disabled' : '') + ' data-chat-page="' + (chatPage + 1) + '">Next \u25b6</button>';
                    pagEl.innerHTML = pHtml;
                }
            }
        }

        function updateChatSessions() {
            var filtered = getFilteredChatSessions();
            // Summary tiles always show ALL sessions (unfiltered)
            renderChatSummary(CHAT_SESSIONS_RAW);
            renderChatSessionsList(filtered);
        }

        // Chat session expand/collapse + pagination
        document.addEventListener('click', function(e) {
            if (e.target.closest('.chat-open-btn')) return;
            var header = e.target.closest('.chat-session-header');
            if (header) {
                var card = header.closest('.chat-session-card');
                if (card) card.classList.toggle('expanded');
            }
            var pageBtn = e.target.closest('[data-chat-page]');
            if (pageBtn && !pageBtn.disabled) {
                chatPage = parseInt(pageBtn.dataset.chatPage);
                updateChatSessions();
            }
        });

        // Chat Type dropdown filter
        var chatTypeSel = document.getElementById('chatTypeFilter');
        if (chatTypeSel) {
            chatTypeSel.addEventListener('change', function() {
                chatType = this.value;
                chatPage = 1;
                updateChatSessions();
            });
        }

        // Chat workspace filter
        var chatWsSel = document.getElementById('chatWsFilter');
        if (chatWsSel) {
            chatWsSel.addEventListener('change', function() {
                chatWs = this.value;
                chatPage = 1;
                updateChatSessions();
            });
        }

        // Chat sort filter
        var chatSortSel = document.getElementById('chatSortBy');
        if (chatSortSel) {
            chatSortSel.addEventListener('change', function() {
                chatSort = this.value;
                chatPage = 1;
                updateChatSessions();
            });
        }

        // Chat search
        var chatSearchEl = document.getElementById('chatSearchInput');
        if (chatSearchEl) {
            var searchTimeout;
            chatSearchEl.addEventListener('input', function() {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(function() {
                    chatSearch = chatSearchEl.value.trim();
                    chatPage = 1;
                    updateChatSessions();
                }, 300);
            });
        }

        // Initial chat sessions render
        updateChatSessions();

        // ========== ACCOUNTS TAB — Click-to-select ==========
        (function() {
            var dataEl = document.getElementById('acctDataStore');
            if (!dataEl) return;
            var acctData;
            try { acctData = JSON.parse(dataEl.textContent); } catch(e) { return; }
            var items = document.querySelectorAll('.acct-list-item');
            var detailCol = document.getElementById('acctDetailCol');
            if (!items.length || !detailCol) return;

            function fmtDate(ts) { if (!ts) return '\\u2014'; var d = new Date(ts); return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) + ', ' + d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
            function timeAgo(ts) { if (!ts) return ''; var d = Date.now()-ts; if(d<60000) return 'just now'; if(d<3600000) return Math.floor(d/60000)+'m ago'; if(d<86400000) return Math.floor(d/3600000)+'h ago'; return Math.floor(d/86400000)+'d ago'; }
            function esc2(s) { if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

            function showDetail(provider, idx) {
                var acc = provider === 'github' ? acctData.github[idx] : acctData.microsoft[idx];
                if (!acc) return;
                var trusted = provider === 'github' ? acctData.ghTrusted : acctData.msTrusted;
                // Exact match first, then fuzzy match (API label vs DB label may differ)
                var exts = (trusted && trusted[acc.label]) || [];
                if (exts.length === 0 && trusted) {
                    // Try matching: normalize both to lowercase, strip @domain, replace _ with partial match
                    var normLabel = acc.label.toLowerCase().replace(/@.*$/, '').replace(/_/g, '');
                    for (var tKey in trusted) {
                        var normKey = tKey.toLowerCase().replace(/@.*$/, '').replace(/_/g, '');
                        if (normKey === normLabel || tKey.toLowerCase().indexOf(normLabel) === 0 || normLabel.indexOf(normKey) === 0) {
                            exts = trusted[tKey];
                            break;
                        }
                    }
                }
                var isCopilot = acctData.activeCopilot && acctData.activeCopilot.provider === provider && acctData.activeCopilot.label === acc.label;
                var ico = provider === 'github' ? 'codicon-github' : 'codicon-azure';
                var cls = provider === 'github' ? 'gh' : 'ms';

                var html = '<div class="card" style="height:100%;overflow:auto;">' +
                    '<div class="card-header"><div class="card-title"><span class="codicon ' + ico + '"></span> ' + esc2(acc.label) + '</div>' +
                    (isCopilot ? '<span class="badge purple">Copilot Active</span>' : '<span class="badge">' + esc2(provider) + '</span>') +
                    '</div><div class="card-body">' +
                    // Info rows
                    '<div class="info-grid">' +
                    '<div class="info-row"><span class="info-label">Account ID</span><span class="info-value">' + esc2(acc.id) + '</span></div>' +
                    '<div class="info-row"><span class="info-label">Provider</span><span class="info-value">' + esc2(provider) + '</span></div>' +
                    '<div class="info-row"><span class="info-label">Trusted Extensions</span><span class="info-value">' + exts.length + '</span></div>';
                // Show Last Copilot Use for any account that has copilot-chat trusted
                var copilotChatExt = null;
                for (var ci = 0; ci < exts.length; ci++) {
                    if (exts[ci].extensionId === 'github.copilot-chat' && exts[ci].lastUsed) { copilotChatExt = exts[ci]; break; }
                }
                if (copilotChatExt) {
                    html += '<div class="info-row"><span class="info-label">Last Copilot Use</span><span class="info-value">' + fmtDate(copilotChatExt.lastUsed) + ' (' + timeAgo(copilotChatExt.lastUsed) + ')</span></div>';
                }
                html += '</div>';

                // Trusted extensions table
                if (exts.length > 0) {
                    exts.sort(function(a,b) { return (b.lastUsed||0)-(a.lastUsed||0); });
                    html += '<div style="margin-top:16px;"><h3 style="font-size:13px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:6px;"><span class="codicon codicon-extensions"></span> Trusted Extensions</h3>' +
                        '<table class="data-table"><thead><tr><th>Extension</th><th>Scopes</th><th style="text-align:right;">Last Used</th></tr></thead><tbody>';
                    for (var i = 0; i < exts.length; i++) {
                        var te = exts[i];
                        html += '<tr><td style="font-weight:500;">' + esc2(te.extensionName || te.extensionId) + '</td>' +
                            '<td style="font-size:10px;color:var(--vscode-descriptionForeground);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc2((te.scopes||[]).join(', ')) + '">' + esc2((te.scopes||[]).join(', ') || '\\u2014') + '</td>' +
                            '<td style="text-align:right;white-space:nowrap;font-size:11px;">' + fmtDate(te.lastUsed) + '<br><span style="font-size:9px;color:var(--vscode-descriptionForeground);">' + timeAgo(te.lastUsed) + '</span></td></tr>';
                    }
                    html += '</tbody></table></div>';
                } else {
                    html += '<div style="margin-top:16px;text-align:center;color:var(--vscode-descriptionForeground);font-size:11px;padding:12px;">No trusted extensions for this account</div>';
                }

                // MCP + Policy for active copilot account
                if (isCopilot && acctData.copilotPolicy) {
                    var pol = acctData.copilotPolicy;
                    html += '<div style="margin-top:16px;"><h3 style="font-size:13px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:6px;"><span class="codicon codicon-shield"></span> Copilot Policy</h3>' +
                        '<div class="summary-grid" style="margin-bottom:0;">';
                    if (pol.accountId) html += '<div class="summary-item"><div class="summary-value" style="font-size:13px;">' + esc2(pol.accountId) + '</div><div class="summary-label">Account ID</div></div>';
                    if (pol.policyData) {
                        for (var key in pol.policyData) {
                            var val = pol.policyData[key];
                            html += '<div class="summary-item"><div class="summary-value" style="font-size:14px;color:' + (val ? '#22c55e' : '#ef4444') + ';">' + (val ? '\\u2713' : '\\u2717') + '</div><div class="summary-label">' + esc2(key.replace(/_/g,' ')) + '</div></div>';
                        }
                    }
                    html += '</div></div>';
                }

                html += '</div></div>';
                detailCol.innerHTML = html;
            }

            items.forEach(function(item) {
                item.addEventListener('click', function() {
                    items.forEach(function(it) { it.classList.remove('selected'); });
                    item.classList.add('selected');
                    showDetail(item.dataset.acctProvider, parseInt(item.dataset.acctIdx));
                });
            });

            // Auto-select first account
            if (items.length > 0) {
                showDetail(items[0].dataset.acctProvider, parseInt(items[0].dataset.acctIdx));
            }
        })();

        // ========== TRENDS SIDE PANEL TOGGLE ==========
        (function() {
            var panel = document.getElementById('trendsSidePanel');
            var tab = document.getElementById('trendsSidebarTab');
            var arrow = document.getElementById('trendsSideArrow');
            if (panel && tab) {
                tab.addEventListener('click', function() {
                    panel.classList.toggle('collapsed');
                    panel.classList.toggle('expanded');
                    if (arrow) arrow.textContent = panel.classList.contains('expanded') ? '\u25B6' : '\u25C0';
                });
            }
        })();

        // ========== COLLAPSIBLE CHART SECTIONS ==========
        (function() {
            document.querySelectorAll('.collapsible-header[data-collapse]').forEach(function(header) {
                var key = header.getAttribute('data-collapse');
                var body = document.querySelector('[data-collapse-body="' + key + '"]');
                var chevron = document.querySelector('[data-collapse-icon="' + key + '"]');
                if (!body) return;
                header.addEventListener('click', function() {
                    var isHidden = body.style.display === 'none';
                    body.style.display = isHidden ? 'block' : 'none';
                    if (chevron) chevron.style.transform = isHidden ? '' : 'rotate(-90deg)';
                });
            });
        })();

        // ========== RECENT SESSIONS INFO ICON ==========
        (function() {
            var infoIcon = document.querySelector('.recent-sessions-info-icon');
            var infoTip = document.querySelector('.recent-sessions-info-tooltip');
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
        })();

        // ========== TRENDS & REPORTS ==========
        ${getTrendsJS()}
    `;
}

module.exports = { DashboardPanel };
