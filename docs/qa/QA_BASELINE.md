# QA Baseline

- Date: 2026-11-25 (Asia/Shanghai)
- Baseline commit: `b4dfe39dcc773e0041753ac6f5780187569541dc`
- Product version: `0.8.0`
- Node.js: `v24.14.1`
- pnpm: `11.25.0`
- Platform: Windows x64

## Baseline verification

| Check | Result | Evidence |
|---|---|---|
| TypeScript | PASS | `pnpm typecheck` exited 0 |
| Production renderer/main/preload build | PASS | `pnpm build` exited 0 |
| Share package suite | PASS WITH ENVIRONMENT SKIP | 19 passed, 0 failed, 1 Windows symlink-permission skip |
| Radar layout suite | PASS | 3 passed, 0 failed |
| Browser console | PASS | no error or warning entries after the Round 1 UI traversal |
| Direct Electron startup | PASS | `electron . --enable-logging` kept the main and renderer processes alive until the controlled stop |

For later iterations, `pnpm test:qa` runs the current shared-package suite, radar suite and TypeScript verification as one repeatable gate.

## Round 1 scope

The first round combined the development browser preview with a read-only traversal of the real Electron application. It did not modify Steam, real saves, registered versions or the version library. Native file dialogs, actual game launch, real migration and packaged-build behavior remain separate later-round gates.

The preview fixture includes Steam, a healthy active frozen version, a quarantined shared version and another healthy managed version. This allows the UI to exercise healthy, active, inactive and blocked states without touching user data.

An early native-window attempt was stopped because its provider resolved the wrong surface. A later retry used the exact Electron process and unique `Project Zomboid Vault` window, exposed the expected accessibility tree, and completed read-only navigation safely. The real window passed maximize/restore; minimize and close remain preview-only because exercising them would add no product-state coverage and close is handled by the controlled test process stop.
