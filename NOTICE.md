# Third-party acknowledgements

PZ Version & Mod Freezer is independently implemented. No source files from the projects below are included in this repository. Their ideas and public documentation informed the product design, so they are credited here.

## PZ Backup

- Project: PZ-Wiki-Modding/PZ-Backup
- Author credited by the upstream project: SimKDT
- Source: https://github.com/PZ-Wiki-Modding/PZ-Backup
- License: upstream custom open-source license
- How it influenced this project: copying a Project Zomboid installation and cache, localizing Workshop mods, and launching through `-nosteam` plus an independent `-cachedir`.
- Code copied: none

Upstream license: https://github.com/PZ-Wiki-Modding/PZ-Backup/blob/main/LICENSE

## Steam Update Freezer

- Project: mysteriousdev777/steam-update-freezer
- Copyright: 2026 mysteriousdev777
- Source: https://github.com/mysteriousdev777/steam-update-freezer
- License: MIT
- How it influenced this project: automatic Steam library discovery, explicit safety checks, reversible operations and clear user-facing state.
- Code copied: none

Upstream license: https://github.com/mysteriousdev777/steam-update-freezer/blob/prod/LICENSE

PZ Version & Mod Freezer does **not** use the manifest-locking or manifest-rewriting technique of Steam Update Freezer. It creates independent file copies outside Steam-managed directories.

## PvzLauncher

- Project: PvzLauncher/PvzLauncher
- Source: https://github.com/PvzLauncher/PvzLauncher
- License: GPL-3.0
- How it influenced this project: top navigation, a launch-focused main view, separation of launch and management responsibilities, and a prominent local-import entry.
- Code copied: none
- Assets copied: none

The dark theme, layout measurements, controls and implementation in PZ Version & Mod Freezer were created independently for this project.
