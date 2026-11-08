# Changelog

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
- Added automatic save backup before migration.
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
