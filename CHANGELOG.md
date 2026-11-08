# Changelog

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
