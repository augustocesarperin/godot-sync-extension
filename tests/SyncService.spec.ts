import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

import { SyncService } from '../src/SyncService';
import * as fsPromises from 'fs/promises';
import * as vscode from 'vscode';

async function makeTempDir(prefix: string): Promise<string> {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    return base;
}

async function exists(p: string): Promise<boolean> {
    try { await fs.stat(p); return true; } catch { return false; }
}

describe('SyncService', () => {
    let srcDir: string;
    let dstDir: string;
    let logs: string[];
    let isRunningState = false;
    let service: SyncService;

    beforeEach(async () => {
        srcDir = await makeTempDir('godot-sync-src-');
        dstDir = await makeTempDir('godot-sync-dst-');
        logs = [];
        isRunningState = false;
        service = new SyncService(
            (m) => logs.push(m),
            (running) => { isRunningState = running; }
        );
    });

    afterEach(async () => {
        service.stop();
        // best-effort cleanup
        try { await fs.rm(srcDir, { recursive: true, force: true }); } catch {/* ignore */}
        try { await fs.rm(dstDir, { recursive: true, force: true }); } catch {/* ignore */}
    });

    it('performs initial sync and copies files matching extensions', async () => {
        await fs.writeFile(path.join(srcDir, 'a.gd'), 'print("a")');
        await fs.mkdir(path.join(srcDir, 'sub'), { recursive: true });
        await fs.writeFile(path.join(srcDir, 'sub', 'b.tscn'), '[gd_scene]');
        await fs.writeFile(path.join(srcDir, 'ignore.txt'), 'no');

        const started = service.start(srcDir, dstDir, ['.gd', '.tscn'], false);
        expect(started).toBe(true);

        await waitFor(() => isRunningState === true);

        await waitFor(async () => await exists(path.join(dstDir, 'a.gd')));
        await waitFor(async () => await exists(path.join(dstDir, 'sub', 'b.tscn')));
        expect(await exists(path.join(dstDir, 'ignore.txt'))).toBe(false);
    }, 20000);

    it('handles add/change/unlink and respects deletion flag', async () => {
        const started = service.start(srcDir, dstDir, ['.gd'], false);
        expect(started).toBe(true);
        await waitFor(() => isRunningState === true);

        const f = path.join(srcDir, 'x.gd');
        await fs.writeFile(f, 'print("x1")');
        await waitFor(async () => await exists(path.join(dstDir, 'x.gd')));

        await fs.writeFile(f, 'print("x2")');
        await waitFor(async () => {
            const content = await fs.readFile(path.join(dstDir, 'x.gd'), 'utf8');
            return content.includes('x2');
        });

        // Deletion disabled: target remains
        await fs.rm(f);
        await delay(300);
        expect(await exists(path.join(dstDir, 'x.gd'))).toBe(true);

        // Enable deletion and delete another file (wait for watcher to stop)
        service.stop();
        await waitFor(() => isRunningState === false);
        const started2 = service.start(srcDir, dstDir, ['.gd'], true);
        expect(started2).toBe(true);
        await waitFor(() => isRunningState === true);
        const g = path.join(srcDir, 'y.gd');
        await fs.writeFile(g, 'print("y")');
        await waitFor(async () => await exists(path.join(dstDir, 'y.gd')));
        await fs.rm(g);
        await waitFor(async () => !(await exists(path.join(dstDir, 'y.gd'))));
    }, 25000);

    it('skips when destination file is newer', async () => {
        const started = service.start(srcDir, dstDir, ['.gd'], false);
        expect(started).toBe(true);
        await waitFor(() => isRunningState === true);

        const s = path.join(srcDir, 'n.gd');
        const d = path.join(dstDir, 'n.gd');
        await fs.writeFile(s, 'print("n1")');
        await waitFor(async () => await exists(d));

        // Make destination newer
        const now = new Date();
        await fs.utimes(d, now, new Date(now.getTime() + 5 * 60 * 1000));

        // Source update but with same/older mtime
        await delay(100);
        await fs.writeFile(s, 'print("n2")');

        // Since mtime on dest is newer, service should log skip and keep old content
        await delay(400);
        const content = await fs.readFile(d, 'utf8');
        expect(content).toContain('n1');
    }, 15000);

    it('ignores dotfiles created after start', async () => {
        const started = service.start(srcDir, dstDir, ['.gd'], false, false);
        expect(started).toBe(true);
        await waitFor(() => isRunningState === true);

        // Create a hidden file
        await fs.writeFile(path.join(srcDir, '.hidden.gd'), 'print("hidden")');
        await delay(300);
        expect(await exists(path.join(dstDir, '.hidden.gd'))).toBe(false);
    }, 10000);

    it('includes dotfiles when includeHidden is true', async () => {
        const started = service.start(srcDir, dstDir, ['.gd'], false, true);
        expect(started).toBe(true);
        await waitFor(() => isRunningState === true);

        await fs.writeFile(path.join(srcDir, '.visible.gd'), 'print("v")');
        await waitFor(async () => await exists(path.join(dstDir, '.visible.gd')));
    }, 12000);

    it('logs deletion skipped when allowDeletion is false', async () => {
        const started = service.start(srcDir, dstDir, ['.gd'], false);
        expect(started).toBe(true);
        await waitFor(() => isRunningState === true);

        const f = path.join(srcDir, 'z.gd');
        await fs.writeFile(f, 'print("z")');
        await waitFor(async () => await exists(path.join(dstDir, 'z.gd')));

        logs.length = 0;
        await fs.rm(f);
        await delay(400);
        const combined = logs.join('\n');
        expect(combined).toMatch(/Deletion skipped \(disabled\)/);
    }, 12000);

    it('does not sync after stop', async () => {
        const started = service.start(srcDir, dstDir, ['.gd'], false);
        expect(started).toBe(true);
        await waitFor(() => isRunningState === true);

        service.stop();
        await waitFor(() => isRunningState === false);

        await fs.writeFile(path.join(srcDir, 'afterstop.gd'), 'print("nope")');
        await delay(500);
        expect(await exists(path.join(dstDir, 'afterstop.gd'))).toBe(false);
    }, 12000);

    it('processes many files (load test)', async () => {
        const started = service.start(srcDir, dstDir, ['.gd'], false);
        expect(started).toBe(true);
        await waitFor(() => isRunningState === true);

        const total = 60;
        for (let i = 0; i < total; i++) {
            await fs.writeFile(path.join(srcDir, `bulk_${i}.gd`), `print(${i})`);
        }

        await waitFor(async () => await exists(path.join(dstDir, 'bulk_0.gd')));
        await waitFor(async () => await exists(path.join(dstDir, `bulk_${total - 1}.gd`)), 20000, 50);
    }, 30000);

    it('rejects overlapping or identical source/target', async () => {
        const s1 = service.start(srcDir, srcDir, ['.gd'], false, false);
        expect(s1).toBe(false);

        const target = path.join(dstDir, 'proj');
        await fs.mkdir(target, { recursive: true });
        const subSource = path.join(target, 'src');
        await fs.mkdir(subSource, { recursive: true });
        const s2 = service.start(subSource, target, ['.gd'], false, false);
        expect(s2).toBe(false);

        const s3 = service.start(srcDir, path.join(srcDir, 'out'), ['.gd'], false, false);
        expect(s3).toBe(false);
    }, 10000);

    it('blocks writes that would escape targetDir (path traversal)', async () => {
        (service as any).sourceDir = srcDir;
        (service as any).targetDir = dstDir;
        (service as any).extensions = ['.gd'];

        const escapePath = path.join(srcDir, '..', 'escape.gd');
        await fs.writeFile(escapePath, 'print("escape")');

        await (service as any).handleFileSync(escapePath, 'add');

        // Assert: file should not appear under target
        const insideTarget = path.join(dstDir, 'escape.gd');
        // Should not have created any file inside target
        expect(await exists(insideTarget)).toBe(false);

        const combined = logs.join('\n');
        expect(combined).toMatch(/Security block/);
    }, 8000);

    it('per-file copy errors do not show toast (only log)', async () => {
        const showErrorSpy = vi.spyOn(vscode.window, 'showErrorMessage');

        (service as any).sourceDir = srcDir;
        (service as any).targetDir = dstDir;
        (service as any).extensions = ['.gd'];
        const f = path.join(srcDir, 'e.gd');
        await fs.writeFile(f, 'print("e")');

        // Force copy failure 
        const copyAtomicSpy = vi.spyOn<any, any>(service as any, 'copyFileAtomicWithRetry').mockRejectedValueOnce(() => {
            const err: any = new Error('copy fail');
            err.code = 'EACCES';
            throw err;
        });

        await (service as any).handleFileSync(f, 'add');

        expect(showErrorSpy).not.toHaveBeenCalled();

        copyAtomicSpy.mockRestore();
        showErrorSpy.mockRestore();
    }, 12000);

    it('ignores .godot/** and .import/ directory even with includeHidden=true; allows *.import files via extensions', async () => {
        const started = service.start(srcDir, dstDir, ['.tscn', '.import'], false, true);
        expect(started).toBe(true);
        await waitFor(() => isRunningState === true);

        // Create hidden Godot internal and an import artifact
        await fs.mkdir(path.join(srcDir, '.godot'), { recursive: true });
        await fs.writeFile(path.join(srcDir, '.godot', 'state'), 'x');
        await fs.mkdir(path.join(srcDir, '.import'), { recursive: true });
        await fs.writeFile(path.join(srcDir, '.import', 'cachefile'), 'cache');
        await fs.writeFile(path.join(srcDir, 'scene.tscn.import'), 'meta');

        await delay(500);
        expect(await exists(path.join(dstDir, '.godot', 'state'))).toBe(false);
        expect(await exists(path.join(dstDir, '.import', 'cachefile'))).toBe(false);
        expect(await exists(path.join(dstDir, 'scene.tscn.import'))).toBe(true);
    }, 12000);

    it('atomic copy with retry succeeds after transient EBUSY', async () => {
        (service as any).sourceDir = srcDir;
        (service as any).targetDir = dstDir;
        const src = path.join(srcDir, 'retry.gd');
        const dst = path.join(dstDir, 'retry.gd');
        await fs.mkdir(dstDir, { recursive: true });
        await fs.writeFile(src, 'print("retry")');

        let attempts = 0;
        const originalWithRetry = (service as any).withRetry.bind(service);
        (service as any).withRetry = async (opName: string, fn: () => Promise<any>, retries?: number, baseDelayMs?: number) => {
            if (opName === 'copyFile(tmp)') {
                return await originalWithRetry(opName, async () => {
                    attempts++;
                    if (attempts <= 2) {
                        const err: any = new Error('busy');
                        err.code = 'EBUSY';
                        throw err;
                    }
                    return await fn();
                }, retries, 1);
            }
            return await originalWithRetry(opName, fn, retries, baseDelayMs);
        };

        await (service as any).copyFileAtomicWithRetry(src, dst);

        const content = await fs.readFile(dst, 'utf8');
        expect(content).toContain('retry');
        expect(attempts).toBeGreaterThanOrEqual(3);
        (service as any).withRetry = originalWithRetry;
    }, 15000);

    it('watcher handleError shows toast and stops', async () => {
        const showErrorSpy = vi.spyOn(vscode.window, 'showErrorMessage');

        (service as any).isRunning = true;
        await (service as any).handleError(new Error('boom'));
        expect(showErrorSpy).toHaveBeenCalled();
        expect(service.getIsRunning()).toBe(false);
        showErrorSpy.mockRestore();
    }, 8000);
});

async function delay(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
}

async function waitFor(predicate: (() => boolean) | (() => Promise<boolean>), timeoutMs = 15000, intervalMs = 50) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const ok = await Promise.resolve(predicate());
            if (ok) return;
        } catch (_e) {
            
        }
        await delay(intervalMs);
    }
    throw new Error('waitFor timeout');
}


