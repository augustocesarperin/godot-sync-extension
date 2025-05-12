[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/AbstratusLabs.godot-sync?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=AbstratusLabs.godot-sync)
[![Visual Studio Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/AbstratusLabs.godot-sync?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=AbstratusLabs.godot-sync)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE.txt)

VS Code extension to automatically synchronize user-specified files (scripts, assets, etc.) for game projects on godot.

## Features

*   Select source and target directories.
*   Configure file extensions to watch.
*   Start/Stop synchronization via UI or commands.
*   View synchronization log in the side panel.
## Installation

install directly from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AbstratusLabs.godot-sync).

## How to Use

1.  Open the Godot Sync panel from the Activity Bar.
2.  Select the Source and Target (Godot project) folders.
4.  Click 'Start Sync'.
5.  Files matching the extensions created/modified/deleted in the source folder will be copied/deleted in the target folder.

## Development

*   `npm install`
*   `npm run build`
*   Press F5 in VS Code to launch the Extension Development Host.

## Author

Augusto Cesar Perin (Abstratus Labs).

## License

MIT
