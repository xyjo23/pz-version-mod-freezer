# QA Control Matrix

Status meanings:

- `PASS`: exercised in the stated environment and matched the expected visible state.
- `PASS-MOCK`: UI and state transition passed with the isolated browser API; native side effects still require a real-app round.
- `DEFERRED`: intentionally reserved for a later destructive, native or game-launch round.

| Area | Controls and states covered | Round 1 status | Later evidence required |
|---|---|---|---|
| Window frame | native maximize/restore; preview minimize/close bindings | PASS | native minimize/close smoke test in packaged build |
| Navigation | Console, Versions, Maintenance, Help, Version Details, Settings | PASS | packaged build traversal |
| Console | details drawer, Mods drawer, launch action result, four radar blips | PASS-MOCK | real launch and OS folder actions |
| Console radar | unique bounded positions, healthy activation, quarantined activation guard | PASS-MOCK | real backend rejection log |
| Version list | real Steam plus three frozen entries and real details drawer; preview long-name reveal/import result | PASS | real external folder import |
| Quarantined version | readable details, disabled switch, explicit quarantine explanation | PASS | packaged build regression |
| Version radar | four distinct blips, one blocked blip, persisted list/radar setting | PASS | high-version-count fixture |
| Version creation | source/mode/name rules plus isolated full and thin filesystem migrations | PASS | game-sized disk-full and occupied-file injection |
| Analysis selector | native integrity/compatibility workspace switching; preview responsibility popover and result replacement | PASS | packaged-build regression |
| Integrity report | clean, missing, changed, added and empty-baseline oracle states | PASS | locked/unreadable file fault injection |
| Compatibility report | real Steam data plus dependency, cycle, order, tiledef and semantic-translation oracle rules | PASS | Lua/runtime and crash-log correlation |
| Share package | real create/transfer/inspect/install; reference-only boundary; digest tamper, missing MOD, drift and weak identity blockers; verified receipt, quarantine and repeated-install guard | PASS | signed producer identity and receiver-side loadout application are later format/workflow work |
| Help center | native cards, open, next, close and v0.8 label; preview previous and topic scroll reset | PASS | packaged keyboard and small-window pass |
| Settings | native page rendering; preview switches, terminal enable/disable and radar persistence | PASS | restart persistence in packaged build |
| Terminal | floating entry, open state, disable removes drawer | PASS | real running/error output and pin behavior |
| Destructive interruption | disk full, access denied, occupied files, forced shutdown | DEFERRED | fault-injection round |
| Packaged application | Setup, Portable, upgrade, uninstall | DEFERRED | release-candidate round |
| Project Zomboid | Steam/frozen launch and main-menu identity | DEFERRED | real-game round |
