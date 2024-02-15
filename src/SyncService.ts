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
    private isRunning = false;
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

        Promise.all([fs.stat(sourceDir), fs.stat(targetDir)])
            .then(([sourceStats, targetStats]) => {
                if (!sourceStats.isDirectory() || !targetStats.isDirectory()) {
                    throw new Error('Source and Target paths must be directories.');
                }

                this.sourceDir = sourceDir;
                this.targetDir = targetDir;
                this.extensions = extensions.map(ext => ext.startsWith('.') ? ext : `.${ext}`);

                this.log(`Starting watcher on: ${this.sourceDir}`);
                this.log(`Target directory: ${this.targetDir}`);
                this.log(`Watching extensions: ${this.extensions.join(', ')}`);

                this.watcher = chokidar.watch(this.sourceDir, {
                    ignored: /(^|[\\\\])\../,
                    persistent: true,
                    ignoreInitial: true,
                    depth: undefined,
                    usePolling: false,
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
                this.stop();
            });

        return true;
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
                 this.isRunning = false;
                 this.watcher = null;
                 this.sourceDir = null;
                 this.targetDir = null;
                 this.updateStatus(this.isRunning);
            });
        } else {
             this.log('Watcher already stopped.');
             this.isRunning = false;
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
            return;
        }

        const filename = path.basename(filePath);
        const relativePath = path.relative(this.sourceDir, filePath);
        const targetPath = path.join(this.targetDir, relativePath);
        const targetSubDir = path.dirname(targetPath);

        try {
            if (eventType === 'add' || eventType === 'change') {
                await fs.mkdir(targetSubDir, { recursive: true });
                await fs.copyFile(filePath, targetPath);
                this.log(`Copied: ${relativePath}`);
            } else if (eventType === 'unlink') {
                try {
                    await fs.access(targetPath);
                    await fs.unlink(targetPath);
                    this.log(`Deleted: ${relativePath}`);
                } catch (err: any) {
                    if (err.code !== 'ENOENT') {
                        throw err;
                    }
                }
            }
        } catch (error: any) {
            this.log(`Error processing file ${relativePath}: ${error.message}`);
            vscode.window.showErrorMessage(`Godot Sync: Error processing ${filename}: ${error.message}`);
        }
    }

    private handleError(error: Error): void {
        this.log(`Watcher error: ${error.message}`);
        vscode.window.showErrorMessage(`Godot Sync Watcher Error: ${error.message}`);
        this.stop();
    }

    public dispose(): void {
        this.stop();
    }
}