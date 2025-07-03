//@ts-nocheck

// godot-sync-extension/src/webview/main.js

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const vscode = acquireVsCodeApi();

        const sourceDirInput = document.getElementById('sourceDir');
        const targetDirInput = document.getElementById('targetDir');
        const extensionsInput = document.getElementById('extensions');
        const allowDeletionCheckbox = document.getElementById('allowDeletion');
        const includeHiddenCheckbox = document.getElementById('includeHidden');
        const statusDiv = document.getElementById('status');
        const logArea = document.getElementById('logArea'); 
        const usePollingCheckbox = document.getElementById('usePolling');
        const syncImportFilesCheckbox = document.getElementById('syncImportFiles');
        const presetSelect = document.getElementById('presetSelect');
        const deletionWarning = document.getElementById('deletionWarning');
        const pollingBanner = document.getElementById('pollingBanner');
        const enablePollingNowBtn = document.getElementById('enablePollingNow');
        const dismissPollingBannerBtn = document.getElementById('dismissPollingBanner');
        const clearLogButton = document.getElementById('clearLogButton');

        if (!sourceDirInput || !targetDirInput || !extensionsInput || !statusDiv || !logArea || !allowDeletionCheckbox || !includeHiddenCheckbox) {
            console.error("[Webview] Erro CRÍTICO inicial: Elementos essenciais da UI faltando no DOM após setTimeout. Verifique os IDs no HTML e no main.js.");
            if (statusDiv) statusDiv.textContent = 'Error: Critical UI elements missing!';
            return; 
        }

        let currentSourceDir = '';
        let currentTargetDir = '';
        let currentExtensions = '';
        let allowDeletion = false;
        let isRunning = false;
        let includeHidden = false;
        let usePolling = false;
        let syncImportFiles = true;
        let currentPreset = 'none';

        function updateUIState() {
            if (!sourceDirInput || !targetDirInput || !extensionsInput || !statusDiv || !allowDeletionCheckbox || !includeHiddenCheckbox) {
                console.error("[Webview] updateUIState: Elementos de input ou statusDiv são null!");
                return;
            }
            const startButtonForUI = document.getElementById('startButton');
            const stopButtonForUI = document.getElementById('stopButton');
            const selectSourceButtonForUI = document.getElementById('selectSource');
            const selectTargetButtonForUI = document.getElementById('selectTarget');

            if (!startButtonForUI || !stopButtonForUI || !selectSourceButtonForUI || !selectTargetButtonForUI) {
                console.error("[Webview] updateUIState: Um ou mais botões são null! Isso pode ser normal durante a inicialização.");
            }

            sourceDirInput.value = currentSourceDir || '';
            targetDirInput.value = currentTargetDir || '';
            extensionsInput.value = currentExtensions || '';
            allowDeletionCheckbox.checked = allowDeletion || false;
            includeHiddenCheckbox.checked = includeHidden || false;
            if (usePollingCheckbox) usePollingCheckbox.checked = usePolling || false;
            if (syncImportFilesCheckbox) syncImportFilesCheckbox.checked = syncImportFiles || false;
            if (presetSelect) presetSelect.value = currentPreset || 'none';

            if (isRunning) {
                statusDiv.style.color = 'var(--vscode-editorWarning-foreground)';
                statusDiv.textContent = 'Status: Syncing...';
                if (startButtonForUI) startButtonForUI.disabled = true;
                if (stopButtonForUI) stopButtonForUI.disabled = false;
                if (sourceDirInput) sourceDirInput.disabled = true;
                if (targetDirInput) targetDirInput.disabled = true;
                if (extensionsInput) extensionsInput.disabled = true;
                if (selectSourceButtonForUI) selectSourceButtonForUI.disabled = true;
                if (selectTargetButtonForUI) selectTargetButtonForUI.disabled = true;
                if (allowDeletionCheckbox) allowDeletionCheckbox.disabled = true;
                if (includeHiddenCheckbox) includeHiddenCheckbox.disabled = true;
                if (usePollingCheckbox) usePollingCheckbox.disabled = true;
                if (syncImportFilesCheckbox) syncImportFilesCheckbox.disabled = true;
                if (presetSelect) presetSelect.disabled = true;
            } else {
                statusDiv.style.color = 'var(--vscode-foreground)';
                statusDiv.textContent = 'Status: Set Source & Target.';
                if (startButtonForUI) startButtonForUI.disabled = false;
                if (stopButtonForUI) stopButtonForUI.disabled = true;
                if (sourceDirInput) sourceDirInput.disabled = false;
                if (targetDirInput) targetDirInput.disabled = false;
                if (extensionsInput) extensionsInput.disabled = false;
                if (selectSourceButtonForUI) selectSourceButtonForUI.disabled = false;
                if (selectTargetButtonForUI) selectTargetButtonForUI.disabled = false;
                if (allowDeletionCheckbox) allowDeletionCheckbox.disabled = false;
                if (includeHiddenCheckbox) includeHiddenCheckbox.disabled = false;
                if (usePollingCheckbox) usePollingCheckbox.disabled = false;
                if (syncImportFilesCheckbox) syncImportFilesCheckbox.disabled = false;
                if (presetSelect) presetSelect.disabled = false;
            }

            // Show deletion warning only when allowDeletion is ON
            if (deletionWarning) {
                deletionWarning.style.display = allowDeletion ? 'block' : 'none';
            }
        }
        
        function addLogMessage(message) {
            if (!logArea) {
                console.error("[Webview] addLogMessage: logArea é null!");
                return;
            }
            const escapedMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            logArea.value += escapedMessage + '\n';
            logArea.scrollTop = logArea.scrollHeight;
        }

        function updateStatus(messageText, level = 'info') {
            if (!statusDiv) {
                console.error("[Webview] updateStatus: statusDiv é null!");
                return;
            }
            statusDiv.textContent = 'Status: ' + messageText;
            if (level === 'error') {
                statusDiv.style.color = 'var(--vscode-errorForeground)';
            } else if (level === 'warning') {
                statusDiv.style.color = 'var(--vscode-editorWarning-foreground)';
            } else {
                statusDiv.style.color = 'var(--vscode-foreground)';
            }
        }

        updateStatus('Initializing (delayed)...');

        const selectSourceButton = document.getElementById('selectSource');
        if (selectSourceButton) {
            selectSourceButton.addEventListener('click', () => {
                vscode.postMessage({ command: 'selectSourceFolder' });
            });
        } else {
            console.error('[Webview Setup] Botão selectSource NÃO ENCONTRADO antes do listener!');
        }

        const selectTargetButton = document.getElementById('selectTarget');
        if (selectTargetButton) {
            selectTargetButton.addEventListener('click', () => {
                vscode.postMessage({ command: 'selectTargetFolder' });
            });
        } else {
            console.error('[Webview Setup] Botão selectTarget NÃO ENCONTRADO antes do listener!');
        }

        const startButton = document.getElementById('startButton');
        if (startButton) {
            startButton.addEventListener('click', () => {
                if (!extensionsInput) {
                     console.error("[Webview] startButton click: extensionsInput é null!");
                     return;
                }
                const newVal = (extensionsInput.value || '').trim();
                if (newVal !== currentExtensions) {
                    currentExtensions = newVal;
                    vscode.postMessage({ command: 'updateExtensions', data: currentExtensions });
                }
                vscode.postMessage({ command: 'startSync' });
            });
        } else {
            console.error('[Webview Setup] Botão startButton NÃO ENCONTRADO antes do listener!');
        }

        const stopButton = document.getElementById('stopButton');
        if (stopButton) {
            stopButton.addEventListener('click', () => {
                vscode.postMessage({ command: 'stopSync' });
            });
        } else {
            console.error('[Webview Setup] Botão stopButton NÃO ENCONTRADO antes do listener!');
        }

        if (clearLogButton) {
            clearLogButton.addEventListener('click', () => {
                if (logArea) logArea.value = '';
                vscode.postMessage({ command: 'clearLog' });
            });
        }

        if (allowDeletionCheckbox) {
            allowDeletionCheckbox.addEventListener('change', () => {
                allowDeletion = allowDeletionCheckbox.checked;
                vscode.postMessage({
                    command: 'updateAllowDeletion',
                    data: allowDeletion
                });
                if (deletionWarning) {
                    deletionWarning.style.display = allowDeletion ? 'block' : 'none';
                }
            });
        }

        if (includeHiddenCheckbox) {
            includeHiddenCheckbox.addEventListener('change', () => {
                includeHidden = includeHiddenCheckbox.checked;
                vscode.postMessage({
                    command: 'updateIncludeHidden',
                    data: includeHidden
                });
            });
        }

        if (usePollingCheckbox) {
            usePollingCheckbox.addEventListener('change', () => {
                usePolling = usePollingCheckbox.checked;
                vscode.postMessage({
                    command: 'updateUsePolling',
                    data: usePolling
                });
            });
        }

        if (syncImportFilesCheckbox) {
            syncImportFilesCheckbox.addEventListener('change', () => {
                syncImportFiles = syncImportFilesCheckbox.checked;
                vscode.postMessage({
                    command: 'updateSyncImportFiles',
                    data: syncImportFiles
                });
            });
        }

        if (enablePollingNowBtn) {
            enablePollingNowBtn.addEventListener('click', () => {
                if (usePollingCheckbox) {
                    usePollingCheckbox.checked = true;
                    usePolling = true;
                    vscode.postMessage({ command: 'updateUsePolling', data: true });
                }
                if (pollingBanner) pollingBanner.style.display = 'none';
            });
        }

        if (dismissPollingBannerBtn) {
            dismissPollingBannerBtn.addEventListener('click', () => {
                if (pollingBanner) pollingBanner.style.display = 'none';
            });
        }

        if (presetSelect) {
            presetSelect.addEventListener('change', () => {
                currentPreset = presetSelect.value || 'none';
                vscode.postMessage({ command: 'updatePreset', data: currentPreset });
                // Fill only the input; user can edit before Start
                const map = {
                    none: '',
                    scripts: '.gd, .tscn, .tres, .res, .import, .shader, .json, .cfg',
                    minimal: '.gd, .tscn',
                    assets: '.png, .jpg, .jpeg, .ogg, .wav, .import'
                };
                const presetVal = map[currentPreset] || '';
                if (presetVal && extensionsInput) {
                    extensionsInput.value = presetVal;
                    currentExtensions = presetVal;
                    vscode.postMessage({ command: 'updateExtensions', data: currentExtensions });
                }
            });
        }

        let debounceTimer;
        if (extensionsInput) {
            extensionsInput.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    const newVal = (extensionsInput.value || '').trim();
                    if (newVal !== currentExtensions) {
                        currentExtensions = newVal;
                        vscode.postMessage({ command: 'updateExtensions', data: currentExtensions });
                    }
                }, 500);
            });
        } else {
            console.error("[Webview Setup] extensionsInput é null, não é possível adicionar listener de input!");
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateConfig':
                    currentSourceDir = message.data.sourceDir || '';
                    currentTargetDir = message.data.targetDir || '';
                    currentExtensions = message.data.extensions || '';
                    allowDeletion = message.data.allowDeletion || false;
                    includeHidden = message.data.includeHidden || false;
                    usePolling = message.data.usePolling || false;
                    syncImportFiles = (typeof message.data.syncImportFiles === 'boolean') ? message.data.syncImportFiles : true;
                    currentPreset = message.data.preset || 'none';
                    isRunning = message.data.isRunning || false;
                    if (logArea) {
                        logArea.value = message.data.logContent || '';
                        if (logArea.value) logArea.scrollTop = logArea.scrollHeight;
                    } else {
                        console.error("[Webview updateConfig] logArea é null!");
                    }
                    if (pollingBanner && !isRunning) {
                        const hint = message.data.envHint || {};
                        const remote = hint.remoteName || '';
                        const shouldHint = (remote && (remote.includes('wsl') || remote.includes('dev-container') || remote.includes('ssh'))) || hint.isUNC;
                        pollingBanner.style.display = shouldHint ? 'flex' : 'none';
                    }
                    updateUIState();
                    if (!isRunning && currentSourceDir && currentTargetDir) {
                        updateStatus('Ready. Press Start Sync.');
                    } else if (!isRunning) {
                        updateStatus('Set Source & Target.');
                    }
                    break;
                case 'updateSourceDir':
                    currentSourceDir = message.data;
                    if (sourceDirInput) sourceDirInput.value = currentSourceDir;
                    if (!isRunning && currentSourceDir && currentTargetDir) updateStatus('Ready. Press Start Sync.');
                    break;
                case 'updateTargetDir':
                    currentTargetDir = message.data;
                    if (targetDirInput) targetDirInput.value = currentTargetDir;
                    if (!isRunning && currentSourceDir && currentTargetDir) updateStatus('Ready. Press Start Sync.');
                    break;
                case 'updateStatus':
                    if (typeof message.data.isRunning === 'boolean') {
                        isRunning = message.data.isRunning;
                    }
                    if(message.data.logMessage) {
                        addLogMessage(message.data.logMessage);
                    }
                    if(message.data.statusMessage) {
                        updateStatus(message.data.statusMessage, message.data.level);
                    }
                    updateUIState();
                    break;
                case 'log':
                    if (message.data && typeof message.data === 'string') {
                        addLogMessage(message.data);
                    } else if (message.data && message.data.message) {
                        addLogMessage(message.data.message);
                    }
                    break;
                default:
                    break;
            }
        });

        vscode.postMessage({ command: 'webviewLoaded' });
        updateStatus('Initializing and loading config (delayed)...');

    }, 0);
});