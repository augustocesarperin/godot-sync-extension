VS Code extension to automatically synchronize user-specified files (scripts, assets, etc.) for game projects on godot.

## Features

*   Select source and target directories.
*   Configure file extensions to watch.
*   Start/Stop synchronization via UI or commands.
*   View synchronization log in the side panel.
*   Overwrite Protection: Skips copying if the destination file is newer.
*   Optional Deletion: File deletion in the target is disabled by default and can be enabled in the panel.

## How to Use

1.  Select your **Source** folder (where you edit files).
2.  Select your **Target** folder (your Godot project).
3.  Configure the comma-separated list of file **extensions** you want to sync (e.g., `.gd, .tscn, .res`).
4.  If needed, enable the **"Allow file deletion"** checkbox.
5.  Click **'Start Sync'**.

---
**Author:** Augusto Cesar Perin
**Publisher:** Abstratus Labs
**License:** MIT 