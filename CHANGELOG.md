# Changelog

## 0.6.3-preview - 2026-11-11

- Fixed long current-version names overflowing into the console radar at non-maximized window sizes.
- Made the current-version name use the same click-to-reveal behavior as version-list names.
- Removed the duplicate MOD list, backup and operation-log shortcuts from the bottom of the console.
- Changed the Effective Mods metric into an in-app drawer instead of opening a system folder.
- Added native scanning of Steam and frozen MOD directories with human-readable names parsed from `mod.info`.
- Kept Workshop IDs and MOD IDs as secondary metadata in the MOD drawer.
- Renamed Recent Backup to Backup Information and transferred the backup-folder action to that metric card.

## 0.6.2-preview - 2026-11-11

- Simplified Version Management into a user-selectable radar or single-column list view.
- Removed explanatory blocks from the full radar and changed it to a centered square canvas.
- Extended the radar sweep to the outer boundary.
- Added a persistent Settings toggle for radar versus list mode.
- Changed version cards to one version per row and moved Workshop, MOD and time metadata into hover details.
- Made healthy cards open Version Details on click; unhealthy versions are grey and non-interactive.
- Added 24-character version-name truncation with click-to-reveal and outside-click dismissal.
- Made Version Details work for any selected Steam or frozen version, not only the active version.

## 0.6.1-preview - 2026-11-10

- Fixed legacy frozen versions disappearing when `freeze.json` contains a UTF-8 BOM.
- Unified Steam original and frozen versions under one current-version state.
- Added user-defined version names as the primary title throughout the application.
- Added compact and full relative version radars with hover details and double-click switching.
- Added current-version Mods, Saves, backup and log shortcuts to the console.
- Renamed Environment Details and Summary to Version Details and Summary.

## 0.6.0-preview - 2026-11-10

- Added native Steam AppID 108600 discovery.
- Added safe full-copy migration from Steam or frozen sources.
- Added experimental hard-link reuse for frozen sources with copy fallback.
- Added SHA-256 manifests, native launch and integrity verification.
- Added first-run save-snapshot guidance and pre-migration mutable-data backups.
- Rebuilt the desktop interface around Console, Version Management, Maintenance, Help and Settings.
