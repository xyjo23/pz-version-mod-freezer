# Changelog

## Unreleased

- Added a safe MOD loadout planner for explicit save and server contexts with local draft toggles, dependency completion and deterministic topological ordering.
- Added revalidated, token-bound loadout previews that block missing dependencies, duplicate IDs, active incompatibilities, order cycles, unusable B42 layers, invalid version ranges, incomplete evidence, unverified game identity and stale source files.
- Added atomic save/server list updates with crash-safe receipts, hash-guarded one-step undo and no MOD file deletion, download or execution.
- Added a dedicated browse-by-default MOD Center backed by a fresh unified-catalog rebuild for the active Steam or frozen version.
- Added search and evidence filters for active, inactive, problematic, binary-bearing, Workshop and local MODs.
- Added per-MOD B42 layer resolution, dependency and reverse-dependency views, installed incompatibility evidence, file-kind counts and content digests.
- Kept MOD Center IPC payloads bounded to summary evidence instead of transferring every scanned file to the renderer.
- Added version-bound MOD profiles for saves and server configurations, including ordered Mod IDs, Workshop IDs and catalog evidence.
- Added compare-before-write previews with missing-install, game-identity and context-format blockers plus explicit enable, disable and order differences.
- Added digest-verified `.pzprofile` import/export with local save paths removed from exported files.
- Added atomic profile application, crash-safe `Prepared`/`Applied` receipts and hash-guarded one-step undo that refuses to overwrite later user changes.
- Added a rebuildable MOD catalog containing Workshop/Mod IDs, B42 effective layers, dependency indexes, per-file SHA-256 evidence and explicit JAR/Class/native-binary inventories.
- Added catalog completeness boundaries for unresolved variants, missing Mod IDs, unreadable or changing files, and safely skipped directory links.
- Connected the catalog digest, coverage and binary counts to compatibility reports and the maintenance UI.
- Added deterministic catalog tests, including same-size/same-mtime content replacement and directory-link escape protection, plus a real-directory read-only scanner.
- Prevented version activation from rewriting another manager library when multiple libraries are registered.
- Made external imported versions read-only during activation and confined their runtime reports, backups and manifests to the imported version directory.
- Added a shared atomic JSON writer with unchanged-content detection, serialized concurrent writes, rollback recovery and legacy-pointer backups.
- Enforced lexical and real-path ownership checks so directory links cannot redirect managed writes outside the selected library.
- Revalidated the manager root immediately before migration and activated committed versions by absolute path to avoid cross-library name collisions.
- Routed shared-package status updates through the same managed-version ownership checks.
- Added safety, multi-library activation and external-import regression coverage plus a documented write-safety matrix.

## 0.8.0-preview - 2026-11-24

- Added the `.pzshare` v1 workflow for creating, inspecting and installing auditable shared version manifests without embedding game, MOD, save or account data.
- Added strict schema validation, canonical SHA-256 package digests, per-MOD directory fingerprints and exact reconstruction matching for game identity, Workshop IDs, Mod IDs and load order.
- Added post-install verification and a fail-closed quarantine state that prevents mismatched shared versions from being activated or launched.
- Added read-only integrity checks for shared-package operations so inspecting a package never starts Steam file validation.
- Separated Integrity and Compatibility workspaces with clearer evidence levels and plain-language reports.
- Unified Steam, managed and imported versions in the global version registry and kept Steam visually consistent with frozen versions.
- Added automated shared-package format, fingerprint, matching and end-to-end round-trip tests.

## 0.7.1-preview - 2026-11-23

- Allowed Quick Thin Version creation when a save or server context references already-missing Mod IDs; the analysis report keeps the missing evidence while the migration links every currently installed MOD.
- Corrected thin-version effective MOD counts to use materialized Mod IDs instead of the stale requested list.
- Displayed the real referenced game path, independent cache and backup path in thin-version details.
- Replaced the Help placeholders with six complete in-app tutorials covering first run, switching, migration, B42 MOD analysis and recovery.
- Added a practical full-copy and quick-migration test guide.
- Revalidated both a Full Copy and a Thin Reference against Project Zomboid 42.22.2 / revision `3d39148846`; both reached the main menu and exited normally.

## 0.7.0-preview - 2026-11-20

- Replaced cached text version detection with binary identity parsing for B42 version, revision and `Core.jar` SHA-256 evidence.
- Added the B42 MOD layout resolver, Workshop/Mod ID database, dependency graph, missing/circular dependency checks and semantic file-overlap analysis.
- Added save and server configuration comparison with blocker, warning, unknown and pass evidence levels.
- Added Quick Thin Versions: reuse an immutable frozen game, independently copy mutable cache data and materialize active MODs with NTFS hard links.
- Added ASCII technical directory IDs while preserving Unicode display names, avoiding Project Zomboid `-cachedir` path corruption.
- Added base-version, missing-reference and wrong-hard-link health checks, plus early launch survival verification with PID evidence.
- Added cross-volume copy fallback estimates and explicit blocking for obsolete junction-based or non-ASCII thin versions.
- Added repeatable migration and destructive regression harnesses covering dependency loss, wrong links, cache isolation and repeated launches.
- Verified the final profile against Project Zomboid 42.22.2 in the real game UI, including a populated in-game MOD list.

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
