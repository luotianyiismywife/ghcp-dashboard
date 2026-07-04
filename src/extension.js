/*
 * ----------------------------------------------------------------------------
 * Author      : Jadhav Shubhamm
 * Role        : AI Developer
 * Created On  : 27-Feb-2026
 * Description : Extension entry point for the GHCP Account & Usage Dashboard.
 *               Registers the sidebar webview provider, dashboard panel
 *               commands, account switching, and auth change listeners.
 *
 *   Functions:
 *     activate()   - Called when the extension is activated. Registers:
 *                     - Sidebar webview provider (ghcpDashboard.sidebarView)
 *                     - Command: ghcpDashboard.open (open full dashboard)
 *                     - Command: ghcpDashboard.refresh (refresh all data)
 *                     - Command: ghcpDashboard.switchAccount (account picker)
 *                     - Auth session change listener (auto-refresh)
 *     deactivate() - Called when the extension is deactivated
 *
 * \u00a9 2026 All rights reserved.
 * ----------------------------------------------------------------------------
 */
const vscode = require('vscode');
const { SidebarProvider } = require('./sidebarProvider');
const { DashboardPanel } = require('./dashboardPanel');

/**
 * @param {vscode.ExtensionContext} context
 */
/**
 * Activates the GHCP Dashboard extension.
 * Registers sidebar provider, commands, and auth change listener.
 *
 * @param {vscode.ExtensionContext} context - The extension context provided by VS Code
 * @see Called automatically by VS Code when extension activates
 */
function activate(context) {
    try {
    console.log('GitHub Copilot Insights Dashboard extension activated');

    // Register sidebar webview provider
    const sidebarProvider = new SidebarProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'ghcpDashboard.sidebarView',
            sidebarProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // Command: Open full dashboard panel
    context.subscriptions.push(
        vscode.commands.registerCommand('ghcpDashboard.open', () => {
            try { DashboardPanel.createOrShow(context.extensionUri, context); } catch (e) { console.error('GHCP: Failed to open dashboard', e); vscode.window.showErrorMessage(vscode.l10n.t('GHCP Dashboard: Failed to open. ') + e.message); }
        })
    );

    // Command: Refresh data
    context.subscriptions.push(
        vscode.commands.registerCommand('ghcpDashboard.refresh', () => {
            try {
                sidebarProvider.refresh();
                if (DashboardPanel.currentPanel) {
                    DashboardPanel.currentPanel.refresh();
                }
                vscode.window.showInformationMessage(vscode.l10n.t('GHCP Dashboard: Account data refreshed'));
            } catch (e) { console.error('GHCP: Refresh failed', e); }
        })
    );

    // Command: Switch account (quick pick)
    context.subscriptions.push(
        vscode.commands.registerCommand('ghcpDashboard.switchAccount', async () => {
            const items = [
                { label: vscode.l10n.t('$(github) Sign out of GitHub'), description: vscode.l10n.t('Sign out and re-authenticate with a different GitHub account'), action: 'github-signout' },
                { label: vscode.l10n.t('$(account) Sign out of Microsoft'), description: vscode.l10n.t('Sign out of Microsoft account used for MCP servers'), action: 'ms-signout' },
                { label: vscode.l10n.t('$(sign-in) Sign in to GitHub'), description: vscode.l10n.t('Sign in with a GitHub account'), action: 'github-signin' },
                { label: vscode.l10n.t('$(key) Manage Accounts...'), description: vscode.l10n.t('Open VS Code account management'), action: 'manage' }
            ];

            const selection = await vscode.window.showQuickPick(items, {
                placeHolder: vscode.l10n.t('Switch or manage accounts for GitHub Copilot and MCP servers')
            });

            if (!selection) return;

            switch (selection.action) {
                case 'github-signout':
                    try { await vscode.commands.executeCommand('github.copilot.signOut'); } catch (e) { console.log('GHCP: signOut command not available', e.message); }
                    break;
                case 'ms-signout':
                    try { await vscode.commands.executeCommand('workbench.action.accounts.show'); } catch (e) { /* ignore */ }
                    break;
                case 'github-signin':
                    // Trigger a session request which will prompt sign-in
                    try {
                        await vscode.authentication.getSession('github', ['user:email'], { createIfNone: true });
                        vscode.window.showInformationMessage(vscode.l10n.t('GitHub account connected!'));
                    } catch (e) {
                        // User cancelled
                    }
                    break;
                case 'manage':
                    await vscode.commands.executeCommand('workbench.action.accounts.show');
                    break;
            }
        })
    );

    // Status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = vscode.l10n.t('$(github) GHCP');
    statusBarItem.tooltip = vscode.l10n.t('Open GitHub Copilot Insights Dashboard');
    statusBarItem.command = 'ghcpDashboard.open';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Listen for account changes
    context.subscriptions.push(
        vscode.authentication.onDidChangeSessions((e) => {
            try {
                console.log('Auth sessions changed:', e.provider.id);
                sidebarProvider.refresh();
                if (DashboardPanel.currentPanel) {
                    DashboardPanel.currentPanel.refresh();
                }
            } catch (err) { console.error('GHCP: Auth change handler error', err); }
        })
    );

    } catch (e) {
        console.error('GHCP Dashboard: Failed to activate extension', e);
        vscode.window.showErrorMessage(vscode.l10n.t('GHCP Dashboard failed to activate: ') + e.message);
    }
}

/**
 * Deactivates the extension. No cleanup required.
 */
function deactivate() {}

module.exports = { activate, deactivate };
