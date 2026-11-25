# QA Run 02 — Filesystem, analysis and launch identity

## Outcome

Round 2 exercised the data layer with isolated real filesystem mutations and read-only analysis of the installed Steam/Workshop data. It fixed one P1 launch-identity defect and one P2 report-accuracy defect. No user version library, save, Workshop file or Steam installation was modified.

## Fixed findings

### QA-003 — Frozen versions disabled Steam identity

- Severity: P1
- Before: newly created and legacy frozen configurations inserted `-nosteam`, while the launcher and help text stated that frozen versions retained Steam identity.
- Risk: Steam friends, invitations and Steam-backed multiplayer could not work as described.
- Fix: frozen launch arguments now remove legacy `-nosteam`, preserve unrelated arguments and enforce exactly one current `-cachedir` argument.
- Regression: new, legacy and duplicate-cache argument fixtures passed. Isolated full-copy and thin migrations both produced only their own `-cachedir` argument.

### QA-004 — Read-only Steam integrity methodology contradicted the result

- Severity: P2
- Before: `submitSteamValidation: false` correctly avoided Steam validation, but the methodology still claimed that a validation request had been submitted.
- Risk: the report could overstate what actually ran and confuse an identity check with official file verification.
- Fix: methodology and limitations are now generated from the executed mode. Read-only reports explicitly say that no Steam request was submitted and that file integrity cannot be declared passed.
- Regression: the real read-only Steam analysis asserts both statements.

## Isolated migration evidence

The successful fixture root was `E:\zptest\test20261125-round2-migration-04`. It and the failed retry roots were moved to the Recycle Bin after evidence was recorded.

- Full copy created independent game, cache, save and MOD files.
- Changing the copied `options.ini` did not change the source.
- Thin migration selected the enabled MOD and its recursive dependency: 2 referenced roots.
- Full and thin metadata contained a current isolated `-cachedir` and no `-nosteam`.
- Reusing an existing target name was blocked.
- Creating a thin version from another thin version was blocked.
- Removing a referenced MOD target made the version unhealthy immediately.
- Restoring the target returned native thin verification to PASS.

## Real Steam and Workshop analysis

The read-only run wrote reports under `E:\zptest\test20261125-round2-analysis-03` and did not submit Steam validation. The temporary report root was moved to the Recycle Bin after the assertions and summary were recorded.

- Game identity: `42.22.2`, Build `26486631`, revision `3d39148846`.
- Binary and cache identity agreed; projectzomboid.jar SHA-256 was recorded.
- Installed content: 129 MOD roots across 100 Workshop projects.
- Selected scope: latest save `2026-11-15_14-17-01`, containing 217 configured Mod IDs.
- Result: one blocker because 98 IDs referenced by that save are no longer present in the scanned installation. This is scoped to that save and is not presented as damage to unrelated saves.
- File overlap scan: 440 paths, including 58 byte-identical overlaps excluded from risk conclusions.

## Automated regression

- Share package: 19 passed, 1 Windows symlink-permission skip.
- Launch arguments: 3 passed.
- B42 MOD resolver: 3 passed.
- Quick migration planner/materializer: 2 passed.
- Radar layout: 3 passed.
- TypeScript and production build remain required release gates.

## Explicit limitations

This round did not launch Project Zomboid, join a multiplayer server, submit Steam official file validation, install a release package or test upgrade/uninstall behavior. Removing `-nosteam` restores the required Steam-capable launch mode; an actual multiplayer session remains a later game-launch gate.
