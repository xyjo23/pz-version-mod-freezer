# QA Run 05 — Packaged workflows and fault injection

## Outcome

Round 5 tested the Windows packaged application and the filesystem failure paths that were still deferred after Round 4. The release candidate now keeps blocking dialogs isolated from background controls, supports keyboard focus containment, imports external versions through a testable service path, lays out high-count radar entries without overlap, and reports locked or unreadable files as evidence instead of silently passing them.

Final result: the automated suite, isolated filesystem fixtures, real Steam read-only analysis and packaged native UI checks passed. Disk-full simulation, forced process termination, installer upgrade and uninstall are still explicitly deferred; they are not represented as passed.

## Product fixes

### QA-010 — Hidden drawers and modal backgrounds remained reachable

- Severity: P1 accessibility and input isolation.
- Before: hidden detail/MOD drawers and background controls could remain present in the Windows accessibility tree. A terminal shortcut could also remain reachable while a help dialog was open.
- Fix: hidden drawers are inert and excluded from accessibility. Blocking dialogs trap Tab/Shift+Tab, receive initial focus, restore the previous focus on close, and make the title bar, workspace and terminal entry inert.
- Packaged evidence: the help dialog exposed only its own controls; Escape returned visible focus to the originating help card.

### QA-011 — External import trusted stale or malformed metadata

- Severity: P1 data identity.
- Before: dialog-only entry points were difficult to test, malformed metadata could be partially interpreted, and imported paths could retain another machine's manager root.
- Fix: import delegates to an explicit-path service, validates the required game/cache structure and metadata object, normalizes the external origin, and persists relocated paths when activated.
- Fixture evidence: one valid external version imported and activated; two invalid candidates and one duplicate were skipped; normalized paths survived a new snapshot.

### QA-012 — Radar capacity was fixed at 49 positions

- Severity: P2 visual correctness.
- Before: large registries could reuse positions or push points outside the intended radar area.
- Fix: positions now use a deterministic golden-angle layout constrained to the radar bounds.
- Unit evidence: 80 identical candidates produced 80 unique positions, all inside the 13–87 percent boundary.

### QA-013 — Locked or unreadable files could not be reproduced deterministically

- Severity: P1 report accuracy.
- Fix: Windows-only helpers now hold an exclusive file lock or temporarily deny read access. Integrity analysis records the unreadable file, produces `FULL-FILE-READABLE`, and returns to pass after release/restoration. Migration failure retains the partial target for diagnosis instead of registering it as a completed version.

## Packaged native UI evidence

- Setup/Portable production build: PASS; both x64 artifacts generated from the final source tree.
- Window frame: maximize, restore, minimize and return passed; 980×640 minimum-size help layout remained usable.
- Navigation: Console, Version Registry, Maintenance, Help and Settings traversed in the packaged build.
- Help: modal isolation, Tab wrapping, Escape close, focus restoration, scrollable small-window layout and topic reset passed.
- Settings: radar/terminal/save-protection state survived restart; onboarding did not reappear.
- External import: the native folder picker opened at the configured external version location and cancelled cleanly. The actual import/activation path is covered by the filesystem fixture to avoid polluting the user's registry.
- Analysis selector: Integrity and Compatibility workspaces replaced one another correctly; the responsibility popover clearly described their boundary. No Steam verification action was triggered.

## Filesystem and analysis evidence

- Automated suite: 35 passed, 1 Windows symlink-permission skip, 0 failed.
- Migration fixture: full and thin migrations passed; duplicate/missing-reference/thin-chain guards passed; an exclusively locked source caused a real copy failure and retained the incomplete target without registration.
- Integrity/compatibility fixture: clean, changed, missing, added, empty-baseline, exclusive-lock and ACL-denied states passed; dependency, cycle, order, tiledef and semantic-overlap rules passed.
- External import fixture: valid import, invalid metadata, duplicate suppression, activation and normalized persistence passed.
- Shared-package fixture: creation, transfer, inspection, verified install, repeated-install guard, tamper, missing MOD, drift, weak game identity and quarantine all passed.
- Real Steam read-only analysis: Project Zomboid 42.22.2 / Build 26486631 / revision `3d39148846`; 100 Workshop items and 129 installed MOD roots were enumerated. The configured list contained one real missing-MOD blocker. Steam verification was not invoked.

## Explicit limitations

The following scenarios remain deferred because they require destructive or environment-specific validation: disk exhaustion during a game-sized migration, forced process termination during commit, signed publisher identity, installer upgrade/uninstall, and launching both Steam and frozen games through to the main menu. Round 5 does not claim those controls as passed.
