# Godot Sync Extension

VS Code extension to automatically synchronize files between a source folder (like editor scripts) and a Godot project folder.

## Features

*   Select source and target directories.
*   Configure file extensions to watch.
*   Start/Stop synchronization via UI or commands.
*   View synchronization log in the side panel.
*   Settings are persisted.
*   Runs in the background.

## How to Use

1.  Open the Godot Sync panel from the Activity Bar (Sync icon).
2.  Select the Source and Target (Godot project) folders.
3.  Adjust the comma-separated list of extensions if needed.
4.  Click 'Start Sync'.
5.  Files matching the extensions created/modified/deleted in the source folder will be copied/deleted in the target folder.

## Development

*   
pm install
*   
pm run compile or 
pm run watch
*   Press F5 in VS Code to launch the Extension Development Host.
