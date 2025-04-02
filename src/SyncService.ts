
import * as vscode from 'vscode';
import * as chokidar from 'chokidar';
import * as fs from 'fs/promises';
import * as path from 'path';

type LogFunction = (message: string) => void;
type StatusFunction = (isRunning: boolean) => void;

export class SyncService {
    private watcher: chokidar.FSWatcher | null = null;
    private sourceDir: string | null = null;
    private targetDir: string | null = null;
    private extensions: string[] = [];
    private isRunning: boolean = false;
    private log: LogFunction;
    private updateStatus: StatusFunction;

    constructor(logCallback: LogFunction, statusCallback: StatusFunction) {
        this.log = (message) => {
            const timestamp = new Date().toLocaleTimeString();
            logCallback(`[${timestamp}] ${message}`);
        };
        this.updateStatus = statusCallback;
    }

    public start(sourceDir: string, targetDir: string, extensions: string[]): boolean {
        if (this.isRunning) {
            this.log('Sync service is already running.');
            return false;
        }

        if (!sourceDir || !targetDir || extensions.length === 0) {
            this.log('Error: Source directory, target directory, and extensions must be configured.');
            vscode.window.showErrorMessage('Godot Sync: Source, target, and extensions must be set.');
            return false;
        }

        // Validar se os diretórios existem
        Promise.all([fs.stat(sourceDir), fs.stat(targetDir)])
            .then(([sourceStats, targetStats]) => {
                if (!sourceStats.isDirectory() || !targetStats.isDirectory()) {
                    throw new Error('Source and Target paths must be directories.');
                }

                this.sourceDir = sourceDir;
                this.targetDir = targetDir;
                this.extensions = extensions.map(ext => ext.startsWith('.') ? ext : `.${ext}`); // Garantir que começa com '.'

                this.log(`Starting watcher on: ${this.sourceDir}`);
                this.log(`Target directory: ${this.targetDir}`);
                this.log(`Watching extensions: ${this.extensions.join(', ')}`);

                this.watcher = chokidar.watch(this.sourceDir, {
                    ignored: /(^|[\/\\])\../, // Ignorar dotfiles/dotfolders
                    persistent: true,
                    ignoreInitial: true, // Não processar arquivos existentes no início
                    depth: undefined, // Monitorar subdiretórios recursivamente
                    usePolling: false, // Usar eventos do sistema de arquivos (mais eficiente)
                });

                this.watcher
                    .on('add', (filePath) => this.handleFileSync(filePath, 'add'))
                    .on('change', (filePath) => this.handleFileSync(filePath, 'change'))
                    .on('unlink', (filePath) => this.handleFileSync(filePath, 'unlink'))
                    .on('error', (error) => this.handleError(error))
                    .on('ready', () => {
                        this.log('Watcher ready.');
                        this.isRunning = true;
                        this.updateStatus(this.isRunning);
                    });

            })
            .catch(error => {
                this.log(`Error starting watcher: ${error.message}`);
                vscode.window.showErrorMessage(`Godot Sync: Error starting - ${error.message}`);
                this.stop(); // Garante que o estado seja limpo
            });

        return true; // Retorna true indicando tentativa de início
    }

    public stop(): void {
        if (this.watcher) {
            this.log('Stopping watcher...');
            this.watcher.close().then(() => {
                this.log('Watcher stopped.');
                this.isRunning = false;
                this.watcher = null;
                this.sourceDir = null;
                this.targetDir = null;
                this.updateStatus(this.isRunning);
            }).catch(err => {
                 this.log(`Error stopping watcher: ${err.message}`);
                 // Mesmo com erro, consideramos parado
                 this.isRunning = false;
                 this.watcher = null;
                 this.sourceDir = null;
                 this.targetDir = null;
                 this.updateStatus(this.isRunning);
            });
        } else {
             this.log('Watcher already stopped.');
             this.isRunning = false; // Garante que está false
             this.updateStatus(this.isRunning);
        }
    }

    public getIsRunning(): boolean {
        return this.isRunning;
    }

    private async handleFileSync(filePath: string, eventType: 'add' | 'change' | 'unlink'): Promise<void> {
        if (!this.sourceDir || !this.targetDir) return;

        const fileExtension = path.extname(filePath).toLowerCase();
        if (!this.extensions.includes(fileExtension)) {
            // this.log(`Ignoring file (wrong extension): ${path.basename(filePath)}`);
            return; // Ignorar se não for uma extensão monitorada
        }

        const filename = path.basename(filePath);
        const relativePath = path.relative(this.sourceDir, filePath); // Mantém estrutura de subpastas
        const targetPath = path.join(this.targetDir, relativePath);
        const targetSubDir = path.dirname(targetPath);

        try {
            if (eventType === 'add' || eventType === 'change') {
                // Garantir que o subdiretório de destino exista
                await fs.mkdir(targetSubDir, { recursive: true });
                // Usar copyFile para sobrescrever se existir ou criar se não
                await fs.copyFile(filePath, targetPath);
                this.log(`Copied: ${relativePath}`);
            } else if (eventType === 'unlink') {
                // Tentar remover o arquivo no destino apenas se ele existir
                try {
                    await fs.access(targetPath); // Verifica se o arquivo existe
                    await fs.unlink(targetPath);
                    this.log(`Deleted: ${relativePath}`);

                    // Opcional: Remover diretórios vazios no destino? (Pode ser complexo/arriscado)
                    // await this.removeEmptyDirs(targetSubDir);

                } catch (err: any) {
                    // Se o erro for ENOENT (Not Found), significa que já foi removido ou nunca existiu lá. Ignorar.
                    if (err.code !== 'ENOENT') {
                        throw err; // Relançar outros erros
                    } else {
                        // this.log(`Skipped delete (not found in target): ${relativePath}`);
                    }
                }
            }
        } catch (error: any) {
            this.log(`Error processing file ${relativePath}: ${error.message}`);
            vscode.window.showErrorMessage(`Godot Sync: Error processing ${filename}: ${error.message}`);
        }
    }

    // Função auxiliar (opcional) para remover diretórios vazios recursivamente
    // CUIDADO: Use com cautela. Pode deletar pastas inesperadas se a lógica não for perfeita.
    /*
    private async removeEmptyDirs(dirPath: string): Promise<void> {
        if (!this.targetDir || !dirPath.startsWith(this.targetDir) || dirPath === this.targetDir) {
            return; // Segurança: não sair do diretório alvo
        }
        try {
            const files = await fs.readdir(dirPath);
            if (files.length === 0) {
                await fs.rmdir(dirPath);
                this.log(`Removed empty directory: ${path.relative(this.targetDir, dirPath)}`);
                // Tentar remover o pai também
                await this.removeEmptyDirs(path.dirname(dirPath));
            }
        } catch (error: any) {
             // Ignorar erros como diretório não vazio ou permissão, pode ser concorrência
            if (error.code !== 'ENOTEMPTY' && error.code !== 'EPERM' && error.code !== 'EBUSY') {
                 this.log(`Error removing empty dir ${dirPath}: ${error.message}`);
            }
        }
    }
    */

    private handleError(error: Error): void {
        this.log(`Watcher error: ${error.message}`);
        vscode.window.showErrorMessage(`Godot Sync Watcher Error: ${error.message}`);
        this.stop(); // Parar em caso de erro grave no watcher
    }

    public dispose(): void {
        this.stop();
    }
}