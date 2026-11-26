# QA Control Matrix

Status meanings:

- `PASS`: exercised in the stated environment and matched the expected visible state.
- `PASS-MOCK`: UI and state transition passed with the isolated browser API; native side effects still require a real-app round.
- `DEFERRED`: intentionally reserved for a later destructive, native or game-launch round.

| Area | Controls and states covered | Current status | Later evidence required |
|---|---|---|---|
| Window frame | native maximize/restore/minimize/return; close; 980×640 minimum layout | PASS | multi-monitor and DPI scaling |
| Navigation | Console, Versions, Maintenance, Help, Version Details, Settings | PASS | none for current navigation set |
| Console | details drawer, Mods drawer, launch action result, four radar blips | PASS | OS folder actions on a clean machine |
| Console radar | unique bounded positions, healthy activation, quarantined activation guard | PASS-MOCK | real backend rejection log |
| Version list | real Steam plus frozen entries, details drawer, native import picker and isolated real external import/activation | PASS | user-chosen external library smoke test |
| Quarantined version | readable details, disabled switch, explicit quarantine explanation | PASS | packaged build regression |
| Version radar | four distinct blips, blocked activation, persisted setting and 80-entry bounded/unique layout | PASS | none for deterministic layout |
| Version creation | source/mode/name rules; full/thin migrations; enforced space reserve; hidden staging, atomic commit and incomplete-data recovery | PASS | sudden power loss or storage-device removal |
| Analysis selector | packaged integrity/compatibility switching, responsibility popover and workspace replacement | PASS | none for current selector |
| Integrity report | clean, missing, changed, added, empty-baseline, exclusive-lock and ACL-read-denied states | PASS | large real-library performance profiling |
| Compatibility report | real Steam data plus dependency, cycle, order, tiledef and semantic-translation oracle rules | PASS | Lua/runtime and crash-log correlation |
| Share package | real create/transfer/inspect/install; reference-only boundary; digest tamper, missing MOD, drift and weak identity blockers; verified receipt, quarantine and repeated-install guard | PASS | signed producer identity and receiver-side loadout application are later format/workflow work |
| Help center | packaged cards, topic reset, modal isolation, Tab containment, Escape/focus restoration and small-window scrolling | PASS | screen-reader narration review |
| Settings | switches, terminal/radar/save-protection behavior and packaged restart persistence | PASS | none for current settings set |
| Terminal | floating entry, open state, disable removes drawer, real launch observation and report path | PASS | extended-session pin behavior |
| Destructive interruption | access denied, occupied files, low-space preflight and forced process termination before atomic commit | PASS | sudden power loss and filesystem corruption |
| Packaged application | Setup clean install, 0.8.5→0.8.6 upgrade, uninstall, plus 0.8.7 Portable launch | PASS | signed-binary reputation on a clean machine |
| Project Zomboid | Steam/frozen launch, Steam identity and main-menu version | PASS | real multiplayer server join and save loading |
