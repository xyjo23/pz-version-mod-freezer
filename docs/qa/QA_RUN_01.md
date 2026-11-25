# QA Run 01 — Baseline and UI controls

## Outcome

Round 1 completed the non-destructive browser-fixture traversal and a read-only traversal of the real Electron application. It fixed two issues found during the run. No P0 or P1 defect was found in this scope.

## Fixed findings

### QA-001 — Blocked versions still accepted radar activation

- Severity: P2
- Before: list cards disabled quarantined versions, but both radar implementations still dispatched activation on double-click.
- Risk: inconsistent behavior and avoidable backend error messages.
- Fix: both radars now carry health state, mark blocked blips with `aria-disabled`, suppress double-click and Enter activation, and explain that the version is unavailable.
- Regression: one blocked blip produced no activation notice; a healthy blip activated normally.

### QA-002 — Browser migration fixture produced false readiness

- Severity: P3 test-infrastructure defect
- Before: an empty required version name was shown as executable, Steam FastLink rules were incomplete, and the fixture displayed an obsolete Steam version.
- Risk: UI automation could report a pass for a state the real backend correctly rejects.
- Fix: preview readiness now requires a non-empty name, blocks Steam FastLink, returns matching warnings and uses Steam `42.22.2` / Build `26486631`.
- Regression: empty name shows `等待配置`, the execute button is disabled, and the required-name warning is visible.

## Observed passes

- Console radar rendered four distinct positions.
- Steam, managed, imported/quarantined and long-name version states rendered correctly.
- Quarantined details remained readable while switching stayed disabled.
- Integrity and compatibility selectors replaced the lower result workspace correctly.
- Shared-package UI exposed reference-only rights and unsigned identity rather than implying redistribution rights.
- All six help topics opened, next/previous navigation worked, and switching topics returned the content to the top.
- Setting toggles restored their initial state after the run.
- No browser error or warning logs were emitted.
- A direct Electron launch kept the real main and renderer processes alive; only the expected development-mode CSP warning was logged.
- The real Electron window was bound by its exact process and unique title. It displayed Steam `42.22.2` / Build `26486631` and four registered versions without radar overlap.
- The real version list showed Steam plus three frozen versions; opening `TEST_FAST_20261123` exposed the expected thin-base and version identity, then closed cleanly.
- The native help dialog opened the `v0.8 · B42` tutorial, advanced from topic 1 to topic 2 and closed normally.
- The native Maintenance page kept version creation disabled with an empty required name. Integrity and compatibility cards switched the lower workspace without starting either analysis.
- The native shared-package page stated the v1 inclusion/exclusion and verification boundaries. No create, receive or install action was triggered.
- The native Settings page rendered the three preference areas, and the custom title bar maximized and restored the window successfully.

## Explicit limitations

This run proves renderer behavior against controlled fixtures and the read-only paths listed above in a direct Electron launch. It does not prove native dialogs, real filesystem mutation, Steam validation, real analysis accuracy, real migration, real game launch or packaged-installer behavior. Those items remain marked `DEFERRED` in the control matrix and must not be described as passed.

An initial native-window attempt was stopped when its provider exposed an unrelated remote-desktop surface; no coordinate input was sent. The successful retry used a different accessibility path, selected the exact Electron process and unique Vault title, and only activated elements from the freshly observed accessibility tree. No user data or application preference was changed.
