import * as vscode from 'vscode';
import * as chokidar from 'chokidar';
import * as fs from 'fs/promises';
import * as path from 'path';

type LogFunction = (message: string) => void;
type StatusFunction = (isRunning: boolean) => void;
type SyncOperation = {
    filePath: string;
    eventType: 'add' | 'change' | 'unlink';
};

export class SyncService {
    private watcher: chokidar.FSWatcher | null = null;
    private sourceDir: string | null = null;
    private targetDir: string | null = null;
    private extensions: string[] = [];
    private allowDeletion = false;
    private includeHidden = false;
    private usePolling = false;
    private syncImportFiles = true;
    private isRunning = false;
    private log: LogFunction;
    private updateStatus: StatusFunction;

    private syncQueue: SyncOperation[] = [];
    private isProcessingQueue = false;

    constructor(logCallback: LogFunction, statusCallback: StatusFunction) {
        this.log = (message) => {
            const timestamp = new Date().toLocaleTimeString();
            logCallback(`[${timestamp}] ${message}`);
        };
        this.updateStatus = statusCallback;
    }

    public start(sourceDir: string, targetDir: string, extensions: string[], allowDeletion: boolean, includeHidden?: boolean, usePolling?: boolean, syncImportFiles?: boolean): boolean {
        if (this.isRunning) {
            this.log('Sync service is already running.');
            return false;
        }

        if (!sourceDir || !targetDir || extensions.length === 0) {
            this.log('Error: Source directory, target directory, and extensions must be configured.');
            vscode.window.showErrorMessage('Godot Sync: Source, target, and extensions must be set.');
            return false;
        }

		// Safety: prevent recursive or overlapping paths (Source == Target, or one contains the other)
		try {
			const resolvedSource = path.resolve(sourceDir);
			const resolvedTarget = path.resolve(targetDir);
			const normalize = (p: string) => process.platform === 'win32' ? p.toLowerCase() : p;
			const srcN = normalize(resolvedSource);
			const dstN = normalize(resolvedTarget);
			const isEqual = srcN === dstN;
			const isSubPath = (a: string, b: string) => a.startsWith(b + path.sep);
			if (isEqual || isSubPath(srcN, dstN) || isSubPath(dstN, srcN)) {
				this.log('Error: Source and Target must not overlap or be the same directory.');
				vscode.window.showErrorMessage('Godot Sync: Source and Target must not overlap or be the same directory.');
				return false;
			}
		} catch (_e) {
			// ignore normalization errors; stat will handle
		}

        Promise.all([fs.stat(sourceDir), fs.stat(targetDir)])
            .then(([sourceStats, targetStats]) => {
                if (!sourceStats.isDirectory() || !targetStats.isDirectory()) {
                    throw new Error('Source and Target paths must be directories.');
                }

				this.sourceDir = sourceDir;
				this.targetDir = targetDir;
				this.extensions = extensions.map(ext => ext.startsWith('.') ? ext : `.${ext}`);
				this.allowDeletion = allowDeletion;
				this.includeHidden = !!includeHidden;

                this.log(`Starting watcher on: ${this.sourceDir}`);
                this.log(`Target directory: ${this.targetDir}`);
                this.log(`Watching extensions: ${this.extensions.join(', ')}`);
                this.log(`File deletion is ${this.allowDeletion ? 'ENABLED' : 'DISABLED'}.`);

                this.usePolling = !!usePolling;
                this.syncImportFiles = syncImportFiles === undefined ? true : !!syncImportFiles;

                this.watcher = chokidar.watch(this.sourceDir, {
                    // Always ignore Godot's internal cache directories
                    // Also optionally ignore dotfiles unless includeHidden is true
                    ignored: (p: string) => this.shouldIgnorePath(p),
                    persistent: true,
                    depth: undefined,
                    usePolling: this.usePolling,
                    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
                    followSymlinks: false,
                });

                this.watcher
                    .on('add', (filePath) => this.addToQueue(filePath, 'add'))
                    .on('change', (filePath) => this.addToQueue(filePath, 'change'))
                    .on('unlink', (filePath) => this.addToQueue(filePath, 'unlink'))
                    .on('error', (error) => this.handleError(error))
                    .on('ready', () => {
                        this.log('Watcher ready.');
                        this.isRunning = true;
                        this.updateStatus(this.isRunning);
                        this.initialSync();
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
                this.syncQueue = [];
                this.isProcessingQueue = false;
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

    private addToQueue(filePath: string, eventType: 'add' | 'change' | 'unlink'): void {
        this.syncQueue.push({ filePath, eventType });
        this.processQueue();
    }
    
    private async processQueue(): Promise<void> {
        if (this.isProcessingQueue || this.syncQueue.length === 0) {
            return;
        }
        this.isProcessingQueue = true;
    
        const operation = this.syncQueue.shift();
        if (operation) {
            try {
                await this.handleFileSync(operation.filePath, operation.eventType);
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                this.log(`Failed to process ${operation.filePath}. Error: ${msg}`);
            }
        }
    
        this.isProcessingQueue = false;
        this.processQueue();
    }

    private async initialSync(): Promise<void> {
        if (!this.sourceDir) return;
        this.log('Starting initial sync...');
        
        const walk = async (dir: string) => {
            const files = await fs.readdir(dir, { withFileTypes: true });
            for (const file of files) {
                const filePath = path.join(dir, file.name);
                if (file.isDirectory() && (file.name === '.godot' || file.name === '.import')) {
                    continue;
                }
                if (!this.includeHidden && file.name.startsWith('.')) {
                    continue;
                }
                if (file.isDirectory()) {
                    await walk(filePath);
                } else if (file.isFile()) {
                    // Do not skip *.import here
                    this.addToQueue(filePath, 'add');
                }
            }
        };

        try {
            await walk(this.sourceDir);
            this.log('Initial sync queued.');
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.log(`Error during initial sync: ${msg}`);
            vscode.window.showErrorMessage(`Godot Sync: Initial sync error - ${msg}`);
            this.stop();
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
        if (fileExtension === '.import' && !this.syncImportFiles) {
            return;
        }

        const filename = path.basename(filePath);
        const relativePath = path.relative(this.sourceDir, filePath);
        const targetPath = path.join(this.targetDir, relativePath);
        const targetSubDir = path.dirname(targetPath);

        const resolvedTargetRoot = path.resolve(this.targetDir);
        const resolvedTargetPath = path.resolve(targetPath);
        const isInside = resolvedTargetPath === resolvedTargetRoot || resolvedTargetPath.startsWith(resolvedTargetRoot + path.sep);
        if (!isInside) {
            this.log(`Security block: Attempted to write outside target root: ${relativePath}`);
            vscode.window.showErrorMessage('Godot Sync: Blocked writing outside of target directory.');
            return;
        }

        try {
            if (eventType === 'add' || eventType === 'change') {
                await fs.mkdir(targetSubDir, { recursive: true });

                let sourceStat;
                try {
                    sourceStat = await fs.stat(filePath);
                } catch (err: unknown) {
                    if (this.getErrorCode(err) === 'ENOENT') {
                        this.log(`Skipped (source file gone): ${relativePath}`);
                        return;
                    }
                    throw err;
                }

                try {
                    const targetStat = await fs.stat(targetPath);
                    if (sourceStat.mtimeMs <= targetStat.mtimeMs) {
                        this.log(`Skipped (destination is newer): ${relativePath}`);
                        return;
                    }
                } catch (err: unknown) {
                    if (this.getErrorCode(err) !== 'ENOENT') {
                        const msg = err instanceof Error ? err.message : String(err);
                        this.log(`Warning: Could not stat target ${relativePath}. Proceeding. Error: ${msg}`);
                    }
                }

                await this.copyFileAtomicWithRetry(filePath, targetPath);
                this.log(`Copied: ${relativePath}`);

            } else if (eventType === 'unlink') {
                if (!this.allowDeletion) {
                    this.log(`Deletion skipped (disabled): ${relativePath}`);
                    return;
                }
                try {
                    await this.unlinkWithRetry(targetPath);
                    this.log(`Deleted: ${relativePath}`);
                } catch (err: unknown) {
                    if (this.getErrorCode(err) !== 'ENOENT') {
                        throw err;
                    }
                }
            }
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.log(`Error processing file ${relativePath}: ${msg}`);
            // Avoid spam
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

    private shouldIgnorePath(p: string): boolean {
        try {
            if (!this.sourceDir) return false;
            const rel = path.relative(this.sourceDir, p);
            const parts = rel.split(path.sep);

            if (parts.includes('.godot')) return true;
            if (parts.includes('.import')) return true;
            if (!this.includeHidden) {
                if (parts.some(seg => seg.startsWith('.'))) return true;
            }
        } catch (_e) { /* ignore */ }
        return false;
    }

    private async withRetry<T>(opName: string, fn: () => Promise<T>, retries = 3, baseDelayMs = 50): Promise<T> {
        let attempt = 0;
        let lastErr: unknown;
        while (attempt <= retries) {
            try {
                return await fn();
            } catch (err: unknown) {
                lastErr = err;
                const code = this.getErrorCode(err);
                if (!['EBUSY', 'EPERM', 'ETXTBSY', 'EACCES'].includes(String(code))) break;
                const delay = baseDelayMs * Math.pow(3, attempt);
                await new Promise(res => setTimeout(res, delay));
                attempt++;
            }
        }
        const lastMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
        throw new Error(`${opName} failed after retries: ${lastMsg}`);
    }

    private async copyFileAtomicWithRetry(src: string, dst: string): Promise<void> {
        const tmp = dst + `.__godotsync_tmp_${process.pid}_${Math.random().toString(36).slice(2)}`;
        await this.withRetry('copyFile(tmp)', async () => {
            await fs.copyFile(src, tmp);
        });
        await this.withRetry('removeExistingTarget', async () => {
            try { await fs.unlink(dst); } catch (e: unknown) { if (this.getErrorCode(e) !== 'ENOENT') throw e; }
        }, 2, 30).catch((_err) => { return; });
        await this.withRetry('rename(tmp->dst)', async () => {
            await fs.rename(tmp, dst);
        });
        // Cleanup stray tmp if rename somehow left it
        try { await fs.unlink(tmp); } catch { /* ignore */ }
    }

    private async unlinkWithRetry(p: string): Promise<void> {
        await this.withRetry('unlink', async () => {
            await fs.unlink(p);
        });
    }

    private getErrorCode(err: unknown): string | number | undefined {
        if (typeof err === 'object' && err !== null && 'code' in err) {
            const code = (err as { code?: unknown }).code;
            if (typeof code === 'string' || typeof code === 'number') {
                return code;
            }
        }
        return undefined;
    }
}