# QA Run 07 — Real game launch and startup evidence

## Outcome

Round 7 exercised the live Steam installation and the formal frozen build through the actual Project Zomboid main menu. Both launches succeeded after the launcher learned to distinguish a running Steam process from an authenticated, usable Steam session.

Final result: Steam original reached the main menu as `42.22.2 / 3d39148846 / pzBullet 1.0.0.28 (Steam)`. The formal frozen build at `E:\apps\games\zproject\frozen\B42.21.0_build25485521_20261104_195505` reached the main menu as `42.21.0 / 4a0e9546ec / pzBullet 1.0.0.28 (Steam)`. Both were exited through the game's normal confirmation dialog. No save was loaded and no multiplayer server was joined.

## Product fixes

### QA-017 — Launch returned success before a game process existed

- Severity: P1 false success.
- Before: Steam launch returned immediately after opening `steam://run/108600`; frozen launch passed after only two seconds of process survival.
- Fix: every launch now writes a timestamped JSON receipt with source, expected identity, executable, arguments, PID, observation result, console path and only the severe lines added during that observation.
- Steam behavior: the launcher waits up to 120 seconds for `ProjectZomboid64.exe`, then observes the detected PID. This covers Steam cold start and its explicit launch-option window.
- Frozen behavior: full and thin versions now use the same native observation path instead of allowing full copies to bypass it through the legacy PowerShell engine.
- Boundary: the UI and receipt explicitly state that process survival does not prove main-menu, save-load or multiplayer success.

### QA-018 — A Steam process was mistaken for a usable Steam session

- Severity: P1 launch blocker.
- Reproduction: after Steam had closed, launching the frozen build produced `SteamAPI_Init() failed`. Starting `steam.exe` alone then exposed a second false-ready state while Steam still displayed its login window.
- Fix: frozen launch now ensures `steam.exe` and `steamwebhelper.exe` exist and requires the Steam `ActiveUser` registry value to be non-zero before spawning the frozen executable.
- Authentication boundary: the launcher opens and waits for Steam, but never fills credentials. A session that does not become logged in within the timeout returns an explicit retry instruction.

### QA-019 — Benign FMOD text was reported as a severe error

- Severity: P2 diagnostic false positive.
- Before: substring matching treated FMOD lines ending in `No errors.` as error evidence.
- Fix: the extractor now requires whole severity words such as `ERROR`, `FATAL`, `Exception`, `OutOfMemory` or `EXCEPTION_ACCESS_VIOLATION`. The regression test contains both `No errors.` and a real `ERROR:` line and keeps only the latter.

## Real-game evidence

### Steam original

- Launcher identity before start: version `42.22.2`, Build `26486631`.
- Cold-start behavior: Steam opened its three-choice launch dialog. The default `Play Project Zomboid` option was confirmed manually.
- Visible main-menu identity: `42.22.2 3d39148846 pzBullet(1.0.0.28) (Steam)`.
- Exit: normal in-game `退出游戏` flow and confirmation; process terminated.

### Formal frozen build

- Launcher identity before start: version `42.21.0`, Build `25485521`.
- Executable: the frozen build's own `game\ProjectZomboid64.exe`.
- Runtime data: `-cachedir=` pointed to the frozen build's own `cache` directory.
- Visible main-menu identity: `42.21.0 4a0e9546ec pzBullet(1.0.0.28) (Steam)`.
- Exit: normal in-game `退出游戏` flow and confirmation; process terminated.

## Regression evidence

- Launch suite: argument sanitation, task-list parsing, process survival, early exit, absent process, cold Steam start, already-ready Steam and unauthenticated Steam states passed.
- Standard automated suite: 42 passed, 1 Windows symlink-permission skip, 0 failed.
- TypeScript typecheck and production renderer/main/preload build passed.
- Packaged Portable 0.8.7 launched from its extracted temporary directory, rendered the formal frozen version dashboard and exited normally.
- Help now explains Steam login ownership, Steam's launch-option dialog, receipt location, evidence limits and the difference between process survival and main-menu success.

## Explicit limitations

Static and startup observation cannot prove save loading, a specific server handshake or runtime MOD behavior. This round intentionally stopped at the main menu: it did not enter a save, create a server, join a third-party server or change Steam login settings. A later multiplayer round must use an agreed test server and matched game/MOD set.
