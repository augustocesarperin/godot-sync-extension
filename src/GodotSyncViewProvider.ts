// godot-sync-extension/src/GodotSyncViewProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises'; // Para ler o log inicial
import { SyncService } from './SyncService';


const SOURCE_DIR_KEY = 'godotSync.sourceDir';
const TARGET_DIR_KEY = 'godotSync.targetDir';
const EXTENSIONS_KEY = 'godotSync.extensions';
const LOG_FILE_KEY = 'godotSync.log'; // Armazenaremos o log no estado também

export class GodotSyncViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'godotSyncView'; // Deve corresponder ao ID em package.json

    private _view?: vscode.WebviewView;
    private syncService: SyncService;
    private context: vscode.ExtensionContext;
    private logBuffer: string[] = []; 
    private readonly maxLogLines = 200; 

    constructor(private readonly _extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this.context = context;
        this.syncService = new SyncService(
            (message) => this.logMessage(message),
            (isRunning) => this.updateStatus(isRunning)
        );

        
        this.logBuffer = this.context.globalState.get<string[]>(LOG_FILE_KEY, []);
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
                vscode.Uri.joinPath(this._extensionUri, 'src', 'webview'),
                vscode.Uri.joinPath(this._extensionUri, 'out') // Se houver recursos compilados
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
                case 'startSync':
                    this.startSync();
                    break;
                case 'stopSync':
                    this.syncService.stop();
                    break;
            }
        });

        webviewView.onDidDispose(() => {
            this._view = undefined;
        });

        this.updateStatus(this.syncService.getIsRunning());
    }

    // --- Métodos de Comunicação com Webview ---

    private sendInitialConfig() {
        if (this._view) {
            const sourceDir = this.context.globalState.get<string>(SOURCE_DIR_KEY);
            const targetDir = this.context.globalState.get<string>(TARGET_DIR_KEY);
            const extensions = this.context.globalState.get<string>(EXTENSIONS_KEY, '.gd, .tscn, .tres, .res, .import, .shader, .json, .cfg');
            const isRunning = this.syncService.getIsRunning();
            const logContent = this.logBuffer.join('\n');

            this._view.webview.postMessage({
                command: 'updateConfig',
                data: { sourceDir, targetDir, extensions, isRunning, logContent }
            });
        }
    }

    private logMessage(message: string) {
        this.logBuffer.push(message);
        if (this.logBuffer.length > this.maxLogLines) {
            this.logBuffer.shift(); 
        }

        this.context.globalState.update(LOG_FILE_KEY, this.logBuffer);

        if (this._view) {
            this._view.webview.postMessage({ command: 'log', data: message });
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
            await this.context.globalState.update(configKey, selectedPath);
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
            await this.context.globalState.update(EXTENSIONS_KEY, sanitizedExtensions);
            this.logMessage(`Extensions updated to: ${sanitizedExtensions}`);
        }
    }

    public startSync() {
        const sourceDir = this.context.globalState.get<string>(SOURCE_DIR_KEY);
        const targetDir = this.context.globalState.get<string>(TARGET_DIR_KEY);
        const extensionsString = this.context.globalState.get<string>(EXTENSIONS_KEY, '');
        const extensions = extensionsString.split(',').map(s => s.trim()).filter(s => s.length > 0);

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

        this.syncService.start(sourceDir, targetDir, extensions);
    }

    public stopSync() {
        this.syncService.stop();
    }

    public dispose() {
        this.syncService.dispose();
    }


    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.css'));

        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="
                    default-src 'none';
                    style-src ${webview.cspSource} 'unsafe-inline';
                    script-src 'nonce-${nonce}';
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
                    <input type="text" id="extensions" placeholder=".gd, .tscn, .tres, .res, ...">
                </div>

                <p class="warning-message"><em>Warning: Sync is one-way (Source → Target). Changes made directly in the Target folder may be overwritten.</em></p>

                <div id="status">Status: Initializing...</div>

                <div class="button-group">
                    <button id="startButton">Start Sync</button>
                    <button id="stopButton" disabled>Stop Sync</button>
                </div>

                <label for="logArea">Sync Log:</label>
                <textarea id="logArea" readonly rows="10"></textarea>

                <script nonce="${nonce}" src="${scriptUri}"></script>
                
                <footer>
                    Developed by Augusto Cesar Perin (Abstratus Labs)
                </footer>
            </body>
            </html>`;
    }
}

// Função auxiliar para gerar nonces (necessário para CSP)
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}