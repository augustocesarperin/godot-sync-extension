import * as vscode from 'vscode';
import { GodotSyncViewProvider } from './GodotSyncViewProvider'; // Importa nosso provider

let viewProvider: GodotSyncViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "godot-sync" is now active!');

    // Criar e registrar o provedor da Webview
    viewProvider = new GodotSyncViewProvider(context.extensionUri, context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            GodotSyncViewProvider.viewType, // ID da view definido no package.json
            viewProvider
        )
    );

    // Registrar comandos da Command Palette
    context.subscriptions.push(
        vscode.commands.registerCommand('godotSync.start', () => {
            viewProvider?.startSync();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('godotSync.stop', () => {
            viewProvider?.stopSync();
        })
    );

     context.subscriptions.push(
        vscode.commands.registerCommand('godotSync.selectSource', () => {
             viewProvider?.selectFolder('godotSync.sourceDir', 'updateSourceDir');
        })
    );

     context.subscriptions.push(
        vscode.commands.registerCommand('godotSync.selectTarget', () => {
            viewProvider?.selectFolder('godotSync.targetDir', 'updateTargetDir');
        })
    );

     context.subscriptions.push(
        vscode.commands.registerCommand('godotSync.openPanel', () => {
            // Tenta focar no container da view na Activity Bar
            vscode.commands.executeCommand('workbench.view.extension.godot-sync-activitybar');
            // A view deve ser focada automaticamente ao abrir o container,
            // mas se precisar de foco explícito:
            // setTimeout(() => vscode.commands.executeCommand('godotSyncView.focus'), 200);
        })
    );

    // Adicionar o provider aos disposables para limpeza ao desativar
    context.subscriptions.push(viewProvider);
}

// Método chamado quando a extensão é desativada
export function deactivate() {
    console.log('Deactivating "godot-sync" extension.');
    // A limpeza do SyncService é feita no dispose do viewProvider
    viewProvider = undefined;
}