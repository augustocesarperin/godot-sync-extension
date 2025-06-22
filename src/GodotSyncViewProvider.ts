import * as vscode from 'vscode';
import { SyncService } from './SyncService';

const SOURCE_DIR_KEY = 'godotSync.sourceDir';
const TARGET_DIR_KEY = 'godotSync.targetDir';
const EXTENSIONS_KEY = 'godotSync.extensions';
const ALLOW_DELETION_KEY = 'godotSync.allowDeletion';
const LOG_FILE_KEY = 'godotSync.log';
const INCLUDE_HIDDEN_KEY = 'godotSync.includeHidden';
const USE_POLLING_KEY = 'godotSync.usePolling';
const SYNC_IMPORT_FILES_KEY = 'godotSync.syncImportFiles';
const FIRST_SEEN_VERSION_KEY = 'godotSync.firstSeenVersion';
const PRESET_KEY = 'godotSync.preset';

export class GodotSyncViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'godotSyncView';

    private _view?: vscode.WebviewView;
    private syncService: SyncService;
    private context: vscode.ExtensionContext;
    private logBuffer: string[] = [];
    private readonly maxLogLines = 200;

    constructor(private readonly _extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this.context = context;
        this.initializeFirstSeenVersion();
        this.syncService = new SyncService(
            (message) => this.logMessage(message),
            (isRunning) => this.updateStatus(isRunning)
        );
        this.logBuffer = this.context.workspaceState.get<string[]>(LOG_FILE_KEY, []);
    }

    private initializeFirstSeenVersion() {
        const firstSeen = this.context.globalState.get<string>(FIRST_SEEN_VERSION_KEY);
        if (!firstSeen) {
            const current = this.getExtensionVersion();
            this.context.globalState.update(FIRST_SEEN_VERSION_KEY, current);
            // migration default for syncImportFiles: ON for new installs
            this.context.workspaceState.update(SYNC_IMPORT_FILES_KEY, true);
        }
    }

    private getExtensionVersion(): string {
        const ext = vscode.extensions.getExtension('AbstratusLabs.godot-sync');
        const version = (ext && (ext as any).packageJSON && (ext as any).packageJSON.version) || '0.0.0';
        return version;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext<unknown>,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'out', 'webview'),
                vscode.Uri.joinPath(this._extensionUri, 'out')
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'webviewLoaded':
                    this.sendInitialConfig();
                    break;
                case 'selectSourceFolder':
                    this.selectFolder(SOURCE_DIR_KEY, 'updateSourceDir');
                    break;
                case 'selectTargetFolder':
                    this.selectFolder(TARGET_DIR_KEY, 'updateTargetDir');
                    break;
                case 'updateExtensions':
                    this.updateExtensions(message.data);
                    break;
                case 'updateAllowDeletion':
                    this.context.workspaceState.update(ALLOW_DELETION_KEY, message.data);
                    break;
                case 'startSync':
                    this.startSync();
                    break;
                case 'stopSync':
                    this.syncService.stop();
                    break;
                case 'updateIncludeHidden':
                    this.context.workspaceState.update(INCLUDE_HIDDEN_KEY, message.data);
                    break;
                case 'updateUsePolling':
                    this.context.workspaceState.update(USE_POLLING_KEY, message.data);
                    break;
                case 'updateSyncImportFiles':
                    this.context.workspaceState.update(SYNC_IMPORT_FILES_KEY, message.data);
                    break;
                case 'updatePreset':
                    this.context.workspaceState.update(PRESET_KEY, message.data);
                    break;
                case 'clearLog':
                    this.clearLog();
                    break;
            }
        });

        webviewView.onDidDispose(() => {
            this._view = undefined;
        });

        this.updateStatus(this.syncService.getIsRunning());
    }

    private sendInitialConfig() {
        if (this._view) {
            const sourceDir = this.context.workspaceState.get<string>(SOURCE_DIR_KEY);
            const targetDir = this.context.workspaceState.get<string>(TARGET_DIR_KEY);
            const extensions = this.context.workspaceState.get<string>(EXTENSIONS_KEY, '.gd, .tscn, .tres, .res, .import, .shader, .json, .cfg');
            const allowDeletion = this.context.workspaceState.get<boolean>(ALLOW_DELETION_KEY, false);
            const includeHidden = this.context.workspaceState.get<boolean>(INCLUDE_HIDDEN_KEY, false);
            const usePolling = this.context.workspaceState.get<boolean>(USE_POLLING_KEY, false);
            const syncImportFiles = this.getSyncImportFilesDefault();
            const preset = this.context.workspaceState.get<string>(PRESET_KEY, 'none');
            const isRunning = this.syncService.getIsRunning();
            const logContent = this.logBuffer.join('\n');
            const envHint = this.getEnvHint();

            this._view.webview.postMessage({
                command: 'updateConfig',
                data: { sourceDir, targetDir, extensions, allowDeletion, includeHidden, usePolling, syncImportFiles, preset, isRunning, logContent, envHint }
            });
        }
    }

    private getEnvHint(): { remoteName?: string, isUNC?: boolean } {
        let isUNC = false;
        try {
            const folders = vscode.workspace.workspaceFolders;
            if (process.platform === 'win32' && folders && folders.length > 0) {
                isUNC = folders.some(f => f.uri.fsPath.startsWith('\\\\'));
            }
        } catch { /* ignore */ }
        return { remoteName: vscode.env.remoteName, isUNC };
    }

    private getSyncImportFilesDefault(): boolean {
        const existing = this.context.workspaceState.get<boolean>(SYNC_IMPORT_FILES_KEY);
        if (typeof existing === 'boolean') return existing;
        // Migration rule: if the saved Extensions include .import, enable; if unknown/unsaved, default OFF (conservative)
        const savedExtensions = this.context.workspaceState.get<string>(EXTENSIONS_KEY);
        if (typeof savedExtensions === 'string') {
            const includesImport = savedExtensions.toLowerCase().includes('.import');
            return includesImport;
        }
        return false;
    }

    private logMessage(message: string) {
        this.logBuffer.push(message);
        if (this.logBuffer.length > this.maxLogLines) {
            this.logBuffer.shift();
        }

        this.context.workspaceState.update(LOG_FILE_KEY, this.logBuffer);

        if (this._view) {
            this._view.webview.postMessage({ command: 'log', data: message });
        }
    }

    private clearLog() {
        this.logBuffer = [];
        this.context.workspaceState.update(LOG_FILE_KEY, this.logBuffer);
        if (this._view) {
            this._view.webview.postMessage({ command: 'log', data: '' });
        }
    }

    private updateStatus(isRunning: boolean) {
        if (this._view) {
            this._view.webview.postMessage({ command: 'updateStatus', data: { isRunning } });
        }
    }

    public async selectFolder(configKey: string, messageCommand: string) {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: 'Select Folder'
        };

        const folderUri = await vscode.window.showOpenDialog(options);
        if (folderUri && folderUri[0]) {
            const selectedPath = folderUri[0].fsPath;
            await this.context.workspaceState.update(configKey, selectedPath);
            if (this._view) {
                this._view.webview.postMessage({ command: messageCommand, data: selectedPath });
            }
            this.logMessage(`${configKey === SOURCE_DIR_KEY ? 'Source' : 'Target'} folder set to: ${selectedPath}`);
        }
    }

    public async updateExtensions(extensionsString: string | undefined) {
        if (typeof extensionsString === 'string') {
            const sanitizedExtensions = extensionsString.split(',')
                                                    .map(ext => ext.trim())
                                                    .filter(ext => ext.length > 0)
                                                    .join(', ');
            const prev = this.context.workspaceState.get<string>(EXTENSIONS_KEY, '');
            if (prev !== sanitizedExtensions) {
                await this.context.workspaceState.update(EXTENSIONS_KEY, sanitizedExtensions);
                this.logMessage(`Extensions updated to: ${sanitizedExtensions}`);
            }
        }
    }

    public startSync() {
        const sourceDir = this.context.workspaceState.get<string>(SOURCE_DIR_KEY);
        const targetDir = this.context.workspaceState.get<string>(TARGET_DIR_KEY);
        const extensionsString = this.context.workspaceState.get<string>(EXTENSIONS_KEY, '');
        const extensions = extensionsString.split(',').map(s => s.trim()).filter(s => s.length > 0);
        const allowDeletion = this.context.workspaceState.get<boolean>(ALLOW_DELETION_KEY, false);
        const includeHidden = this.context.workspaceState.get<boolean>(INCLUDE_HIDDEN_KEY, false);
        const usePolling = this.context.workspaceState.get<boolean>(USE_POLLING_KEY, false);
        const syncImportFiles = this.getSyncImportFilesDefault();

        if (!sourceDir || !targetDir) {
            vscode.window.showErrorMessage('Godot Sync: Please select both Source and Target directories in the Godot Sync panel.');
            this.logMessage("Start failed: Missing source or target directory.");
            return;
        }
        if (extensions.length === 0) {
            vscode.window.showErrorMessage('Godot Sync: Please define file extensions to sync in the Godot Sync panel.');
            this.logMessage("Start failed: No extensions defined.");
            return;
        }

        this.syncService.start(sourceDir, targetDir, extensions, allowDeletion, includeHidden, usePolling, syncImportFiles);
    }

    public stopSync() {
        this.syncService.stop();
    }

    public dispose() {
        this.syncService.dispose();
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.css'));

        const nonce = getNonce(); // Chave de segurança para o script da tela.

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="
                    default-src 'none';
                    style-src ${webview.cspSource} 'unsafe-inline';
                    script-src 'nonce-${nonce}';
                    img-src ${webview.cspSource};
                    font-src ${webview.cspSource};
                ">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <title>Godot Sync</title>
            </head>
            <body>
                <div class="input-group">
                    <input type="text" id="sourceDir" placeholder="Source Directory (e.g., Editor Scripts)">
                    <button id="selectSource">Select Source</button>
                </div>

                <div class="input-group">
                    <input type="text" id="targetDir" placeholder="Target Directory (Godot Project)">
                    <button id="selectTarget">Select Target</button>
                </div>

                <label for="extensions">Extensions (comma-separated):</label>
                <div class="input-group">
                    <input type="text" id="extensions" placeholder="e.g. .gd, .tscn, .res, .import">
                </div>
                <div class="input-group">
                    <label for="presetSelect" style="margin-right:8px;">Presets:</label>
                    <select id="presetSelect">
                        <option value="none">None</option>
                        <option value="scripts">Scripts (recommended)</option>
                        <option value="minimal">Minimal</option>
                        <option value="assets">Assets</option>
                    </select>
                </div>

                <div class="options-grid">
                    <label class="checkbox">
                        <input type="checkbox" id="allowDeletion" />
                        <span>Allow deletion</span>
                    </label>
                    <label class="checkbox" title="Include dotfiles (files starting with '.')">
                        <input type="checkbox" id="includeHidden" />
                        <span>Sync dotfiles</span>
                    </label>
                    <label class="checkbox" title="Use when file events are missed (WSL/containers/network). Slightly higher CPU.">
                        <input type="checkbox" id="usePolling" />
                        <span>Use polling (compat)</span>
                    </label>
                    <label class="checkbox" title="Godot import metadata sidecars next to assets">
                        <input type="checkbox" id="syncImportFiles" />
                        <span>Sync *.import metadata</span>
                    </label>
                </div>

                <div id="pollingBanner" class="banner" style="display:none;">
                    <span>This environment may miss file events. Consider enabling 'Use polling'.</span>
                    <div class="banner-actions">
                        <button id="enablePollingNow">Enable now</button>
                        <button id="dismissPollingBanner">Dismiss</button>
                    </div>
                </div>

                <p class="warning-message" id="deletionWarning" style="display:none;"><em>Warning: Deletion enabled. Sync is one-way (Source → Target). Files in Target may be overwritten or deleted.</em></p>

                <div id="status">Status: Set Source & Target.</div>

                <div class="button-group">
                    <button id="startButton">Start Sync</button>
                    <button id="stopButton" disabled>Stop Sync</button>
                </div>

                <div class="log-header">
                    <span class="log-title">Sync Log</span>
                    <button id="clearLogButton" class="button-secondary button-small" title="Clear log">Clear</button>
                </div>
                <textarea id="logArea" readonly rows="10"></textarea>

                <script nonce="${nonce}" src="${scriptUri}"></script>
                
                <footer>
                    Developed by Augusto Cesar Perin (Abstratus Labs)
                </footer>
            </body>
            </html>`;
    }
}

// Cria uma chave de segurança (nonce) para proteger o script da tela da extensão.
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
