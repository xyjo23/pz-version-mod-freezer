# QA Run 04 — Real shared-package reconstruction

## Outcome

Round 4 closed the gap between shared-package format tests and the actual disk workflow. An isolated sender library created a real `.pzshare`; an independent receiver library inspected, matched and installed it. The test used a real Project Zomboid 42.21.0 `projectzomboid.jar` for binary version, revision and SHA-256 identity evidence.

Final result: the valid package installed as `Verified`; every injected unsafe state was blocked; an installation changed after copying was retained as `Quarantined` and could not be activated as a healthy version.

## Product fixes

### QA-007 — Shared-package service had no deterministic filesystem entry points

- Severity: P1
- Before: automated coverage could validate the JSON format and matching rules, but creating and receiving a package required native dialogs. The actual service, migration, registration and receipt-writing path was not exercised end to end.
- Fix: the dialog workflow now delegates to explicit-path service functions. Production UI behavior is unchanged; tests can run the same creation, inspection and installation implementation against isolated directories.
- Evidence: `scripts/share-package-fixture-e2e.ts` creates, transfers, inspects and installs a real package through the service.

### QA-008 — Repeated package installation was detected too late

- Severity: P2
- Before: a verified package could pass inspection again and only fail when migration discovered the deterministic target directory already existed.
- Fix: inspection checks verified version receipts by Package ID and digest. A repeated install now produces the explicit blocker `这个共享包已经安装` before copying.
- Collision handling: the same Package ID with a different digest is also blocked and explained as an identity collision.

### QA-009 — Ordinary migrations inherited shared-package trust metadata

- Severity: P1
- Before: a full copy made from a shared version inherited `ShareInstallStatus`, `SharePackageID` and `SharePackageDigest` from its source configuration, even though the new migration had not completed the shared-package verification workflow.
- Fix: normal full and thin migrations clear all three fields. Only the shared-package installer can write `Verified` or `Quarantined` after its own post-copy check.
- Regression: the migration fixture starts from a `Verified` source and asserts that the independent copy contains none of the inherited trust fields.

## End-to-end controls

The isolated sender and receiver used different manager roots and independent copies of the game and MOD files.

- Package creation: PASS; one active local Mod ID was exported.
- Rights policy: PASS; `reference-only-v1`, `embeddedFiles: 0`.
- Privacy/content boundary: PASS; the sender root, manager root, MOD source bytes and game payload were absent from the package.
- Receiver match: PASS; game version, Build ID, revision, JAR SHA-256, Mod ID, selected layer and MOD content fingerprint matched.
- Modified manifest with stale digest: BLOCKED as invalid.
- Missing MOD directory: BLOCKED.
- Same Mod ID with changed file bytes: BLOCKED as version drift.
- Missing game JAR / weak binary identity: BLOCKED.
- Normal install: PASS; version registry, `share-package.json`, `shared-loadout.json`, `share-install.json` and `freeze.json` agreed on the Package ID and digest; final status `Verified`.
- Repeated install: BLOCKED before migration.
- Post-copy MOD mutation: BLOCKED during the second inspection; receipt and version status remained `Quarantined`, with two concrete blockers recorded.

## Regression suite

- Standard automated suite: 34 passed, 1 Windows symlink-permission skip, 0 failed.
- Migration filesystem fixture: full copy, thin copy, launch arguments, duplicate target, thin-chain guard, missing reference and trust-metadata clearing all passed.
- Integrity/compatibility oracle: clean/damaged/restored/empty-baseline states and all semantic MOD rules passed.
- Shared-package filesystem fixture: all positive and negative cases above passed.

## Explicit limitations

The v1 package remains unsigned. SHA-256 proves that a received manifest has not changed after its digest was created, but does not prove who created it. Package transfer should therefore use a trusted channel and the displayed digest should be compared out of band. v1 also stores the requested load order in metadata instead of silently rewriting a receiver's personal save or server configuration.
