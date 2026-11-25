# QA Run 06 — Atomic migration and installer lifecycle

## Outcome

Round 6 closed the two destructive-workflow gaps left by Round 5. Migrations now measure the required write size and safety reserve before copying, materialize into a hidden same-volume staging directory, and expose a version only through an atomic rename after all copy/configuration work succeeds. The Windows Setup and Portable artifacts were also exercised through a real install, upgrade, launch and uninstall lifecycle.

Final result: low-space, locked-file, stale-stage and forced-process-termination cases were blocked or recovered without exposing a partial version. Setup 0.8.5 installed into an isolated directory, upgraded in place to 0.8.6, launched after both stages and uninstalled cleanly. The 0.8.6 Portable artifact also launched from its extracted temporary location.

## Product fixes

### QA-014 — A failed migration occupied the final version name

- Severity: P1 data integrity.
- Before: copying happened directly inside `frozen`. A failure preserved evidence, but the half-written directory occupied the final name and could be mistaken for a version directory.
- Fix: migration now writes to `<manager>/.staging/<version>.pzvault-stage`. Only a complete staged version is renamed into `frozen`. Failed work moves to `<manager>/incomplete` with an explicit diagnostic path.
- Registration boundary: `current-freeze.json` and activation are no longer written by the staging configuration step. The complete final directory becomes visible first, then normal activation runs.

### QA-015 — Process termination had no deterministic recovery proof

- Severity: P1 crash consistency.
- Test: an independent Electron worker completed staging, wrote its ready signal and paused immediately before atomic commit. The harness forcibly terminated that process.
- Evidence after termination: no new directory appeared under `frozen`; the prior active version remained unchanged; exactly one hidden staging directory remained.
- Recovery: a second worker using the same request archived the abandoned stage into `incomplete`, rebuilt the version and committed it successfully.

### QA-016 — Available space was described but not enforced

- Severity: P1 predictable migration failure.
- Fix: the planner measures source bytes, adds metadata allowance and a safety reserve, then compares the total with filesystem-available bytes. An unknown or insufficient result blocks execution.
- UI: the migration preview now states estimated write bytes, safety reserve and current available bytes in plain language.
- Fault injection: one available byte was injected into an isolated run. Preview returned `canRun: false`, displayed the space blocker and created neither staging nor final directories.

## Installer lifecycle evidence

The test first confirmed that the current Windows user had no existing matching uninstall entry or default installation directory.

- Setup 0.8.5 silent clean install to an isolated `E:\zptest` directory: PASS; executable product version 0.8.5.0 and uninstaller present.
- Installed 0.8.5 native launch: PASS; the dashboard rendered and detected Steam 42.22.2 / Build 26486631.
- Setup 0.8.6 in-place upgrade to the same directory: PASS; product/file versions changed to 0.8.6.
- Installed 0.8.6 native launch: PASS; the migration preview displayed estimated write, safety reserve and currently available space. The execute button was not pressed.
- Silent uninstall: PASS; executable, install directory and HKCU uninstall entry were removed.
- Portable 0.8.6 launch: PASS; the process launched from its temporary extraction directory and rendered the dashboard.

## Regression evidence

- Standard automated suite: 35 passed, 1 Windows symlink-permission skip, 0 failed.
- Migration fixture: full/thin success, duplicate target, disk-space blocker, exclusive file lock, abandoned-stage recovery, thin-chain guard and missing-reference detection passed.
- Forced-termination harness: process killed before commit, partial version hidden, prior active preserved, stage archived and same request recovered.
- Integrity/compatibility, external import and shared-package filesystem fixtures all passed after the transaction refactor.

## Explicit limitations

The forced-stop test kills the application process at the defined pre-commit boundary; it does not simulate sudden power loss, storage-device removal or filesystem corruption during the atomic rename itself. Project Zomboid Steam/frozen launches through the game main menu and multiplayer remain separate real-game gates. Release binaries are still unsigned because no publisher signing certificate is configured.
