# QA Run 03 — Analysis oracle and semantic overlap rules

## Outcome

Round 3 built a deterministic analysis oracle for integrity and B42 MOD compatibility. It fixed two false-pass paths and replaced translation-path noise with key-level semantic evidence. No Steam, Workshop, save or registered-version file was modified.

## Fixed findings

### QA-005 — Empty game baseline could pass integrity

- Severity: P1
- Before: a full-copy version with an empty game SHA-256 manifest and an empty but existing game directory could pass because zero expected files matched zero actual files.
- Risk: an unusable version could be reported as complete.
- Fix: a game baseline must contain at least one file record. An empty game baseline now returns `待验证` with rule `FULL-GAME-BASELINE-NONEMPTY` and never passes.
- Regression: the same fixture passed with its real manifest, changed to `unknown` when both game directory and baseline were empty, and passed again after restoration.

### QA-006 — Translation containers were judged only by relative path

- Severity: P2
- Before: treating every different translation file at the same relative path as safe could miss same-key overrides; treating every path as suspicious produced hundreds of false reports.
- Risk: either real text overrides were hidden or normal B42 translation containers overwhelmed the report.
- Fix: JSON and classic PZ translation tables are parsed into keys and values.
  - Byte-identical files: pass.
  - Different files with no same-key/different-value pair: pass with `FILE-TRANSLATION-KEYS-DISJOINT`.
  - Same key with different values: confirmed warning with the conflicting keys as evidence.
  - Unsupported or invalid syntax: unverified/unknown; no conflict is inferred.
- Regression: four translation unit cases and the complete compatibility oracle passed.

## Integrity oracle

The final controlled fixture checked 28 baseline files.

- Clean state: PASS.
- Injected damage: exactly 1 missing game file, 1 changed MOD file and 1 added MOD file.
- Report result: blocker with three separate findings; the added file remained a warning rather than being mislabeled as corruption.
- Restored state: PASS.
- Empty game directory plus empty game manifest: UNKNOWN, never PASS.

## Compatibility oracle

The fixture asserts all of the following rules in one active save context:

- duplicate Mod ID;
- dependency cycle;
- missing dependency;
- author-declared incompatibility;
- load-after and load-before order;
- unsupported game version range;
- duplicate tiledef number;
- future-only B42 version directory;
- Lua and scripts path overlap;
- byte-identical overlap exclusion;
- base-game path override;
- translation key conflict, disjoint keys and unparsed syntax.

Expected fixture verdict: 6 blockers, 4 warnings and 4 unknown findings. All assertions passed.

## Real Steam/Workshop regression

The final read-only run still identified Steam `42.22.2`, Build `26486631`, revision `3d39148846`, 129 installed MOD roots and 100 Workshop projects. The latest save still has one scoped blocker because 98 of its 217 configured Mod IDs are absent.

Across 440 same-path entries:

- 58 byte-identical paths remained safe.
- 274 different translation containers had no same-key/different-value pair and passed.
- 40 translation paths contained confirmed same-key/different-value evidence and became warnings.
- 23 translation paths could not be parsed and remained unknown rather than being guessed safe or conflicting.

## Explicit limitations

Static analysis still does not execute Lua, Java or native code. A confirmed translation key override may be an intentional translation patch, so it is a warning with load-order guidance rather than a blocker. Runtime game launch, multiplayer and crash-log correlation remain later rounds.
