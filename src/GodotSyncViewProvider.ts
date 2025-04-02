// godot-sync-extension/src/GodotSyncViewProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises'; // Para ler o log inicial
import { SyncService } from './SyncService';

// Chaves para armazenamento no globalState
const SOURCE_DIR_KEY = 'godotSync.sourceDir';
const TARGET_DIR_KEY = 'godotSync.targetDir';
const EXTENSIONS_KEY = 'godotSync.extensions';
const LOG_FILE_KEY = 'godotSync.log'; // Armazenaremos o log no estado também

export class GodotSyncViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'godotSyncView'; // Deve corresponder ao ID em package.json

    private _view?: vscode.WebviewView;
    private syncService: SyncService;
    private context: vscode.ExtensionContext;
    private logBuffer: string[] = []; // Buffer para logs antes do webview carregar
    private readonly maxLogLines = 200; // Limitar tamanho do log na memória/webview

    constructor(private readonly _extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this.context = context;
        this.syncService = new SyncService(
            (message) => this.logMessage(message),
            (isRunning) => this.updateStatus(isRunning)
        );

        // Carregar log persistido ao iniciar
        this.logBuffer = this.context.globalState.get<string[]>(LOG_FILE_KEY, []);
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext<unknown>,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            // Habilitar scripts no webview
            enableScripts: true,
            // Restringir o webview a carregar conteúdo apenas do diretório 'media' e 'out'
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'src', 'webview'),
                vscode.Uri.joinPath(this._extensionUri, 'out') // Se houver recursos compilados
            ]
        };

        // Definir o conteúdo HTML do webview
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Lidar com mensagens recebidas do webview
        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'webviewLoaded':
                    // Enviar configuração inicial quando o webview estiver pronto
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

        // Lidar com o descarte do webview (ex: usuário fechou o painel)
        webviewView.onDidDispose(() => {
            this._view = undefined;
            // Não paramos o serviço aqui, pois ele deve rodar em background
            // this.syncService.stop(); // Descomente se quiser parar ao fechar o painel
        });

        // Se o serviço já estiver rodando (ex: VS Code reiniciado), atualiza status
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
        // Adiciona ao buffer, limitando o tamanho
        this.logBuffer.push(message);
        if (this.logBuffer.length > this.maxLogLines) {
            this.logBuffer.shift(); // Remove a linha mais antiga
        }

        // Persistir log no estado global
        this.context.globalState.update(LOG_FILE_KEY, this.logBuffer);

        // Envia para o webview se ele estiver visível
        if (this._view) {
            this._view.webview.postMessage({ command: 'log', data: message });
        }
    }

    private updateStatus(isRunning: boolean) {
        if (this._view) {
            this._view.webview.postMessage({ command: 'updateStatus', data: { isRunning } });
        }
    }

    // --- Ações Disparadas pela UI (via Webview ou Comandos) ---

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
            // Correção: Usar template literal (backticks) para interpolação
            this.logMessage(`${configKey === SOURCE_DIR_KEY ? 'Source' : 'Target'} folder set to: ${selectedPath}`);
            // Reiniciar se estiver rodando e a configuração mudar? Opcional.
            // if (this.syncService.getIsRunning()) {
            //     this.logMessage("Configuration changed, restarting sync...");
            //     this.syncService.stop();
            //     this.startSync();
            // }
        }
    }

    public async updateExtensions(extensionsString: string | undefined) {
        if (typeof extensionsString === 'string') {
            const sanitizedExtensions = extensionsString.split(',')
                                                    .map(ext => ext.trim())
                                                    .filter(ext => ext.length > 0)
                                                    .join(', '); // Salvar formatado
            await this.context.globalState.update(EXTENSIONS_KEY, sanitizedExtensions);
             // Correção: Usar template literal (backticks) para interpolação
            this.logMessage(`Extensions updated to: ${sanitizedExtensions}`);
            // Reiniciar se estiver rodando e as extensões mudarem? Opcional.
            // if (this.syncService.getIsRunning()) {
            //     this.logMessage("Extensions changed, restarting sync...");
            //     this.syncService.stop();
            //     this.startSync();
            // }
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

    // Limpa o serviço ao desativar a extensão
    public dispose() {
        this.syncService.dispose();
    }


    // --- Geração do HTML para o Webview ---
    // Correção: Usar template literal (backticks `) para toda a string HTML
    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Obter URIs para os arquivos CSS e JS locais
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'main.css'));

        // Obter um nonce para segurança (Content Security Policy)
        const nonce = getNonce();

        // Correção: Envolver TODO o HTML em backticks (`)
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

                <div id="status">Status: Initializing...</div>

                <div class="button-group">
                    <button id="startButton">Start Sync</button>
                    <button id="stopButton" disabled>Stop Sync</button>
                </div>

                <label for="logArea">Sync Log:</label>
                <textarea id="logArea" readonly rows="10"></textarea>

                <script nonce="${nonce}" src="${scriptUri}"></script>
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