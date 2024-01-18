// godot-sync-extension/src/webview/main.js
// @ts-ignore

// Adquirir a API do VS Code para comunicação
const vscode = acquireVsCodeApi();

// Elementos da UI
const sourceDirInput = document.getElementById('sourceDir');
const targetDirInput = document.getElementById('targetDir');
const extensionsInput = document.getElementById('extensions');
const selectSourceButton = document.getElementById('selectSource');
const selectTargetButton = document.getElementById('selectTarget');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const logArea = document.getElementById('logArea');
const statusDiv = document.getElementById('status');

// Estado local (para evitar salvar estado na API do VSCode a cada keypress)
let currentSourceDir = '';
let currentTargetDir = '';
let currentExtensions = '';
let isRunning = false;

// --- Funções de Atualização da UI ---

function updateUIState() {
    sourceDirInput.value = currentSourceDir || '';
    targetDirInput.value = currentTargetDir || '';
    extensionsInput.value = currentExtensions || '';

    if (isRunning) {
        statusDiv.textContent = 'Status: Running';
        statusDiv.style.color = 'var(--vscode-debugIcon-startForeground)';
        startButton.disabled = true;
        stopButton.disabled = false;
        sourceDirInput.disabled = true;
        targetDirInput.disabled = true;
        extensionsInput.disabled = true;
        selectSourceButton.disabled = true;
        selectTargetButton.disabled = true;
    } else {
        statusDiv.textContent = 'Status: Stopped';
        statusDiv.style.color = 'var(--vscode-debugIcon-stopForeground)';
        startButton.disabled = false;
        stopButton.disabled = true;
        sourceDirInput.disabled = false;
        targetDirInput.disabled = false;
        extensionsInput.disabled = false;
        selectSourceButton.disabled = false;
        selectTargetButton.disabled = false;
    }
}

function addLogMessage(message) {
    const escapedMessage = message.replace(/</g, "<").replace(/>/g, ">"); // Sanitize
    logArea.value += escapedMessage + '\n';
    logArea.scrollTop = logArea.scrollHeight; // Auto-scroll
}

// --- Tratamento de Eventos da UI ---

selectSourceButton.addEventListener('click', () => {
    vscode.postMessage({ command: 'selectSourceFolder' });
});

selectTargetButton.addEventListener('click', () => {
    vscode.postMessage({ command: 'selectTargetFolder' });
});

startButton.addEventListener('click', () => {
    // Salvar as extensões atuais antes de iniciar
    currentExtensions = extensionsInput.value;
    vscode.postMessage({
        command: 'updateExtensions',
        data: currentExtensions
    });
    // Pedir para iniciar (a extensão usará os valores salvos)
    vscode.postMessage({ command: 'startSync' });
});

stopButton.addEventListener('click', () => {
    vscode.postMessage({ command: 'stopSync' });
});

// Salvar extensões quando o usuário parar de digitar (debounce)
let debounceTimer;
extensionsInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        currentExtensions = extensionsInput.value;
        vscode.postMessage({
            command: 'updateExtensions',
            data: currentExtensions
        });
    }, 500); // Salva 500ms após parar de digitar
});

// --- Tratamento de Mensagens da Extensão ---

window.addEventListener('message', event => {
    const message = event.data; // Dados enviados pela extensão

    switch (message.command) {
        case 'updateConfig':
            currentSourceDir = message.data.sourceDir || '';
            currentTargetDir = message.data.targetDir || '';
            currentExtensions = message.data.extensions || '';
            isRunning = message.data.isRunning || false;
            logArea.value = message.data.logContent || ''; // Carregar log inicial
             if (logArea.value) logArea.scrollTop = logArea.scrollHeight;
            updateUIState();
            break;
        case 'updateSourceDir':
            currentSourceDir = message.data;
            sourceDirInput.value = currentSourceDir;
            // Não precisa salvar aqui, a extensão já salvou
            break;
        case 'updateTargetDir':
            currentTargetDir = message.data;
            targetDirInput.value = currentTargetDir;
             // Não precisa salvar aqui, a extensão já salvou
            break;
        case 'updateStatus':
            isRunning = message.data.isRunning;
            updateUIState();
            break;
        case 'log':
            addLogMessage(message.data);
            break;
    }
});

// --- Inicialização ---

// Informar à extensão que o webview está pronto para receber a configuração
vscode.postMessage({ command: 'webviewLoaded' });