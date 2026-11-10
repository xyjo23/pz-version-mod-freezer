# Project Zomboid Vault 0.2.0

第一轮桌面端重构：保留现有 `PZ-Freeze-Manager.ps1` 作为冻结与校验引擎，用 Electron + React 提供现代化控制台。真实对标 `PvzLauncher 1.5.1` 后的拆解与分期计划见 `REFERENCE_AUDIT.md`。

## 已完成

- 安全的 Electron 进程边界：渲染层无 Node 权限，所有系统操作经 preload IPC 白名单调用。
- 选择并持久化 `PZ_Freeze_Manager` 目录，读取 `current-freeze.json`。
- 启动冻结版、完整性校验、独立存档备份、日志目录打开。
- 统一图标语言、状态层级、加载/反馈动画、减少动态效果系统适配。
- 原创“隔离仓”应用标识与可继续扩展为 ICO/PNG 的 SVG 母版。
- 自定义无边框窗口与适配 980×640 以上窗口的响应式布局。

## 运行

```powershell
pnpm install
pnpm dev
```

生成 Windows 安装版与便携版：

```powershell
pnpm dist:win
```

产物位于 `release/`。安装包允许选择安装目录；便携版不会写入安装信息。

如需只检查视觉稿，可运行 `pnpm exec vite --config electron.vite.config.ts`；在普通浏览器环境中会自动加载只读模拟数据，Electron 内仍使用真实 IPC。

首次运行后，选择已经由旧脚本创建的管理器目录。目录中应包含：

```text
PZ_Freeze_Manager/
  current-freeze.json
  tools/PZ-Freeze-Manager.ps1
  logs/
  frozen/
```

## 安全边界

首轮没有重写冻结、哈希校验、备份算法，也没有复制用户数据。应用仅调用管理器目录内已经安装的 PowerShell 引擎；允许的动作固定为 `Launch`、`Verify`、`BackupSave`。

## 后续迭代建议

1. 把“首次创建冻结环境”拆成可暂停/恢复的任务，并加入磁盘空间与 Mod 预检向导。
2. 将 PowerShell 的结构化输出升级为 JSON 事件流，替代当前的进程文本输出。
3. 增加备份历史、恢复预览、校验报告详情页。
4. 完成 Windows 安装包、应用图标与自动更新策略。

## 设计借鉴与许可

进程隔离与桌面应用结构参考了 `steam-update-freezer`（MIT）。本项目没有复制其业务实现或品牌素材；参考工程许可副本见 `THIRD_PARTY_LICENSES.md`。
