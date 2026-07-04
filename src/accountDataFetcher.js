/*
 * ----------------------------------------------------------------------------
 * Created On  : 27-Feb-2026
 * Description : Fetches all account, authentication, MCP server, Copilot,
 *               language model, tool, and AI stats data from VS Code APIs
 *               and the internal state.vscdb database.
 *
 *   Methods:
 *     getGitHubAccounts()          - Fetches all GitHub accounts via auth API
 *     getMicrosoftAccounts()       - Fetches all Microsoft accounts via auth API
 *     getGitHubEnterpriseAccounts()- Fetches GitHub Enterprise accounts
 *     getActiveCopilotAccount()    - Detects which account last used Copilot Chat
 *     getActiveGitHubAccount()     - Resolves active GitHub account for Copilot
 *     getAccountTrustedExtensions()- Reads trusted extensions, MCP trust, and
 *                                    Copilot policy from state.vscdb
 *     getMcpServerConfigsFromFiles() - Reads MCP configs from .vscode/mcp.json
 *     getMcpServerConfigsFromSettings() - Reads MCP configs from VS Code settings
 *     getAllMcpServers()           - Merges file + settings MCP server configs
 *     getCopilotExtensionInfo()    - Gets Copilot & Copilot Chat install status
 *     getLanguageModels()          - Lists available LLMs via vscode.lm API
 *     getRegisteredTools()         - Lists all registered LM tools
 *     getAiStatsFromWorkspaceStorage() - Reads real AI usage stats from state DBs
 *     getWorkspaceInfo()           - Gets workspace name and folder info
 *     computeReadiness()           - Computes system readiness status
 *     getContextAnalysis()         - Computes context window token analysis
 *     getAllData()                 - Aggregates all data into a single object
 *
 * ----------------------------------------------------------------------------
 */
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Fetches all account information from VS Code authentication providers,
 * MCP server configurations, Copilot status, language models, and tools.
 * 
 * Active account detection reads VS Code's internal state.vscdb to find
 * the definitive Copilot account mapping and trusted extensions per account.
 */
class AccountDataFetcher {

    // ─── Per-refresh-cycle cache for state.vscdb ───────────────────────
    // Prevents reading the same large binary file 3+ times per refresh.
    // Cache is explicitly cleared at the start of each getAllData() call.
    static _stateDbContentCache = null;
    static _stateDbCacheTimestamp = 0;
    static _stateDbCachePath = null;

    /**
     * Returns the raw content of the global state.vscdb file as a string.
     * Uses a per-refresh-cycle cache (valid for 3 seconds) to avoid reading
     * the same ~50MB+ binary file multiple times during a single refresh.
     *
     * @param {'utf8'|'latin1'} [encoding='utf8'] - Encoding to use for reading
     * @returns {string|null} File content as string, or null if not found
     */
    static _getStateDbContent(encoding = 'utf8') {
        const dbPath = this._getStateDbPath();
        const now = Date.now();
        // Return cached content if same path + within 3 seconds (same refresh cycle)
        if (this._stateDbContentCache && this._stateDbCachePath === dbPath + ':' + encoding && (now - this._stateDbCacheTimestamp) < 3000) {
            return this._stateDbContentCache;
        }
        try {
            if (!fs.existsSync(dbPath)) return null;
            // Use fs.openSync/readSync/closeSync to ensure a clean file handle
            const fd = fs.openSync(dbPath, 'r');
            const buf = fs.readFileSync(dbPath);
            fs.closeSync(fd);
            const content = buf.toString(encoding);
            this._stateDbContentCache = content;
            this._stateDbCachePath = dbPath + ':' + encoding;
            this._stateDbCacheTimestamp = now;
            return content;
        } catch (e) {
            console.log('State DB read failed:', e.message);
            return null;
        }
    }

    /**
     * Invalidates the state DB cache. Called at the start of each getAllData()
     * refresh cycle so that subsequent reads within the same cycle share one
     * consistent snapshot, but the next refresh gets fresh data.
     */
    static _clearCache() {
        this._stateDbContentCache = null;
        this._stateDbCacheTimestamp = 0;
        this._stateDbCachePath = null;
    }

    /**
     * Fetches all signed-in GitHub accounts from VS Code's authentication API.
     * For each account, silently requests a session to check connectivity.
     *
     * @returns {Promise<Array<{id:string, label:string, provider:string, hasSession:boolean, scopes:string[], accessToken:string|null}>>}
     * @see Used by getAllData() → data.github
     * @see Referenced in dashboardPanel.js (Accounts tab) and sidebarProvider.js
     */
    static async getGitHubAccounts() {
        const accounts = [];
        try {
            const ghAccounts = await vscode.authentication.getAccounts('github');
            for (const account of ghAccounts) {
                let session = null;
                try {
                    session = await vscode.authentication.getSession('github', ['user:email', 'read:user'], {
                        account: account,
                        silent: true
                    });
                } catch (e) { /* no session access */ }
                accounts.push({
                    id: account.id,
                    label: account.label,
                    provider: 'github',
                    hasSession: !!session,
                    scopes: session ? session.scopes : [],
                    accessToken: session ? '••••••' + session.accessToken.slice(-4) : null
                });
            }
        } catch (e) {
            console.log('Could not fetch GitHub accounts:', e.message);
        }
        return accounts;
    }

    // ─── State Database helpers ────────────────────────────────────────

