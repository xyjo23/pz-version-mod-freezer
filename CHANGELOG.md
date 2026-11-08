# Changelog

## 0.5.4-preview - 2026-11-08

- Applied the project icon to the WPF window title bar and Windows taskbar process group.
- Replaced the permanently visible version detail panel with an on-demand right-side flyout.
- The flyout opens only after selecting a version and closes through its close button or backdrop.
- Changed the successful current-version action from "Set as current" to a disabled "Current version" state.
- Marked the active frozen version in the version list and preserved Steam-specific button states.
- Added window-icon, flyout-open and current-button-state self-tests.

## 0.5.3-preview - 2026-11-08

- Added the live Steam-managed Project Zomboid installation to the version list by default.
- Detects Steam libraries, AppID 108600, game version, BuildID, Workshop project count and actual paths at startup.
- Keeps a visible "Steam original not detected" card with the detection error when discovery fails.
- Added direct Steam launch, Steam file validation and game-folder access for the Steam entry.
- Keeps the Steam entry ephemeral and separate from frozen-version configuration and migration targets.
- Added detected and not-detected UI self-tests for the Steam entry.

## 0.5.2-preview - 2026-11-08

- Reworked the interface into a compact dark launcher layout with top navigation.
- Promoted the selected version to a launch-focused main panel with a large primary action.
- Restyled the version list as dark selectable cards and kept Add Version in the upper-right.
- Restyled the migration workflow as a separate scrollable tool page.
- Moved directory/help shortcuts into the top navigation and condensed shared task status at the bottom.
- Credited PvzLauncher as a UI information-architecture reference; no upstream code or assets are included.

## 0.5.1-preview - 2026-11-08

- Split the interface into a primary Version tab and a secondary Migration & Freeze Tool tab.
- Moved Add Version to the upper-right corner of the Version tab.
- Replaced the compact version selector with a persistent version list and dedicated detail panel.
- Kept launch, verification, folder access and current-version selection together in the Version tab.
- Moved Steam sources, migration target, automatic migration, rollback and save backup into the migration tab.
- Kept task progress and user-facing logs in a shared status area for both workflows.

## 0.5.0-preview - 2026-11-08

- Added a persistent multi-directory frozen-version library.
- Added recursive profile discovery with a six-level scan limit and drive-root guard.
- Added version cards showing game version, Steam BuildID, MOD count and health.
- Added direct launch, integrity verification and folder opening for the selected version.
- Automatically sets the selected version as current before launch or verification.
- Added health checks for the frozen game executable, independent cache and SHA-256 manifest.
- Added path rebasing for frozen profiles moved with their complete directory.
- Added an isolated two-profile version-library fixture test.

## 0.4.1-preview - 2026-11-08

- Fixed empty migration targets being rejected as if they had to contain an existing frozen profile.
- Replaced separate full/incremental choices with automatic target detection.
- Existing valid frozen targets use incremental migration; empty targets use first-time full migration.
- Non-empty invalid targets are blocked to prevent unrelated files from being overwritten.
- Removed the generated background image to reduce package size.
- Added one outer version folder to the ZIP; it contains the EXE and `PZ-Freezer-Files`.

## 0.4.0-preview - 2026-11-08

- Changed the ZIP layout to place `PZ-Freezer.exe` beside a single versioned application folder.
- Added an original blurred survival-town background; no Project Zomboid artwork or logos are redistributed.
- Split the GUI into source, migration target and operation sections.
- Added dropdown operation pages for full migration, incremental migration and save backup.
- Added save discovery and selection for the active frozen profile.
- Added an external destination picker for save backups.
- Replaced whole-cache backup with selected-save ZIP backup while preserving every file inside that save.
- Excluded unrelated saves, logs, recordings, global settings and localized MOD assets from selected-save backups.
- Added an embedded backup manifest, sidecar metadata and SHA-256 for each backup.

## 0.3.0-preview - 2026-11-08

- Added a one-click Windows EXE launcher with an original project icon.
- Added in-app documentation so the GUI no longer opens README.md through a file association.
- Added user-facing current-step, next-step, elapsed-time, success and error-reason reporting.
- Filtered raw Robocopy and JSON output from the GUI operation log.
- Removed the automatic full save ZIP from incremental MOD migration; manual save backup remains available.
- Kept lightweight rollback metadata and SHA-256 records for every newly migrated file.
- Made failed integrity verification return a failed operation state in the GUI.

## 0.2.1-preview - 2026-11-08

- Added a visible current frozen-target path in the WPF interface.
- Added folder selection for an existing external manager root or frozen profile.
- Added automatic rebasing when a frozen profile was moved to a new location.
- Added detection of a single profile inside a selected parent directory.
- Added an ambiguity guard when a directory contains multiple profiles.
- Added external profiles to the version selector.

## 0.2.0-preview - 2026-11-08

- Added fast migration preview using path existence and file-size comparison.
- Added missing-only game file repair for exact matching game version/BuildID.
- Added missing Workshop Mod ID import into an existing frozen profile.
- Added duplicate Mod ID and dependency guards.
- Added migration-time save backup (removed in 0.3.0 after real-world performance testing).
- Added transaction records and safe rollback of the latest migration.
- Added incremental SHA-256 baseline updates for newly transferred files only.
- Added WPF controls for preview, migration and rollback.
- Added an isolated end-to-end migration/rollback fixture test.

## 0.1.0-preview - 2026-11-07

- Added WPF one-click interface and portable CMD launcher.
- Added Steam library, Project Zomboid, Workshop and save detection.
- Added B41/B42 MOD inventory, save MOD and dependency checks.
- Added independent game/cache/MOD snapshots outside `steamapps`.
- Added SHA-256 manifests and integrity verification.
- Added isolated launch through `-nosteam` and `-cachedir`.
- Added multiple profiles, save backup and safe restore.
- Added conservative frozen-copy-only Java memory tuning.
- Added runtime diagnostic log exclusions for integrity checks.
