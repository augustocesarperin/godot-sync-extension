import * as vscode from 'vscode';
import { GodotSyncViewProvider } from './GodotSyncViewProvider';

let viewProvider: GodotSyncViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
    viewProvider = new GodotSyncViewProvider(context.extensionUri, context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            GodotSyncViewProvider.viewType,
            viewProvider
        )
    );

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
            vscode.commands.executeCommand('workbench.view.extension.godot-sync-activitybar');
        })
    );

    context.subscriptions.push(viewProvider);
}

export function deactivate() {
    if (viewProvider) {
        viewProvider = undefined;
    }
}