    /**
     * Returns the path to VS Code's global state.vscdb (cross-platform).
     */
    /**
     * Returns the absolute path to VS Code's global state.vscdb SQLite database.
     * Handles Windows, macOS, and Linux paths.
     *
     * @returns {string} Absolute path to state.vscdb
     * @see Used by _getCopilotAccountFromStateDb(), _getTrustedExtensionsFromStateDb(), getAccountTrustedExtensions()
     */
    static _getStateDbPath() {
        const p = process.platform;
        if (p === 'win32') return path.join(process.env.APPDATA, 'Code', 'User', 'globalStorage', 'state.vscdb');
        if (p === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'state.vscdb');
        return path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'state.vscdb');
    }

    /**
     * Reads the state.vscdb and extracts the value of the "github.copilot-github" key,
     * which stores the GitHub account label that Copilot is authorised to use.
     * 
     * In the state DB, the key-value is stored as "github.copilot-github<binary-separator><value>".
     * We collect ALL occurrences and return the one that matches a known account label.
     * If none match, we use the last occurrence (most recent DB page).
     */
    /**
     * Reads VS Code's state.vscdb to extract the GitHub account label stored
     * under the "github.copilot-github" key. Collects all occurrences across
     * SQLite pages and returns the last one (most recent).
     *
     * @returns {string|null} The GitHub account label (e.g. "shubhamjms") or null
     * @see Used by getActiveGitHubAccount() as Strategy 1
     */
    static _getCopilotAccountFromStateDb() {
        try {
            const text = this._getStateDbContent('utf8');
            if (!text) return null;
            const key = 'github.copilot-github';
            const candidates = [];
            let idx = 0;
            while ((idx = text.indexOf(key, idx)) !== -1) {
                const tail = text.slice(idx + key.length, idx + key.length + 120);
                // Skip keys like "github.copilot-github-user:email" or "github.copilot-github-usages"
                if (/^[-:]/.test(tail.replace(/[^\x20-\x7E]/g, '').trim())) {
                    idx += key.length;
                    continue;
                }
                // Extract printable chars after key, skipping binary separators
                const cleaned = tail.replace(/[^\x20-\x7E]/g, ' ').replace(/^ +/, '');
                // Match a GitHub username pattern (alphanumeric, _, -, .)
                const m = cleaned.match(/^([a-zA-Z][a-zA-Z0-9_.-]*)/);
                if (m && m[1] && m[1].length >= 3) {
                    candidates.push(m[1]);
                }
                idx += key.length;
            }
            // Return the last candidate (latest DB page = most recent value)
            if (candidates.length > 0) return candidates[candidates.length - 1];
        } catch (e) { console.log('State DB (copilot account) read failed:', e.message); }
        return null;
    }

    /**
     * Reads trusted-extension usage arrays from the state.vscdb.
     * Keys follow the pattern "github-<label>-usages" / "microsoft-<label>-usages"
     * and contain JSON arrays: [{extensionId, extensionName, scopes, lastUsed}, …]
     * 
     * @param {string[]} labels  Account labels to look up.
     * @param {'github'|'microsoft'} provider  Auth provider prefix.
     * @returns {Object.<string, Array>}  Map of label → trusted extension entries.
     */
    /**
     * Reads trusted-extension usage arrays from state.vscdb for given account labels.
     * Each entry contains: extensionId, extensionName, scopes[], lastUsed timestamp.
     *
     * @param {string[]} labels - Account labels to look up (e.g. ["shubhamjms"])
     * @param {'github'|'microsoft'} [provider='github'] - Auth provider prefix for DB key
     * @returns {Object.<string, Array<{extensionId:string, extensionName:string, scopes:string[], lastUsed:number}>>}
     * @see Used by getActiveGitHubAccount() Strategy 3
     */
    static _getTrustedExtensionsFromStateDb(labels, provider = 'github') {
        const result = {};
        try {
            const text = this._getStateDbContent('utf8');
            if (!text) return result;
            for (const label of labels) {
                const key = `${provider}-${label}-usages`;
                const idx = text.indexOf(key);
                if (idx === -1) continue;
                const after = text.slice(idx + key.length, idx + key.length + 5000);
                const jsonStart = after.indexOf('[');
                if (jsonStart === -1 || jsonStart > 50) continue;
                // Find matching ] with depth tracking
                let depth = 0, jsonEnd = -1;
                for (let i = jsonStart; i < after.length; i++) {
                    if (after[i] === '[') depth++;
                    if (after[i] === ']') { depth--; if (depth === 0) { jsonEnd = i; break; } }
                }
                if (jsonEnd === -1) continue;
                const jsonStr = after.slice(jsonStart, jsonEnd + 1).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
                try { result[label] = JSON.parse(jsonStr); } catch (e) { /* bad JSON */ }
            }
        } catch (e) { console.log('State DB (trusted extensions) read failed:', e.message); }
        return result;
    }

    // ─── Active Copilot Account Detection ────────────────────────────

    /**
     * Identifies which GitHub account is most recently using Copilot Chat.
     * Scans only GitHub provider usages from the state DB (Microsoft accounts
     * are excluded — they are used for MCP servers, not Copilot Chat).
     * Finds the account whose "github.copilot-chat" entry has the highest
     * `lastUsed` timestamp.
     *
     * Returns { label, provider, lastUsed, detectedVia } or null.
     */
    /**
     * Identifies which GitHub account most recently used Copilot Chat.
     * Only GitHub accounts are considered — Microsoft accounts may appear in
     * the state DB for MCP servers or other extensions but are NOT used for
     * GitHub Copilot Chat authentication.
     *
     * @returns {{label:string, provider:string, lastUsed:number, detectedVia:string}|null}
     * @see Used by getAllData() → data.activeCopilotAccount
     * @see Referenced in dashboardPanel.js (Copilot tab, Accounts tab) and sidebarProvider.js
     */
    static getActiveCopilotAccount() {
        try {
            const trustedExts = this.getAccountTrustedExtensions();
            let best = null;
            // Only check GitHub accounts — Copilot Chat exclusively uses GitHub auth
            for (const [label, exts] of Object.entries(trustedExts.github || {})) {
                const chatExt = (exts || []).find(e => e.extensionId === 'github.copilot-chat');
                if (chatExt && chatExt.lastUsed && (!best || chatExt.lastUsed > best.lastUsed)) {
                    best = { label, provider: 'github', lastUsed: chatExt.lastUsed, extensionName: chatExt.extensionName };
                }
            }
            // NOTE: Microsoft accounts are intentionally excluded here.
            // They may have copilot-chat entries in the state DB (e.g. for MCP servers)
            // but GitHub Copilot Chat only authenticates via GitHub accounts.
            if (best) return { ...best, detectedVia: 'last-used' };
        } catch (e) { console.log('Could not detect active Copilot account:', e.message); }
        return null;
    }

    // Keep old method for backward compat (used by Accounts tab active Copilot highlight)
    /**
     * Resolves the active GitHub account for Copilot highlighting in the Accounts tab.
     * Strategy 1: getActiveCopilotAccount() (state DB lastUsed).
     * Strategy 2: getSession() without account param (default/preferred session).
     * Strategy 3: Trusted-extension scan (most recent lastUsed timestamp).
     *
     * @returns {Promise<{id:string, label:string, detectedVia:string}|null>}
     * @see Used by getAllData() → data.activeGitHubAccount
     * @see Referenced in dashboardPanel.js Accounts tab (isActive highlight)
     */
    static async getActiveGitHubAccount() {
        const active = this.getActiveCopilotAccount();
        if (active && active.provider === 'github') {
            try {
                const allAccounts = await vscode.authentication.getAccounts('github');
                const match = allAccounts.find(a => a.label === active.label);
                if (match) return { id: match.id, label: match.label, detectedVia: active.detectedVia };
            } catch (e) { /* continue */ }
            return { id: active.label, label: active.label, detectedVia: active.detectedVia };
        }

        // ── Strategy 2: Default Session (preferred session) ──
        try {
            const session = await vscode.authentication.getSession('github', ['user:email'], { silent: true });
            if (session && session.account) {
                return { id: session.account.id, label: session.account.label, detectedVia: 'default-session' };
            }
        } catch (e) { /* continue */ }

        // ── Strategy 3: Trusted-Extension Scan (most-recent lastUsed) ──
        try {
            const allAccounts = await vscode.authentication.getAccounts('github');
            const labels = allAccounts.map(a => a.label);
            const usages = this._getTrustedExtensionsFromStateDb(labels, 'github');
            let best = null, latest = 0;
            for (const [label, exts] of Object.entries(usages)) {
                const entry = (exts || []).find(e => e.extensionId === 'github.copilot-chat' || e.extensionId === 'github.copilot');
                if (entry && entry.lastUsed > latest) {
                    latest = entry.lastUsed;
                    best = allAccounts.find(a => a.label === label);
                }
            }
            if (best) return { id: best.id, label: best.label, detectedVia: 'usage-timestamp' };
        } catch (e) { /* continue */ }

        return null;
    }

    /**
     * Returns trusted extensions (from state DB) for all GitHub AND Microsoft accounts.
     * Scans the DB directly for all *-usages keys instead of relying on API labels.
     * Also includes MCP server trust data and Copilot policy data.
     */
    /**
     * Scans state.vscdb for ALL trusted extension data across all providers.
     * Returns GitHub usages, Microsoft usages, MCP server trust data, and Copilot policy.
     * Merges duplicate DB entries, keeping the highest lastUsed per extension.
     *
     * @returns {{github:Object, microsoft:Object, mcpServers:Array, copilotPolicy:Object|null}}
     * @see Used by getActiveCopilotAccount() and getAllData() → data.trustedExtensions
     * @see Referenced in dashboardPanel.js Accounts tab (detail panel)
     */
    static getAccountTrustedExtensions() {
        const result = { github: {}, microsoft: {}, mcpServers: [], copilotPolicy: null };
        try {
            const text = this._getStateDbContent('utf8');
            if (!text) return result;

            // Scan for ALL github-<label>-usages and microsoft-<label>-usages keys
            const extractAllUsages = (provider) => {
                const map = {};
                const regex = new RegExp(provider + '-([a-zA-Z0-9_.@-]+)-usages', 'g');
                let m;
                while ((m = regex.exec(text)) !== null) {
                    const label = m[1];
                    const keyEnd = m.index + m[0].length;
                    const after = text.slice(keyEnd, keyEnd + 5000);
                    const jStart = after.indexOf('[');
                    if (jStart === -1 || jStart > 50) continue;
                    let depth = 0, jEnd = -1;
                    for (let i = jStart; i < after.length; i++) {
                        if (after[i] === '[') depth++;
                        if (after[i] === ']') { depth--; if (depth === 0) { jEnd = i; break; } }
                    }
                    if (jEnd === -1) continue;
                    const jsonStr = after.slice(jStart, jEnd + 1).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
                    try {
                        const parsed = JSON.parse(jsonStr);
                        if (!map[label]) {
                            map[label] = parsed;
                        } else {
                            // Merge: for each extension, keep the entry with the highest lastUsed
                            for (const entry of parsed) {
                                const existing = map[label].find(e => e.extensionId === entry.extensionId);
                                if (!existing) { map[label].push(entry); }
                                else if (entry.lastUsed > (existing.lastUsed || 0)) {
                                    Object.assign(existing, entry);
                                }
                            }
                        }
                    } catch(e) { /* skip */ }
                }
                return map;
            };

            result.github = extractAllUsages('github');
            result.microsoft = extractAllUsages('microsoft');

            // MCP server usages
            const mcpKey = 'mcpserver-usages';
            const mcpIdx = text.indexOf(mcpKey);
            if (mcpIdx !== -1) {
                const after = text.slice(mcpIdx + mcpKey.length, mcpIdx + mcpKey.length + 3000);
                const jStart = after.indexOf('[');
                if (jStart !== -1 && jStart < 30) {
                    let depth = 0, jEnd = -1;
                    for (let i = jStart; i < after.length; i++) {
                        if (after[i] === '[') depth++;
                        if (after[i] === ']') { depth--; if (depth === 0) { jEnd = i; break; } }
                    }
                    if (jEnd !== -1) {
                        try { result.mcpServers = JSON.parse(after.slice(jStart, jEnd + 1).replace(/[\x00-\x1f\x7f-\x9f]/g, '')); } catch(e) {}
                    }
                }
            }

            // Copilot policy data
            const polKey = 'defaultAccount.cachedPolicyData';
            const polIdx = text.indexOf(polKey);
            if (polIdx !== -1) {
                const after = text.slice(polIdx + polKey.length, polIdx + polKey.length + 500).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
                const jStart = after.indexOf('{');
                if (jStart !== -1) {
                    let depth = 0, jEnd = -1;
                    for (let i = jStart; i < after.length; i++) {
                        if (after[i] === '{') depth++;
                        if (after[i] === '}') { depth--; if (depth === 0) { jEnd = i; break; } }
                    }
                    if (jEnd !== -1) { try { result.copilotPolicy = JSON.parse(after.slice(jStart, jEnd + 1)); } catch(e) {} }
                }
            }
        } catch (e) { console.log('Could not read trusted extensions from state DB:', e.message); }
        return result;
    }

    /**
     * Fetches all signed-in Microsoft accounts from VS Code's authentication API.
     *
     * @returns {Promise<Array<{id:string, label:string, provider:string, hasSession:boolean, scopes:string[]}>>}
     * @see Used by getAllData() → data.microsoft
     */
    static async getMicrosoftAccounts() {
        const accounts = [];
        try {
            const msAccounts = await vscode.authentication.getAccounts('microsoft');
            for (const account of msAccounts) {
                let session = null;
                try {
                    session = await vscode.authentication.getSession('microsoft', ['openid', 'profile', 'email'], {
                        account: account,
                        silent: true
                    });
                } catch (e) { /* no session access */ }
                accounts.push({
                    id: account.id,
                    label: account.label,
                    provider: 'microsoft',
                    hasSession: !!session,
                    scopes: session ? session.scopes : []
                });
            }
        } catch (e) {
            console.log('Could not fetch Microsoft accounts:', e.message);
        }
        return accounts;
    }

    /**
     * Fetches all GitHub Enterprise accounts (if GHES provider exists).
     *
     * @returns {Promise<Array<{id:string, label:string, provider:string, hasSession:boolean}>>}
     * @see Used by getAllData() → data.githubEnterprise
     */
    static async getGitHubEnterpriseAccounts() {
        const accounts = [];
        try {
            const gheAccounts = await vscode.authentication.getAccounts('github-enterprise');
            for (const account of gheAccounts) {
                accounts.push({ id: account.id, label: account.label, provider: 'github-enterprise', hasSession: false });
            }
        } catch (e) { /* GHE provider may not exist */ }
        return accounts;
    }

    /**
     * Reads MCP server configurations from .vscode/mcp.json, vscode/mcp.json,
     * workspace mcp.json, and user home .vscode/mcp.json files.
     * Strips JSONC comments while preserving URLs inside strings.
     *
     * @returns {Array<{name:string, type:string, command:string, args:string[], configPath:string, source:string}>}
     * @see Used by getAllMcpServers()
     */
    static getMcpServerConfigsFromFiles() {
        const servers = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const searchPaths = [];
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                searchPaths.push(path.join(folder.uri.fsPath, '.vscode', 'mcp.json'));
                searchPaths.push(path.join(folder.uri.fsPath, 'vscode', 'mcp.json'));
                searchPaths.push(path.join(folder.uri.fsPath, 'mcp.json'));
            }
        }
        const userHome = process.env.USERPROFILE || process.env.HOME;
        if (userHome) {
            searchPaths.push(path.join(userHome, '.vscode', 'mcp.json'));
        }
        for (const configPath of searchPaths) {
            try {
                if (fs.existsSync(configPath)) {
                    const raw = fs.readFileSync(configPath, 'utf8');
                    // Strip comments while preserving // inside quoted strings (e.g. URLs)
                    const cleaned = raw.replace(/("(?:[^"\\]|\\.)*")|(\/\/.*$)|(\/\*[\s\S]*?\*\/)/gm,
                        (match, str) => str ? str : '');
                    const config = JSON.parse(cleaned);
                    if (config.servers) {
                        for (const [name, serverConfig] of Object.entries(config.servers)) {
                            servers.push({
                                name, type: serverConfig.type || 'unknown',
                                command: serverConfig.command || '', args: serverConfig.args || [],
                                configPath, source: 'file', gallery: serverConfig.gallery || null
                            });
                        }
                    }
                }
            } catch (e) {
                console.log(`Could not parse MCP config at ${configPath}:`, e.message);
            }
        }
        return servers;
    }

    /**
     * Reads MCP server configurations from VS Code's mcp.servers setting.
     *
     * @returns {Array<{name:string, type:string, command:string, args:string[], configPath:string, source:string}>}
     * @see Used by getAllMcpServers()
     */
    static getMcpServerConfigsFromSettings() {
        const servers = [];
        try {
            const mcpConfig = vscode.workspace.getConfiguration('mcp');
            const settingsServers = mcpConfig.get('servers') || {};
            for (const [name, serverConfig] of Object.entries(settingsServers)) {
                if (serverConfig && typeof serverConfig === 'object') {
                    servers.push({
                        name, type: serverConfig.type || 'unknown',
                        command: serverConfig.command || '', args: serverConfig.args || [],
                        configPath: 'VS Code Settings (settings.json)',
                        source: 'settings', gallery: serverConfig.gallery || null
                    });
                }
            }
        } catch (e) {
            console.log('Could not read MCP servers from settings:', e.message);
        }
        return servers;
    }

    /**
     * Merges MCP server configs from files and settings, deduplicating by name.
     *
     * @returns {Array} Combined unique MCP server configurations
     * @see Used by getAllData() → data.mcpServers
     * @see Referenced in dashboardPanel.js (MCP Servers tab) and sidebarProvider.js
     */
    static getAllMcpServers() {
        try {
            const fileServers = this.getMcpServerConfigsFromFiles();
            const settingsServers = this.getMcpServerConfigsFromSettings();
            const seen = new Set();
            const all = [];
            for (const srv of [...fileServers, ...settingsServers]) {
                if (!seen.has(srv.name)) { seen.add(srv.name); all.push(srv); }
            }
            return all;
        } catch (e) {
            console.log('Could not get MCP servers:', e.message);
            return [];
        }
    }

    /**
     * Gets installation status, version, and active state of GitHub Copilot
     * and GitHub Copilot Chat extensions.
     *
     * @returns {{copilot:{installed:boolean, version:string|null, active:boolean}, copilotChat:{installed:boolean, version:string|null, active:boolean}}}
     * @see Used by getAllData() → data.copilot
     * @see Referenced in dashboardPanel.js (Copilot tab) and sidebarProvider.js
     */
    static getCopilotExtensionInfo() {
        try {
            const copilotExt = vscode.extensions.getExtension('GitHub.copilot');
            const copilotChatExt = vscode.extensions.getExtension('GitHub.copilot-chat');
            return {
                copilot: copilotExt ? {
                    installed: true, version: copilotExt.packageJSON.version,
                    active: copilotExt.isActive, extensionId: copilotExt.id
                } : { installed: false, version: null, active: false, extensionId: 'GitHub.copilot' },
                copilotChat: copilotChatExt ? {
                    installed: true, version: copilotChatExt.packageJSON.version,
                    active: copilotChatExt.isActive, extensionId: copilotChatExt.id
                } : { installed: false, version: null, active: false, extensionId: 'GitHub.copilot-chat' }
            };
        } catch (e) {
            console.log('Could not get Copilot extension info:', e.message);
            return {
                copilot: { installed: false, version: null, active: false, extensionId: 'GitHub.copilot' },
                copilotChat: { installed: false, version: null, active: false, extensionId: 'GitHub.copilot-chat' }
            };
        }
    }

    /**
     * Lists all available language models via vscode.lm.selectChatModels().
     * Includes maxInputTokens, maxOutputTokens, and keeps a _modelRef for countTokens().
     *
     * @returns {Promise<Array<{id:string, name:string, vendor:string, family:string, version:string, maxInputTokens:number, maxOutputTokens:number}>>}
     * @see Used by getAllData() → data.languageModels
     * @see Referenced in dashboardPanel.js (Models tab)
     */
    static async getLanguageModels() {
        const models = [];
        try {
            if (!vscode.lm || !vscode.lm.selectChatModels) return models;
            const allModels = await vscode.lm.selectChatModels();
            for (const model of allModels) {
                models.push({
                    id: model.id, name: model.name, vendor: model.vendor,
                    family: model.family, version: model.version,
                    maxInputTokens: model.maxInputTokens,
                    maxOutputTokens: model.maxOutputTokens || 0,
                    _modelRef: model // keep ref for countTokens
                });
            }
        } catch (e) {
            console.log('Could not fetch language models:', e.message);
        }
        return models;
    }

    /**
     * Lists all registered LM tools from vscode.lm.tools (MCP + extension tools).
     *
     * @returns {Array<{name:string, description:string, tags:string[], hasSchema:boolean}>}
     * @see Used by getAllData() → data.registeredTools
     * @see Referenced in dashboardPanel.js (MCP Servers tab - MCP tools list)
     */
    static getRegisteredTools() {
        const tools = [];
        try {
            const lmTools = (vscode.lm && vscode.lm.tools) || [];
            for (const tool of lmTools) {
                tools.push({
                    name: tool.name, description: tool.description || '',
                    tags: tool.tags || [], hasSchema: !!tool.inputSchema
                });
            }
        } catch (e) {
            console.log('Could not fetch LM tools:', e.message);
        }
        return tools;
    }

    /**
     * Reads real AI stats from VS Code workspace state.vscdb files.
     * These are the same stats shown in the status bar when editor.aiStats.enabled is true.
     * Each record has: startTime, typedCharacters, aiCharacters, acceptedInlineSuggestions, chatEditCount
     */
    /**
     * Reads real AI usage stats from VS Code workspace state.vscdb files.
     * Each record has: startTime, typedCharacters, aiCharacters,
     * acceptedInlineSuggestions, chatEditCount. Same data shown by editor.aiStats.enabled.
     *
     * @returns {Array<{startTime:number, date:string, typedCharacters:number, aiCharacters:number, acceptedInlineSuggestions:number, chatEditCount:number, workspace:string}>}
     * @see Used by getAllData() → data.aiStats
     * @see Referenced in dashboardPanel.js (Copilot tab charts, AI Stats tab)
     */
    static getAiStatsFromWorkspaceStorage() {
        const allRecords = [];
        // Use a Map keyed by startTime to deduplicate and keep the most complete record.
        // SQLite may keep old pages with stale copies that have lower character counts;
        // by keying on startTime alone and keeping the highest values, we always
        // use the most up-to-date snapshot of each session.
        const bestByStartTime = new Map();
        try {
            const userHome = process.env.APPDATA || process.env.HOME;
            if (!userHome) return allRecords;
            const wsStorageDir = path.join(userHome, 'Code', 'User', 'workspaceStorage');
            if (!fs.existsSync(wsStorageDir)) return allRecords;
            const folders = fs.readdirSync(wsStorageDir);
            // VS Code types acceptedInlineSuggestions and chatEditCount as `number | undefined`,
            // so JSON.stringify can omit them. Match the always-present prefix and parse the
            // (optional) trailing fields from a short tail by key name — order-independent.
            const recordPattern = /\{"startTime":(\d+),"typedCharacters":(\d+),"aiCharacters":(\d+)([^{}]{0,200})\}/g;
            for (const folder of folders) {
                const dbPath = path.join(wsStorageDir, folder, 'state.vscdb');
                if (!fs.existsSync(dbPath)) continue;
                try {
                    // VS Code opens state.vscdb in SQLite WAL mode. Recent writes (often
                    // the last several days of AI Stats sessions) live in state.vscdb-wal
                    // until SQLite checkpoints them. Scan both files so dedupe-by-startTime
                    // picks up the freshest copy of each session.
                    const walPath = dbPath + '-wal';
                    const sources = [dbPath];
                    if (fs.existsSync(walPath)) sources.push(walPath);

                    // Determine workspace name from workspace.json (once per folder)
                    let wsName = folder.substring(0, 8);
                    try {
                        const wsJsonPath = path.join(wsStorageDir, folder, 'workspace.json');
                        if (fs.existsSync(wsJsonPath)) {
                            const wsJson = JSON.parse(fs.readFileSync(wsJsonPath, 'utf8'));
                            if (wsJson.folder) {
                                wsName = path.basename(wsJson.folder.replace(/\\/g, '/'));
                            } else if (wsJson.workspace) {
                                wsName = path.basename(wsJson.workspace.replace(/\\/g, '/'));
                            }
                        }
                    } catch (e) { /* ignore */ }

                    let folderHasMarker = false;
                    for (const src of sources) {
                        try {
                            const fd = fs.openSync(src, 'r');
                            const buf = fs.readFileSync(src);
                            fs.closeSync(fd);
                            const str = buf.toString('latin1');
                            if (str.indexOf('"startTime":') === -1) continue;
                            folderHasMarker = true;

                            // Extract individual aiStats records using regex.
                            // SQLite/WAL pages interleave binary data with JSON, so we
                            // match each record individually rather than bracket-matching.
                            const cleaned = str.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
                            recordPattern.lastIndex = 0;
                            let recMatch;
                            while ((recMatch = recordPattern.exec(cleaned)) !== null) {
                                const st = parseInt(recMatch[1]);
                                const typed = parseInt(recMatch[2]);
                                const ai = parseInt(recMatch[3]);
                                const tail = recMatch[4] || '';
                                const suggMatch = tail.match(/"acceptedInlineSuggestions":(\d+)/);
                                const chatMatch = tail.match(/"chatEditCount":(\d+)/);
                                const sugg = suggMatch ? parseInt(suggMatch[1]) : 0;
                                const chatEdits = chatMatch ? parseInt(chatMatch[1]) : 0;
                                const totalChars = typed + ai;
                                const existing = bestByStartTime.get(st);
                                if (!existing || totalChars > existing._totalChars) {
                                    bestByStartTime.set(st, {
                                        startTime: st,
                                        date: (function(ts) { var d = new Date(ts); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })(st),
                                        typedCharacters: typed,
                                        aiCharacters: ai,
                                        acceptedInlineSuggestions: sugg,
                                        chatEditCount: chatEdits,
                                        workspace: wsName,
                                        _totalChars: totalChars
                                    });
                                }
                            }
                        } catch (e) {
                            // Skip unreadable source (locked WAL, etc.)
                        }
                    }
                    if (!folderHasMarker) continue;
                } catch (e) {
                    // Skip unreadable DB files
                }
            }
        } catch (e) {
            console.log('Could not read AI stats from workspace storage:', e.message);
        }

        // Collect deduplicated records, remove internal _totalChars field
        for (const record of bestByStartTime.values()) {
            const { _totalChars, ...clean } = record;
            allRecords.push(clean);
        }

        // Sort by startTime ascending
        allRecords.sort((a, b) => a.startTime - b.startTime);
        return allRecords;
    }

    /**
     * Reads all Copilot Chat session history from three sources:
     *  1. agentSessions.model.cache in workspace state.vscdb — agent/edit mode sessions
     *     with title, status, timing, changes, and session IDs
     *  2. chatSessions/*.json files — older chat panel sessions with full message history
     *  3. emptyWindowChatSessions/*.json — sessions started without a workspace
     *
     * @returns {Array<{sessionId:string, title:string, workspace:string, creationDate:number, lastMessageDate:number, messageCount:number, mode:string, model:string, initialLocation:string, source:string, status:number, providerType:string, description:string, changes:Object|null, messages:Array}>}
     * @see Used by getAllData() → data.chatSessions
     * @see Referenced in dashboardPanel.js (Chat Sessions tab)
     */
    static getChatSessionsFromWorkspaceStorage() {
        const allSessions = [];
        const seenIds = new Set();

        try {
            const userHome = process.env.APPDATA || process.env.HOME;
            if (!userHome) return allSessions;
            const wsStorageDir = path.join(userHome, 'Code', 'User', 'workspaceStorage');

            // ── Helper: resolve workspace name from folder ──
            const getWsName = (folderPath) => {
                let wsName = path.basename(folderPath).substring(0, 8);
                try {
                    const wsJsonPath = path.join(folderPath, 'workspace.json');
                    if (fs.existsSync(wsJsonPath)) {
                        const wsJson = JSON.parse(fs.readFileSync(wsJsonPath, 'utf8'));
                        if (wsJson.folder) wsName = decodeURIComponent(path.basename(wsJson.folder.replace(/\\/g, '/')));
                        else if (wsJson.workspace) wsName = decodeURIComponent(path.basename(wsJson.workspace.replace(/\\/g, '/')));
                    }
                } catch (e) { /* ignore */ }
                return wsName;
            };

            // ── Helper: extract messages from chatSessions JSON ──
            const extractMessages = (session) => {
                const messages = [];
                const requests = session.requests || [];
                for (const req of requests) {
                    const userText = req.message && req.message.text ? req.message.text : '';
                    if (userText) {
                        messages.push({
                            role: 'user',
                            text: userText.length > 500 ? userText.substring(0, 500) + '...' : userText,
                            timestamp: req.timestamp || 0,
                            modelId: req.modelId || ''
                        });
                    }
                    if (req.response && Array.isArray(req.response)) {
                        let respText = '';
                        for (const part of req.response) {
                            if (part.value && typeof part.value === 'string') respText += part.value;
                        }
                        if (respText) {
                            messages.push({
                                role: 'assistant',
                                text: respText.length > 500 ? respText.substring(0, 500) + '...' : respText,
                                timestamp: req.timestamp || 0,
                                modelId: req.modelId || ''
                            });
                        }
                    }
                }
                return messages;
            };

            // ── Helper: extract session data from JSONL files (new VS Code format) ──
            // JSONL uses incremental patches: kind=0 initial, kind=1 result (user prompts), kind=2 responses.
            const extractFromJsonl = (filePath) => {
                try {
                    const raw = fs.readFileSync(filePath, 'utf8');
                    const lines = raw.split('\n').filter(l => l.trim());
                    if (lines.length === 0) return null;
                    const initial = JSON.parse(lines[0]);
                    if (initial.kind !== 0 || !initial.v) return null;
                    const v = initial.v;

                    const userMap = {};  // reqIdx → { text, timestamp, modelId }
                    const responseMap = {}; // reqIdx → response text

                    // Source 1: Initial requests
                    const initialRequests = v.requests || [];
                    for (let i = 0; i < initialRequests.length; i++) {
                        const req = initialRequests[i];
                        const userText = req.message && req.message.text ? req.message.text : '';
                        if (userText) {
                            userMap[i] = { text: userText, timestamp: req.timestamp || 0, modelId: req.modelId || '' };
                        }
                    }

                    // Source 2 & 3: Scan incremental lines
                    for (let i = 1; i < lines.length; i++) {
                        try {
                            const obj = JSON.parse(lines[i]);
                            if (!Array.isArray(obj.k) || obj.k[0] !== 'requests') continue;

                            // kind=1 result lines — contain user prompt in renderedUserMessage
                            if (obj.kind === 1 && obj.k.length === 3 && obj.k[2] === 'result' && obj.v) {
                                const reqIdx = obj.k[1];
                                if (!userMap[reqIdx]) {
                                    const rendered = obj.v.metadata && obj.v.metadata.renderedUserMessage;
                                    if (rendered && Array.isArray(rendered) && rendered.length > 0) {
                                        let text = rendered[0].text || '';
                                        // Extract clean user prompt from <userRequest> tags
                                        const userReqMatch = text.match(/<userRequest>\s*([\s\S]*?)\s*<\/userRequest>/);
                                        if (userReqMatch) {
                                            text = userReqMatch[1].trim();
                                        }
                                        if (text) {
                                            userMap[reqIdx] = { text: text, timestamp: 0, modelId: '' };
                                        }
                                    }
                                }
                            }

                            // kind=2 response lines
                            if (obj.kind === 2 && obj.k.length === 3 && obj.k[2] === 'response' && Array.isArray(obj.v)) {
                                const reqIdx = obj.k[1];
                                let respText = '';
                                for (const part of obj.v) {
                                    if (part.value && typeof part.value === 'string') {
                                        const partKind = part.kind || '';
                                        if (partKind === '' || partKind === 'markdownVuln' || partKind === 'markdownContent') {
                                            respText += part.value;
                                        }
                                    }
                                }
                                if (respText) responseMap[reqIdx] = (responseMap[reqIdx] || '') + respText;
                            }

                            // kind=2 full requests array snapshot
                            if (obj.kind === 2 && obj.k.length === 1 && Array.isArray(obj.v)) {
                                for (let j = 0; j < obj.v.length; j++) {
                                    if (!userMap[j] && obj.v[j].message && obj.v[j].message.text) {
                                        userMap[j] = { text: obj.v[j].message.text, timestamp: obj.v[j].timestamp || 0, modelId: obj.v[j].modelId || '' };
                                    }
                                }
                            }
                        } catch (e) { /* skip */ }
                    }

                    // Build messages array (with 500-char cap for sidebar cache)
                    const messages = [];
                    const maxIdx = Math.max(
                        ...Object.keys(userMap).map(Number),
                        ...Object.keys(responseMap).map(Number),
                        -1
                    );
                    let totalUserCount = 0;
                    for (let i = 0; i <= maxIdx; i++) {
                        if (userMap[i] && userMap[i].text) {
                            totalUserCount++;
                            const t = userMap[i].text;
                            messages.push({
                                role: 'user',
                                text: t.length > 500 ? t.substring(0, 500) + '...' : t,
                                timestamp: userMap[i].timestamp,
                                modelId: userMap[i].modelId
                            });
                        }
                        if (responseMap[i]) {
                            const t = responseMap[i];
                            messages.push({
                                role: 'assistant',
                                text: t.length > 500 ? t.substring(0, 500) + '...' : t,
                                timestamp: (userMap[i] || {}).timestamp || 0,
                                modelId: (userMap[i] || {}).modelId || ''
                            });
                        }
                    }

                    // Extract metadata
                    const mode = v.inputState && v.inputState.mode ? v.inputState.mode : null;
                    let modeId = 'chat';
                    if (mode) {
                        if (typeof mode === 'object' && mode.id) modeId = mode.id;
                        else if (typeof mode === 'string') modeId = mode;
                    }
                    const selectedModel = v.inputState && v.inputState.selectedModel
                        ? (v.inputState.selectedModel.identifier || '') : '';

                    return {
                        sessionId: v.sessionId || '',
                        title: v.customTitle || (messages.length > 0 && messages[0].text ? messages[0].text.substring(0, 80) : ''),
                        creationDate: v.creationDate || 0,
                        lastMessageDate: v.lastMessageDate || v.creationDate || 0,
                        messageCount: totalUserCount,
                        mode: modeId,
                        model: selectedModel,
                        initialLocation: v.initialLocation || 'panel',
                        messages: messages
                    };
                } catch (e) { return null; }
            };

            // ══════════════════════════════════════════════════════════
            // Determine current workspace path to check if sessions are reopenable
            // Sessions can only be reopened in VS Code if they belong to the
            // currently active workspace.
            // ══════════════════════════════════════════════════════════
            let currentWsFolderUri = '';
            const wsFolders = vscode.workspace.workspaceFolders;
            if (wsFolders && wsFolders.length > 0) {
                currentWsFolderUri = wsFolders[0].uri.toString();
            }

            // ══════════════════════════════════════════════════════════
            // SOURCE 1: agentSessions.model.cache from state.vscdb
            //   These are agent/edit/ask mode sessions shown in the
            //   VS Code "Agent Sessions" view. Contains session name,
            //   status, timing, code changes, and session IDs.
            // ══════════════════════════════════════════════════════════
            if (fs.existsSync(wsStorageDir)) {
                const folders = fs.readdirSync(wsStorageDir).filter(f => {
                    try { return fs.statSync(path.join(wsStorageDir, f)).isDirectory(); } catch (e) { return false; }
                });
                for (const folder of folders) {
                    const folderPath = path.join(wsStorageDir, folder);
                    const dbPath = path.join(folderPath, 'state.vscdb');
                    if (!fs.existsSync(dbPath)) continue;

                    const wsName = getWsName(folderPath);

                    // Check if this workspace folder is the currently active one
                    let isCurrentWorkspace = false;
                    try {
                        const wsJsonPath = path.join(folderPath, 'workspace.json');
                        if (fs.existsSync(wsJsonPath)) {
                            const wsJsonContent = fs.readFileSync(wsJsonPath, 'utf8');
                            const wsJson = JSON.parse(wsJsonContent);
                            const folderUri = wsJson.folder || wsJson.workspace || '';
                            if (folderUri && currentWsFolderUri) {
                                isCurrentWorkspace = decodeURIComponent(folderUri).toLowerCase() === decodeURIComponent(currentWsFolderUri).toLowerCase();
                            }
                        }
                    } catch (e) { /* ignore */ }

                    try {
                        const fd = fs.openSync(dbPath, 'r');
                        const buf = fs.readFileSync(dbPath);
                        fs.closeSync(fd);
                        const str = buf.toString('latin1');

                        const key = 'agentSessions.model.cache';
                        if (str.indexOf(key) === -1) continue;

                        // Clean the full text for regex matching
                        const cleaned = str.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

                        // Match individual session objects using regex
                        // SQLite may store multiple copies across old/new pages.
                        // We collect ALL matches and keep the LAST one per session
                        // (highest offset = most recent DB page = latest data).
                        const pattern = /\{"providerType":"[^"]*","providerLabel":"[^"]*","resource":"([^"]*)","icon":"[^"]*","label":"([^"]*)"(?:,"description":"([^"]*)")?,"status":(\d+),"timing":\{([^}]*)\}(?:,"changes":\{([^}]*)\})?\}/g;
                        const sessionMap = new Map(); // dedupeKey → parsed data
                        let match;
                        while ((match = pattern.exec(cleaned)) !== null) {
                            try {
                                const resource = match[1];
                                const label = match[2];
                                const description = match[3] || '';
                                const statusNum = parseInt(match[4]);
                                const timingStr = match[5];
                                const changesStr = match[6] || '';

                                // Decode session ID from base64 in resource URI
                                let sessionId = '';
                                const b64Match = resource.match(/vscode-chat-session:\/\/local\/(.+)/);
                                if (b64Match) {
                                    try { sessionId = Buffer.from(b64Match[1], 'base64').toString('utf8'); } catch (e) { sessionId = b64Match[1]; }
                                }

                                const dedupeKey = sessionId || label;

                                // Parse timing
                                let created = 0, lastStarted = 0, lastEnded = 0;
                                const createdMatch = timingStr.match(/"created":(\d+)/);
                                const startMatch = timingStr.match(/"lastRequestStarted":(\d+)/);
                                const endMatch = timingStr.match(/"lastRequestEnded":(\d+)/);
                                if (createdMatch) created = parseInt(createdMatch[1]);
                                if (startMatch) lastStarted = parseInt(startMatch[1]);
                                if (endMatch) lastEnded = parseInt(endMatch[1]);

                                // Parse changes
                                let changes = null;
                                if (changesStr) {
                                    const filesMatch = changesStr.match(/"files":(\d+)/);
                                    const insMatch = changesStr.match(/"insertions":(\d+)/);
                                    const delMatch = changesStr.match(/"deletions":(\d+)/);
                                    changes = {
                                        files: filesMatch ? parseInt(filesMatch[1]) : 0,
                                        insertions: insMatch ? parseInt(insMatch[1]) : 0,
                                        deletions: delMatch ? parseInt(delMatch[1]) : 0
                                    };
                                }

                                // Always overwrite — last match wins (most recent DB page)
                                sessionMap.set(dedupeKey, {
                                    sessionId, label, description, statusNum,
                                    created, lastStarted, lastEnded, changes
                                });
                            } catch (e) { /* skip bad match */ }
                        }

                        // Status: 1=completed, 2=active/running, 3=stopped/cancelled
                        const statusMap = { 1: 'completed', 2: 'active', 3: 'stopped' };

                        // Now process deduplicated sessions
                        for (const [dedupeKey, sess] of sessionMap) {
                            if (seenIds.has(dedupeKey)) continue;
                            seenIds.add(dedupeKey);

                            const { sessionId, label, description, statusNum, created, lastStarted, lastEnded, changes } = sess;
                            try {

                                // Read chatEditingSessions state.json for summary data
                                let editSummary = null;
                                // Sessions can be reopened if they have a chatEditingSessions
                                // directory. They can only ACTUALLY be reopened from their
                                // original workspace (UI handles this).
                                let canReopen = false;
                                if (sessionId) {
                                    const editStateDir = path.join(folderPath, 'chatEditingSessions', sessionId);
                                    if (fs.existsSync(editStateDir)) {
                                        canReopen = true;
                                        const editStatePath = path.join(editStateDir, 'state.json');
                                        try {
                                            if (fs.existsSync(editStatePath)) {
                                                // Read state.json for summary data
                                                const editRaw = fs.readFileSync(editStatePath, 'utf8');
                                                const editData = JSON.parse(editRaw);
                                                const checkpoints = (editData.timeline && editData.timeline.checkpoints) || [];
                                                const operations = (editData.timeline && editData.timeline.operations) || [];
                                                const initFiles = editData.initialFileContents || [];
                                                // Get unique files from initialFileContents and operations
                                                const filesSet = new Set();
                                                for (const f of initFiles) {
                                                    if (f[0]) {
                                                        try { filesSet.add(decodeURIComponent(f[0].replace(/file:\/\/\/[a-zA-Z]%3A/,'').split('/').pop())); } catch(e) { filesSet.add(f[0]); }
                                                    }
                                                }
                                                for (const op of operations) {
                                                    if (op.uri) {
                                                        try { filesSet.add(decodeURIComponent(op.uri.replace(/file:\/\/\/[a-zA-Z]%3A/,'').split('/').pop())); } catch(e) {}
                                                    }
                                                }
                                                // Count unique request IDs from checkpoints (excluding Initial State)
                                                const requestIds = new Set();
                                                for (const cp of checkpoints) {
                                                    if (cp.requestId) requestIds.add(cp.requestId);
                                                }
                                                editSummary = {
                                                    requestCount: requestIds.size,
                                                    checkpointCount: checkpoints.length,
                                                    operationCount: operations.length,
                                                    filesEdited: Array.from(filesSet).slice(0, 10),
                                                    totalEpochs: editData.timeline ? editData.timeline.currentEpoch : 0
                                                };
                                            }
                                        } catch (e) { /* skip */ }
                                    }
                                }

                                allSessions.push({
                                    sessionId: sessionId,
                                    title: label,
                                    workspace: wsName,
                                    creationDate: created,
                                    lastMessageDate: lastEnded || lastStarted || created,
                                    messageCount: editSummary ? editSummary.requestCount : 0,
                                    mode: 'agent',
                                    chatType: 'agent',
                                    agentName: '',
                                    model: '',
                                    initialLocation: 'panel',
                                    source: 'agentSession',
                                    status: statusNum,
                                    statusLabel: statusMap[statusNum] || 'unknown',
                                    providerType: 'local',
                                    description: description,
                                    changes: changes,
                                    canReopen: canReopen,
                                    isCurrentWorkspace: isCurrentWorkspace,
                                    editSummary: editSummary,
                                    messages: []
                                });
                            } catch (e) { /* skip bad match */ }
                        }
                    } catch (e) { /* skip unreadable DB */ }

                    // ══════════════════════════════════════════════════════════
                    // SOURCE 2: chatSessions/*.json and *.jsonl — chat panel sessions
                    // ══════════════════════════════════════════════════════════
                    const chatDir = path.join(folderPath, 'chatSessions');
                    if (fs.existsSync(chatDir)) {
                        // Process .json files (legacy format)
                        let jsonFiles;
                        try { jsonFiles = fs.readdirSync(chatDir).filter(f => f.endsWith('.json')); } catch (e) { jsonFiles = []; }
                        for (const file of jsonFiles) {
                            try {
                                const filePath = path.join(chatDir, file);
                                const raw = fs.readFileSync(filePath, 'utf8');
                                const session = JSON.parse(raw);
                                const sid = session.sessionId || file.replace('.json', '');
                                // If this session already exists (from SOURCE 1 agent sessions),
                                // merge conversation messages into it instead of skipping
                                if (seenIds.has(sid)) {
                                    const existingSession = allSessions.find(s => s.sessionId === sid);
                                    if (existingSession && (!existingSession.messages || existingSession.messages.length === 0)) {
                                        const mergedMessages = extractMessages(session);
                                        if (mergedMessages.length > 0) {
                                            existingSession.messages = mergedMessages;
                                            if (!existingSession.messageCount) existingSession.messageCount = mergedMessages.filter(m => m.role === 'user').length;
                                            if (!existingSession.model && session.selectedModel) existingSession.model = session.selectedModel;
                                        }
                                    }
                                    continue;
                                }
                                seenIds.add(sid);

                                const messages = extractMessages(session);
                                const title = session.customTitle || (messages.length > 0 && messages[0].text ? messages[0].text.substring(0, 80) : '');

                                // Normalize mode: can be object {id:"agent"} or string or null
                                let modeId = 'chat';
                                if (session.mode) {
                                    if (typeof session.mode === 'object' && session.mode.id) modeId = session.mode.id;
                                    else if (typeof session.mode === 'string') modeId = session.mode;
                                }

                                // Detect custom agent participant (e.g. @powerpages)
                                let agentName = '';
                                const requests = session.requests || [];
                                for (const req of requests) {
                                    if (req.agent) {
                                        if (typeof req.agent === 'string') { agentName = req.agent; break; }
                                        if (typeof req.agent === 'object' && req.agent.name) { agentName = req.agent.name; break; }
                                    }
                                    // Check for @agent in message text
                                    if (!agentName && req.message && req.message.text) {
                                        const agentMatch = req.message.text.match(/^@(\w+)/);
                                        if (agentMatch && agentMatch[1] !== 'workspace') { agentName = agentMatch[1]; break; }
                                    }
                                }
                                // If agent participant is "agent" (default copilot), don't treat as custom
                                if (agentName === 'agent') agentName = '';

                                // Determine chatType for filtering
                                let chatType = modeId; // 'agent', 'ask', 'chat', etc.
                                if (agentName) chatType = 'custom-agent';

                                allSessions.push({
                                    sessionId: sid,
                                    title: title,
                                    workspace: wsName,
                                    creationDate: session.creationDate || 0,
                                    lastMessageDate: session.lastMessageDate || 0,
                                    messageCount: requests.length,
                                    mode: modeId,
                                    chatType: chatType,
                                    agentName: agentName,
                                    model: session.selectedModel || '',
                                    initialLocation: session.initialLocation || 'panel',
                                    source: 'chatSession',
                                    status: 1,
                                    statusLabel: 'completed',
                                    providerType: 'local',
                                    description: '',
                                    changes: null,
                                    canReopen: false,
                                    editSummary: null,
                                    messages: messages
                                });
                            } catch (e) { /* skip */ }
                        }

                        // Process .jsonl files (new format)
                        let jsonlFiles;
                        try { jsonlFiles = fs.readdirSync(chatDir).filter(f => f.endsWith('.jsonl')); } catch (e) { jsonlFiles = []; }
                        for (const file of jsonlFiles) {
                            try {
                                const filePath = path.join(chatDir, file);
                                const parsed = extractFromJsonl(filePath);
                                if (!parsed || !parsed.sessionId) continue;
                                const sid = parsed.sessionId;

                                // If this session already exists (from SOURCE 1), merge messages
                                if (seenIds.has(sid)) {
                                    const existingSession = allSessions.find(s => s.sessionId === sid);
                                    if (existingSession && (!existingSession.messages || existingSession.messages.length === 0)) {
                                        if (parsed.messages.length > 0) {
                                            existingSession.messages = parsed.messages;
                                            if (!existingSession.messageCount) existingSession.messageCount = parsed.messageCount;
                                            if (!existingSession.model && parsed.model) existingSession.model = parsed.model;
                                        }
                                    }
                                    continue;
                                }
                                seenIds.add(sid);

                                let chatType = parsed.mode;
                                allSessions.push({
                                    sessionId: sid,
                                    title: parsed.title,
                                    workspace: wsName,
                                    creationDate: parsed.creationDate,
                                    lastMessageDate: parsed.lastMessageDate,
                                    messageCount: parsed.messageCount,
                                    mode: parsed.mode,
                                    chatType: chatType,
                                    agentName: '',
                                    model: parsed.model,
                                    initialLocation: parsed.initialLocation,
                                    source: 'chatSession',
                                    status: 1,
                                    statusLabel: 'completed',
                                    providerType: 'local',
                                    description: '',
                                    changes: null,
                                    canReopen: false,
                                    isCurrentWorkspace: isCurrentWorkspace,
                                    editSummary: null,
                                    messages: parsed.messages
                                });
                            } catch (e) { /* skip */ }
                        }
                    }
                }
            }

            // ══════════════════════════════════════════════════════════
            // SOURCE 3: emptyWindowChatSessions — global sessions
            //   without a workspace (opened in empty VS Code window)
            // ══════════════════════════════════════════════════════════
            const emptyDir = path.join(userHome, 'Code', 'User', 'globalStorage', 'emptyWindowChatSessions');
            if (fs.existsSync(emptyDir)) {
                let files;
                try { files = fs.readdirSync(emptyDir).filter(f => f.endsWith('.json')); } catch (e) { files = []; }
                for (const file of files) {
                    try {
                        const filePath = path.join(emptyDir, file);
                        const raw = fs.readFileSync(filePath, 'utf8');
                        const session = JSON.parse(raw);
                        const sid = session.sessionId || file.replace('.json', '');
                        if (seenIds.has(sid)) continue;
                        seenIds.add(sid);

                        const messages = extractMessages(session);
                        const title = session.customTitle || (messages.length > 0 && messages[0].text ? messages[0].text.substring(0, 80) : '');

                        // Normalize mode
                        let modeId = 'chat';
                        if (session.mode) {
                            if (typeof session.mode === 'object' && session.mode.id) modeId = session.mode.id;
                            else if (typeof session.mode === 'string') modeId = session.mode;
                        }
                        let agentName = '';
                        const reqs = session.requests || [];
                        for (const req of reqs) {
                            if (req.agent) {
                                if (typeof req.agent === 'string') { agentName = req.agent; break; }
                                if (typeof req.agent === 'object' && req.agent.name) { agentName = req.agent.name; break; }
                            }
                            if (!agentName && req.message && req.message.text) {
                                const am = req.message.text.match(/^@(\w+)/);
                                if (am && am[1] !== 'workspace') { agentName = am[1]; break; }
                            }
                        }
                        if (agentName === 'agent') agentName = '';
                        let chatType = modeId;
                        if (agentName) chatType = 'custom-agent';

                        allSessions.push({
                            sessionId: sid,
                            title: title,
                            workspace: '(No Workspace)',
                            creationDate: session.creationDate || 0,
                            lastMessageDate: session.lastMessageDate || 0,
                            messageCount: reqs.length,
                            mode: modeId,
                            chatType: chatType,
                            agentName: agentName,
                            model: session.selectedModel || '',
                            initialLocation: session.initialLocation || 'panel',
                            source: 'emptyWindow',
                            status: 1,
                            statusLabel: 'completed',
                            providerType: 'local',
                            description: '',
                            changes: null,
                            canReopen: false,
                            editSummary: null,
                            messages: messages
                        });
                    } catch (e) { /* skip */ }
                }

                // Process .jsonl files in emptyWindowChatSessions
                let jsonlFiles;
                try { jsonlFiles = fs.readdirSync(emptyDir).filter(f => f.endsWith('.jsonl')); } catch (e) { jsonlFiles = []; }
                for (const file of jsonlFiles) {
                    try {
                        const filePath = path.join(emptyDir, file);
                        const parsed = extractFromJsonl(filePath);
                        if (!parsed || !parsed.sessionId) continue;
                        const sid = parsed.sessionId;
                        if (seenIds.has(sid)) continue;
                        seenIds.add(sid);

                        allSessions.push({
                            sessionId: sid,
                            title: parsed.title,
                            workspace: '(No Workspace)',
                            creationDate: parsed.creationDate,
                            lastMessageDate: parsed.lastMessageDate,
                            messageCount: parsed.messageCount,
                            mode: parsed.mode,
                            chatType: parsed.mode,
                            agentName: '',
                            model: parsed.model,
                            initialLocation: parsed.initialLocation,
                            source: 'emptyWindow',
                            status: 1,
                            statusLabel: 'completed',
                            providerType: 'local',
                            description: '',
                            changes: null,
                            canReopen: false,
                            editSummary: null,
                            messages: parsed.messages
                        });
                    } catch (e) { /* skip */ }
                }
            }
        } catch (e) {
            console.log('Could not read chat sessions from workspace storage:', e.message);
        }

        // Sort by lastMessageDate descending (newest first)
        allSessions.sort((a, b) => (b.lastMessageDate || b.creationDate) - (a.lastMessageDate || a.creationDate));
        return allSessions;
    }

    /**
     * Gets current workspace name and folder information.
     *
     * @returns {{name:string, folders:Array<{name:string, path:string}>, totalFolders:number}}
     * @see Used by getAllData() → data.workspace
     */
    static getWorkspaceInfo() {
        try {
            const folders = vscode.workspace.workspaceFolders || [];
            return {
                name: vscode.workspace.name || 'Untitled',
                folders: folders.map(f => ({ name: f.name, path: f.uri.fsPath })),
                totalFolders: folders.length
            };
        } catch (e) {
            console.log('Could not get workspace info:', e.message);
            return { name: 'Untitled', folders: [], totalFolders: 0 };
        }
    }

    /**
     * Computes system readiness status based on accounts, extensions, and models.
     *
     * @param {Object} data - The aggregated data object from getAllData()
     * @returns {{status:string, issues:string[], hasGithub:boolean, hasCopilot:boolean, ...}}
     * @see Used by getAllData() → data.readiness
     */
    static computeReadiness(data) {
        try {
            const hasGithub = (data.github || []).length > 0;
            const hasGithubSession = (data.github || []).some(a => a.hasSession);
            const hasMicrosoft = (data.microsoft || []).length > 0;
            const hasCopilot = data.copilot && data.copilot.copilot && data.copilot.copilot.installed;
            const hasCopilotChat = data.copilot && data.copilot.copilotChat && data.copilot.copilotChat.installed;
            const hasCopilotActive = data.copilot && data.copilot.copilot && data.copilot.copilot.active;
            const hasCopilotChatActive = data.copilot && data.copilot.copilotChat && data.copilot.copilotChat.active;
            const hasMcpServers = (data.mcpServers || []).length > 0;
            const hasModels = (data.languageModels || []).length > 0;

        const issues = [];
        if (!hasGithub) issues.push('No GitHub account linked — sign in to use Copilot');
        if (hasGithub && !hasGithubSession) issues.push('GitHub account found but no active session');
        if (!hasCopilot) issues.push('GitHub Copilot extension is not installed');
        if (!hasCopilotChat) issues.push('GitHub Copilot Chat extension is not installed');
        if (hasCopilot && !hasCopilotActive) issues.push('GitHub Copilot extension is installed but not active');
        if (hasCopilotChat && !hasCopilotChatActive) issues.push('Copilot Chat is installed but not active');
        if (!hasMicrosoft && hasMcpServers) issues.push('MCP servers configured but no Microsoft account linked');
        if (!hasModels) issues.push('No language models available — Copilot may not be signed in');

        return {
            status: issues.length === 0 ? 'ready' : issues.length <= 2 ? 'warning' : 'error',
            hasGithub, hasGithubSession, hasMicrosoft, hasCopilot, hasCopilotChat,
            hasCopilotActive, hasCopilotChatActive, hasMcpServers, hasModels, issues
        };
        } catch (e) {
            console.log('Could not compute readiness:', e.message);
            return { status: 'error', issues: ['Readiness check failed: ' + e.message], hasGithub: false, hasGithubSession: false, hasMicrosoft: false, hasCopilot: false, hasCopilotChat: false, hasCopilotActive: false, hasCopilotChatActive: false, hasMcpServers: false, hasModels: false };
        }
    }

    /**
     * Main aggregation method — fetches ALL data from all sources in parallel.
     * Returns a single object consumed by dashboardPanel.js and sidebarProvider.js.
     *
     * @returns {Promise<Object>} Complete dashboard data object
     * @see Called by DashboardPanel._update() and SidebarProvider._updateContent()
     */
    static async getAllData() {
        // Clear file content caches so this refresh cycle gets fresh data.
        // All state DB reads within this cycle will share one consistent snapshot.
        this._clearCache();

        const trustedExtensions = this.getAccountTrustedExtensions();
        const activeCopilotAccount = this.getActiveCopilotAccount();
        const [githubAccounts, microsoftAccounts, gheAccounts, languageModels, activeGitHubAccount] = await Promise.all([
            this.getGitHubAccounts(), this.getMicrosoftAccounts(),
            this.getGitHubEnterpriseAccounts(), this.getLanguageModels(),
            this.getActiveGitHubAccount()
        ]);
        const contextAnalysis = await this.getContextAnalysis(languageModels);
        const data = {
            github: githubAccounts, microsoft: microsoftAccounts,
            githubEnterprise: gheAccounts, activeGitHubAccount: activeGitHubAccount,
            activeCopilotAccount: activeCopilotAccount,
            trustedExtensions: trustedExtensions,
            mcpServers: this.getAllMcpServers(),
            copilot: this.getCopilotExtensionInfo(), languageModels: languageModels.map(m => { const { _modelRef, ...rest } = m; return rest; }),
            registeredTools: this.getRegisteredTools(),
            workspace: this.getWorkspaceInfo(),
            aiStats: this.getAiStatsFromWorkspaceStorage(),
            aiStatsEnabled: !!vscode.workspace.getConfiguration('editor').get('aiStats.enabled'),
            chatSessions: this.getChatSessionsFromWorkspaceStorage(),
            contextAnalysis,
            timestamp: new Date().toISOString()
        };
        data.readiness = this.computeReadiness(data);
        return data;
    }

    /**
     * Computes live context window analysis for each model.
     * Uses countTokens() to get real token counts for tool definitions.
     * Reads thinking budget from VS Code settings.
     */
    /**
     * Computes context window token analysis for each language model.
     * Uses countTokens() to measure real tool definition token costs.
     * Reads thinking budget from VS Code settings.
     *
     * @param {Array} models - Language models from getLanguageModels() (with _modelRef)
     * @returns {Promise<Array<{modelName:string, maxInputTokens:number, maxOutputTokens:number, thinkingBudgetTokens:number, totalAllocation:number, toolCount:number, segments:Object}>>}
     * @see Used by getAllData() → data.contextAnalysis
     */
    static async getContextAnalysis(models) {
        const results = [];
        try {
            // Read thinking budget from settings
            const copilotConfig = vscode.workspace.getConfiguration('github.copilot.chat.anthropic.thinking');
            const thinkingBudgetTokens = copilotConfig.get('budgetTokens') || 0;

            // Get all registered tools
            const tools = (vscode.lm && vscode.lm.tools) || [];

            // Serialize all tool definitions for token counting
            const toolDefsText = tools.map(t => {
                return JSON.stringify({
                    name: t.name,
                    description: t.description || '',
                    inputSchema: t.inputSchema || {}
                });
            }).join('\n');

            // Get workspace files info for estimating file context
            const workspaceFolders = vscode.workspace.workspaceFolders || [];
            let openEditorCount = 0;
            try {
                // Count visible/open editors
                const tabGroups = vscode.window.tabGroups;
                if (tabGroups) {
                    for (const group of tabGroups.all) {
                        openEditorCount += group.tabs.length;
                    }
                }
            } catch (e) { /* tab API may not be available */ }

            for (const model of models) {
                if (!model._modelRef || !model.maxInputTokens) continue;
                const ref = model._modelRef;
                const analysis = {
                    modelName: model.name || model.family,
                    modelId: model.id,
                    vendor: model.vendor,
                    family: model.family,
                    maxInputTokens: model.maxInputTokens,
                    maxOutputTokens: model.maxOutputTokens || 0,
                    thinkingBudgetTokens: thinkingBudgetTokens,
                    totalAllocation: model.maxInputTokens + (model.maxOutputTokens || 0) + thinkingBudgetTokens,
                    toolDefinitionsTokens: 0,
                    toolCount: tools.length,
                    openEditors: openEditorCount,
                    segments: {}
                };

                // Use countTokens to get real tool definition token count
                try {
                    if (ref.countTokens && toolDefsText.length > 0) {
                        analysis.toolDefinitionsTokens = await ref.countTokens(toolDefsText);
                    }
                } catch (e) {
                    // countTokens not available — leave as 0
                    analysis.toolDefinitionsTokens = 0;
                }

                // Only real data — tool definition tokens counted by model tokenizer
                const toolDefPct = model.maxInputTokens > 0 ? (analysis.toolDefinitionsTokens / model.maxInputTokens * 100) : 0;

                analysis.segments = {
                    toolDefinitions: { tokens: analysis.toolDefinitionsTokens, pct: parseFloat(toolDefPct.toFixed(1)), label: 'Tool Definitions' }
                };

                results.push(analysis);
            }
        } catch (e) {
            console.log('Could not compute context analysis:', e.message);
        }
        return results;
    }
}

module.exports = { AccountDataFetcher };
