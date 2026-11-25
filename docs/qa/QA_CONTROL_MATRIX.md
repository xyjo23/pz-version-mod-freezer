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
| Version creation | source and mode selection, required name, Steam FastLink block, execute result | PASS-MOCK | full and thin filesystem migration |
| Analysis selector | native integrity/compatibility workspace switching; preview responsibility popover and result replacement | PASS | real evidence oracle fixtures |
| Integrity report | summary, storage mode and finding rendering | PASS-MOCK | corrupted/missing file fixtures |
| Compatibility report | scope, warning and evidence rendering | PASS-MOCK | dependency/overlap/save fixtures |
| Share package | create, inspect, unsigned notice, install result | PASS-MOCK | actual `.pzshare` filesystem round trip |
| Help center | native cards, open, next, close and v0.8 label; preview previous and topic scroll reset | PASS | packaged keyboard and small-window pass |
| Settings | native page rendering; preview switches, terminal enable/disable and radar persistence | PASS | restart persistence in packaged build |
| Terminal | floating entry, open state, disable removes drawer | PASS | real running/error output and pin behavior |
| Destructive interruption | disk full, access denied, occupied files, forced shutdown | DEFERRED | fault-injection round |
| Packaged application | Setup, Portable, upgrade, uninstall | DEFERRED | release-candidate round |
| Project Zomboid | Steam/frozen launch and main-menu identity | DEFERRED | real-game round |
